#!/usr/bin/env bash

# Owns Anote's portable production filesystem contract. Callers may override
# ANOTE_PRODUCTION_HOME, but must not embed a developer's home path.
if [[ -z "${ANOTE_PRODUCTION_HOME:-}" ]]; then
  : "${HOME:?HOME must be set or ANOTE_PRODUCTION_HOME must be provided}"
  if [[ "$(uname -s)" == "Darwin" ]]; then
    ANOTE_STATE_ROOT="$HOME/Library/Application Support"
  else
    ANOTE_STATE_ROOT="${XDG_STATE_HOME:-$HOME/.local/state}"
  fi
  ANOTE_PRODUCTION_HOME="$ANOTE_STATE_ROOT/Anote/production"
fi

ANOTE_DATA_DIR="$ANOTE_PRODUCTION_HOME/data"
ANOTE_ENV_FILE="$ANOTE_PRODUCTION_HOME/production.env"
ANOTE_CANDIDATE_ENV="$ANOTE_PRODUCTION_HOME/production.candidate.env"
ANOTE_RELEASES_DIR="$ANOTE_PRODUCTION_HOME/releases"
ANOTE_BACKUPS_DIR="$ANOTE_PRODUCTION_HOME/backups"

# Once Control Center has enrolled this production root, its registry and
# operation journal are the only lifecycle authority. Out-of-band scripts
# cannot prove the registry state they would otherwise invalidate.
ANOTE_INSTALLATION_ROOT="$(dirname "$ANOTE_PRODUCTION_HOME")"
ANOTE_CONTROL_CENTER_REGISTRY="$ANOTE_INSTALLATION_ROOT/registry/installation.json"
if [[ -f "$ANOTE_CONTROL_CENTER_REGISTRY" ]]; then
  echo "This Anote installation is managed by Anote Control Center. Use Control Center for production operations; legacy production scripts are disabled." >&2
  exit 73
fi
