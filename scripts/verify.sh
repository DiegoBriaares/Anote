#!/usr/bin/env bash
set -euo pipefail

node_major=""
if command -v node >/dev/null 2>&1; then
  node_major="$(node -p 'process.versions.node.split(`.`)[0]')"
fi

if [[ "$node_major" != "20" && -s "$HOME/.nvm/nvm.sh" ]]; then
  unset npm_config_prefix NPM_CONFIG_PREFIX
  # shellcheck source=/dev/null
  source "$HOME/.nvm/nvm.sh"
  nvm use 20 >/dev/null
  node_major="$(node -p 'process.versions.node.split(`.`)[0]')"
fi

if [[ "$node_major" != "20" ]]; then
  echo "Anote verification requires Node.js 20." >&2
  exit 1
fi

node scripts/privacy_guard.cjs
npm run lint
npm run build
npm test
