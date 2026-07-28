#!/usr/bin/env bash
set -euo pipefail

DEV_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
  nvm use 20 >/dev/null
fi

cleanup() {
  if [[ -n "${ANOTE_API_PID:-}" ]]; then
    kill "$ANOTE_API_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

cd "$DEV_ROOT"
PORT=3002 HOST=127.0.0.1 NODE_ENV=development node server/index.js &
ANOTE_API_PID=$!

npx vite
