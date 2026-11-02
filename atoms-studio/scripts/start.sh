#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
exec node --experimental-sqlite --env-file-if-exists=.env src/server.js
