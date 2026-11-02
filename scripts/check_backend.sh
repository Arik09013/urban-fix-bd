#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../backend"
PYTHONPYCACHEPREFIX="$(pwd)/../.pycache" python3 -m compileall app
