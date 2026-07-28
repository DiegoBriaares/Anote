#!/usr/bin/env bash
set -euo pipefail

ANOTE_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=production_paths.sh
source "$ANOTE_SCRIPT_DIR/production_paths.sh"
ANOTE_DATABASE="$ANOTE_DATA_DIR/calendar.db"
ANOTE_UPLOADS="$ANOTE_DATA_DIR/uploads"
ANOTE_BACKUP_ID="${1:-$(date -u +%Y%m%dT%H%M%SZ)}"
ANOTE_BACKUP_DIR="$ANOTE_BACKUPS_DIR/$ANOTE_BACKUP_ID"

if [[ ! -f "$ANOTE_DATABASE" ]]; then
  echo "Production database not found: $ANOTE_DATABASE" >&2
  exit 1
fi
if [[ -e "$ANOTE_BACKUP_DIR" ]]; then
  echo "Backup already exists: $ANOTE_BACKUP_DIR" >&2
  exit 1
fi

mkdir -p "$ANOTE_BACKUP_DIR/uploads"
sqlite3 "$ANOTE_DATABASE" ".backup '$ANOTE_BACKUP_DIR/calendar.db'"
if [[ -d "$ANOTE_UPLOADS" ]]; then
  rsync -a "$ANOTE_UPLOADS/" "$ANOTE_BACKUP_DIR/uploads/"
fi

ANOTE_INTEGRITY="$(sqlite3 "$ANOTE_BACKUP_DIR/calendar.db" 'PRAGMA integrity_check;')"
if [[ "$ANOTE_INTEGRITY" != "ok" ]]; then
  echo "Backup integrity check failed: $ANOTE_INTEGRITY" >&2
  exit 1
fi

ANOTE_USERS="$(sqlite3 "$ANOTE_BACKUP_DIR/calendar.db" 'SELECT count(*) FROM users;')"
ANOTE_EVENTS="$(sqlite3 "$ANOTE_BACKUP_DIR/calendar.db" 'SELECT count(*) FROM events;')"
ANOTE_UPLOAD_COUNT="$(find "$ANOTE_BACKUP_DIR/uploads" -type f | wc -l | tr -d ' ')"
ANOTE_CHECKSUM="$(shasum -a 256 "$ANOTE_BACKUP_DIR/calendar.db" | awk '{print $1}')"

printf '{\n  "backup_id": "%s",\n  "database_sha256": "%s",\n  "integrity": "ok",\n  "users": %s,\n  "events": %s,\n  "uploads": %s\n}\n' \
  "$ANOTE_BACKUP_ID" "$ANOTE_CHECKSUM" "$ANOTE_USERS" "$ANOTE_EVENTS" "$ANOTE_UPLOAD_COUNT" \
  > "$ANOTE_BACKUP_DIR/manifest.json"

echo "$ANOTE_BACKUP_DIR"
