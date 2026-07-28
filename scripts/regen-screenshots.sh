#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GEN_DIR="${ROOT}/tests/screenshots"

echo "==> Installing screenshot tooling"
( cd "${GEN_DIR}" && npm install )

echo "==> Ensuring Chromium is installed"
( cd "${GEN_DIR}" && npx playwright install chromium )

echo "==> Generating screenshots"
( cd "${GEN_DIR}" && node generate.mjs --out "${ROOT}/screenshots" "$@" )
