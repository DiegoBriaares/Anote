#!/usr/bin/env bash
set -euo pipefail

echo "Creating a consistent database-and-uploads production backup."
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/backup_production.sh" "$@"
