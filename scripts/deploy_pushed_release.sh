#!/usr/bin/env bash
set -euo pipefail

ANOTE_SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ANOTE_SOURCE_DIR"

ANOTE_RELEASE_BRANCH="$(git branch --show-current)"
if [[ -z "$ANOTE_RELEASE_BRANCH" ]]; then
  echo "Refusing to deploy without a named local branch." >&2
  exit 1
fi

git fetch origin --prune
ANOTE_RELEASE_REF="origin/$ANOTE_RELEASE_BRANCH"
if ! git show-ref --verify --quiet "refs/remotes/$ANOTE_RELEASE_REF"; then
  echo "Refusing to deploy an unpushed branch: $ANOTE_RELEASE_BRANCH" >&2
  exit 1
fi

ANOTE_LOCAL_SHA="$(git rev-parse HEAD)"
ANOTE_REMOTE_SHA="$(git rev-parse "$ANOTE_RELEASE_REF")"
if [[ "$ANOTE_LOCAL_SHA" != "$ANOTE_REMOTE_SHA" ]]; then
  echo "Refusing to deploy: push the current commit before deployment." >&2
  exit 1
fi

ANOTE_RELEASE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/anote-pushed-release.XXXXXX")"
ANOTE_RELEASE_WORKTREE="$ANOTE_RELEASE_ROOT/source"
ANOTE_WORKTREE_ADDED=0

cleanup_release_worktree() {
  ANOTE_RELEASE_EXIT_CODE=$?
  trap - EXIT INT TERM
  if [[ "$ANOTE_WORKTREE_ADDED" == "1" ]]; then
    git -C "$ANOTE_SOURCE_DIR" worktree remove --force "$ANOTE_RELEASE_WORKTREE" >/dev/null 2>&1 || true
  fi
  rmdir "$ANOTE_RELEASE_ROOT" >/dev/null 2>&1 || true
  exit "$ANOTE_RELEASE_EXIT_CODE"
}
trap cleanup_release_worktree EXIT INT TERM

git worktree add --detach "$ANOTE_RELEASE_WORKTREE" "$ANOTE_RELEASE_REF"
ANOTE_WORKTREE_ADDED=1

echo "Deploying verified pushed commit $ANOTE_REMOTE_SHA from $ANOTE_RELEASE_REF."
(
  cd "$ANOTE_RELEASE_WORKTREE"
  ANOTE_DEPLOY_REMOTE_REF="$ANOTE_RELEASE_REF" npm run prod:deploy
)
