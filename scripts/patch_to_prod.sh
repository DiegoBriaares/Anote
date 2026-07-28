#!/usr/bin/env bash
set -euo pipefail

echo "Source-copy production patches are retired; deploying immutable containers instead."
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy_to_prod.sh" "$@"
