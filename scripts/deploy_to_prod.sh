#!/usr/bin/env bash
set -euo pipefail

ANOTE_SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANOTE_COMPOSE_FILE="$ANOTE_SOURCE_DIR/compose.production.yaml"
# shellcheck source=production_paths.sh
source "$ANOTE_SOURCE_DIR/scripts/production_paths.sh"
ANOTE_LEGACY_DIR="${ANOTE_LEGACY_DIR:-}"
ANOTE_PUBLIC_PORT="${ANOTE_PUBLIC_PORT:-15173}"
ANOTE_BIND_ADDRESS="${ANOTE_BIND_ADDRESS:-0.0.0.0}"
ANOTE_DEFAULT_TIME_ZONE="${ANOTE_DEFAULT_TIME_ZONE:-$(node -p "Intl.DateTimeFormat().resolvedOptions().timeZone")}"

mkdir -p "$ANOTE_DATA_DIR/uploads" "$ANOTE_BACKUPS_DIR" "$ANOTE_RELEASES_DIR"

if [[ ! -f "$ANOTE_DATA_DIR/calendar.db" ]]; then
  if [[ -z "$ANOTE_LEGACY_DIR" || ! -f "$ANOTE_LEGACY_DIR/server/calendar.db" ]]; then
    echo "No managed production database exists. Set ANOTE_LEGACY_DIR once to import a legacy installation." >&2
    exit 1
  fi
  echo "Importing the existing production database and uploads."
  sqlite3 "$ANOTE_LEGACY_DIR/server/calendar.db" ".backup '$ANOTE_DATA_DIR/calendar.db'"
  if [[ -d "$ANOTE_LEGACY_DIR/server/uploads" ]]; then
    rsync -a "$ANOTE_LEGACY_DIR/server/uploads/" "$ANOTE_DATA_DIR/uploads/"
  fi
fi

ANOTE_INTEGRITY="$(sqlite3 "$ANOTE_DATA_DIR/calendar.db" 'PRAGMA integrity_check;')"
if [[ "$ANOTE_INTEGRITY" != "ok" ]]; then
  echo "Production database integrity check failed: $ANOTE_INTEGRITY" >&2
  exit 1
fi

cd "$ANOTE_SOURCE_DIR"
ANOTE_GIT_SHA="$(git rev-parse HEAD)"
ANOTE_SHORT_SHA="$(git rev-parse --short=12 HEAD)"
ANOTE_DEPLOY_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
if [[ -n "$(git status --porcelain)" ]]; then
  if [[ "${ALLOW_DIRTY:-0}" != "1" ]]; then
    echo "Refusing to deploy an uncommitted worktree. Commit the intended release first." >&2
    exit 1
  fi
  ANOTE_IMAGE_TAG="worktree-${ANOTE_SHORT_SHA}-${ANOTE_DEPLOY_ID}"
