#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <backup-id>" >&2
  exit 1
fi

ANOTE_SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANOTE_COMPOSE_FILE="$ANOTE_SOURCE_DIR/compose.production.yaml"
# shellcheck source=production_paths.sh
source "$ANOTE_SOURCE_DIR/scripts/production_paths.sh"
ANOTE_BACKUP_DIR="$ANOTE_BACKUPS_DIR/$1"

if [[ ! -f "$ANOTE_BACKUP_DIR/calendar.db" || ! -f "$ANOTE_BACKUP_DIR/production.env" ]]; then
  echo "Backup does not contain database and runtime state: $ANOTE_BACKUP_DIR" >&2
  exit 1
fi

docker compose --env-file "$ANOTE_ENV_FILE" -f "$ANOTE_COMPOSE_FILE" down
cp "$ANOTE_BACKUP_DIR/calendar.db" "$ANOTE_DATA_DIR/calendar.db"
mkdir -p "$ANOTE_DATA_DIR/uploads"
rsync -a --delete "$ANOTE_BACKUP_DIR/uploads/" "$ANOTE_DATA_DIR/uploads/"
cp "$ANOTE_BACKUP_DIR/production.env" "$ANOTE_ENV_FILE"
docker compose --env-file "$ANOTE_ENV_FILE" -f "$ANOTE_COMPOSE_FILE" up -d

ANOTE_PUBLIC_PORT="$(sed -n 's/^ANOTE_PUBLIC_PORT=//p' "$ANOTE_ENV_FILE" | head -1)"
curl -fsS --retry 30 --retry-delay 2 --retry-connrefused "http://127.0.0.1:${ANOTE_PUBLIC_PORT:-15173}/api/health/ready"
echo
echo "Restored Anote backup $1."