else
  ANOTE_DEPLOY_REMOTE_REF="${ANOTE_DEPLOY_REMOTE_REF:-origin/main}"
  if [[ "$ANOTE_DEPLOY_REMOTE_REF" != origin/* ]]; then
    echo "Refusing to deploy a release that is not owned by an origin remote-tracking ref." >&2
    exit 1
  fi
  if ! git show-ref --verify --quiet "refs/remotes/$ANOTE_DEPLOY_REMOTE_REF"; then
    echo "Refusing to deploy without the remote release ref '$ANOTE_DEPLOY_REMOTE_REF'. Push or fetch it first." >&2
    exit 1
  fi
  ANOTE_REMOTE_RELEASE_SHA="$(git rev-parse "$ANOTE_DEPLOY_REMOTE_REF")"
  if [[ "$ANOTE_GIT_SHA" != "$ANOTE_REMOTE_RELEASE_SHA" ]]; then
    echo "Refusing to deploy: HEAD does not exactly match '$ANOTE_DEPLOY_REMOTE_REF'." >&2
    exit 1
  fi
  # A release-specific tag keeps the currently running images addressable by
  # the production.env copied into the pre-deploy backup. Reusing only the Git
  # SHA could overwrite that rollback target when the same commit is redeployed.
  ANOTE_IMAGE_TAG="${ANOTE_SHORT_SHA}-${ANOTE_DEPLOY_ID}"
fi

ANOTE_API_UID="$(id -u)"
ANOTE_API_GID="$(id -g)"

umask 077
printf 'ANOTE_DATA_DIR=%s\nANOTE_IMAGE_TAG=%s\nANOTE_BIND_ADDRESS=%s\nANOTE_PUBLIC_PORT=%s\nANOTE_API_UID=%s\nANOTE_API_GID=%s\nANOTE_DEFAULT_TIME_ZONE=%s\n' \
  "$ANOTE_DATA_DIR" "$ANOTE_IMAGE_TAG" "$ANOTE_BIND_ADDRESS" "$ANOTE_PUBLIC_PORT" "$ANOTE_API_UID" "$ANOTE_API_GID" "$ANOTE_DEFAULT_TIME_ZONE" \
  > "$ANOTE_CANDIDATE_ENV"

echo "Building immutable Anote images for $ANOTE_IMAGE_TAG."
docker compose --env-file "$ANOTE_CANDIDATE_ENV" -f "$ANOTE_COMPOSE_FILE" build

ANOTE_BACKUP_ID="predeploy-${ANOTE_DEPLOY_ID}-${ANOTE_SHORT_SHA}"
ANOTE_BACKUP_DIR="$(ANOTE_PRODUCTION_HOME="$ANOTE_PRODUCTION_HOME" "$ANOTE_SOURCE_DIR/scripts/backup_production.sh" "$ANOTE_BACKUP_ID")"
if [[ -f "$ANOTE_ENV_FILE" ]]; then
  cp "$ANOTE_ENV_FILE" "$ANOTE_BACKUP_DIR/production.env"
fi

ANOTE_LISTENER_PIDS="$(lsof -tiTCP:"$ANOTE_PUBLIC_PORT" -sTCP:LISTEN 2>/dev/null || true)"
for ANOTE_LISTENER_PID in $ANOTE_LISTENER_PIDS; do
  ANOTE_LISTENER_CWD="$(lsof -a -p "$ANOTE_LISTENER_PID" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
  if [[ -n "$ANOTE_LEGACY_DIR" && "$ANOTE_LISTENER_CWD" == "$ANOTE_LEGACY_DIR" ]]; then
    echo "Stopping legacy Anote frontend process $ANOTE_LISTENER_PID."
    kill "$ANOTE_LISTENER_PID"
  fi
done

mv "$ANOTE_CANDIDATE_ENV" "$ANOTE_ENV_FILE"

rollback_on_error() {
  ANOTE_EXIT_CODE=$?
  echo "Deployment failed; restoring pre-deploy data and runtime." >&2
  docker compose --env-file "$ANOTE_ENV_FILE" -f "$ANOTE_COMPOSE_FILE" down || true
  cp "$ANOTE_BACKUP_DIR/calendar.db" "$ANOTE_DATA_DIR/calendar.db"
  rsync -a --delete "$ANOTE_BACKUP_DIR/uploads/" "$ANOTE_DATA_DIR/uploads/"
  if [[ -f "$ANOTE_BACKUP_DIR/production.env" ]]; then
    cp "$ANOTE_BACKUP_DIR/production.env" "$ANOTE_ENV_FILE"
    docker compose --env-file "$ANOTE_ENV_FILE" -f "$ANOTE_COMPOSE_FILE" up -d || true
  fi
  exit "$ANOTE_EXIT_CODE"
}
trap rollback_on_error ERR

docker compose --env-file "$ANOTE_ENV_FILE" -f "$ANOTE_COMPOSE_FILE" up -d --remove-orphans

ANOTE_READY=0
for ANOTE_ATTEMPT in {1..36}; do
  if curl -fsS "http://127.0.0.1:$ANOTE_PUBLIC_PORT/api/health/ready" >/dev/null; then
    ANOTE_READY=1
    break
  fi
  sleep 5
done
if [[ "$ANOTE_READY" != "1" ]]; then
  echo "Anote did not become ready within 180 seconds." >&2
  false
fi

ANOTE_RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)-$ANOTE_IMAGE_TAG"
ANOTE_RELEASE_DIR="$ANOTE_RELEASES_DIR/$ANOTE_RELEASE_ID"
mkdir -p "$ANOTE_RELEASE_DIR"
ANOTE_API_IMAGE_ID="$(docker image inspect "anote-api:$ANOTE_IMAGE_TAG" --format '{{.Id}}')"
ANOTE_WEB_IMAGE_ID="$(docker image inspect "anote-web:$ANOTE_IMAGE_TAG" --format '{{.Id}}')"
printf '{\n  "release_id": "%s",\n  "git_sha": "%s",\n  "image_tag": "%s",\n  "api_image": "%s",\n  "web_image": "%s",\n  "backup_id": "%s",\n  "status": "ready"\n}\n' \
  "$ANOTE_RELEASE_ID" "$ANOTE_GIT_SHA" "$ANOTE_IMAGE_TAG" "$ANOTE_API_IMAGE_ID" "$ANOTE_WEB_IMAGE_ID" "$ANOTE_BACKUP_ID" \
  > "$ANOTE_RELEASE_DIR/manifest.json"

trap - ERR
echo "Anote is ready at http://127.0.0.1:$ANOTE_PUBLIC_PORT and through the configured Tailscale proxy."
echo "Release manifest: $ANOTE_RELEASE_DIR/manifest.json"
