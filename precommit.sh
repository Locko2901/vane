#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BOLD='\033[1m'
RESET='\033[0m'

step() { printf "\n${BOLD}==> %s${RESET}\n" "$1"; }
pass() { printf "${GREEN}  ✓ %s${RESET}\n" "$1"; }
fail() { printf "${RED}  ✗ %s${RESET}\n" "$1"; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="${ROOT}/vane/backend"
FRONTEND="${ROOT}/vane/frontend"

ensure_deps() {
  local dir="$1"
  if [ ! -d "${dir}/node_modules" ]; then
    step "Installing dependencies: ${dir##*/}"
    ( cd "${dir}" && npm ci ) && pass "npm ci (${dir##*/})" || fail "npm ci (${dir##*/})"
  fi
}

ensure_deps "${BACKEND}"
ensure_deps "${FRONTEND}"

step "Prisma: generate client"
( cd "${BACKEND}" && npx prisma generate --schema ../prisma/schema.prisma ) \
  && pass "prisma generate" || fail "prisma generate"

step "ESLint: backend auto-fix"
( cd "${BACKEND}" && npm run lint:fix ) && pass "backend lint:fix" || fail "backend lint:fix"

step "ESLint: frontend auto-fix"
( cd "${FRONTEND}" && npm run lint:fix ) && pass "frontend lint:fix" || fail "frontend lint:fix"

step "ESLint: backend check"
( cd "${BACKEND}" && npm run lint ) && pass "backend lint" || fail "backend lint"

step "ESLint: frontend check"
( cd "${FRONTEND}" && npm run lint ) && pass "frontend lint" || fail "frontend lint"

step "TypeScript: backend type-check"
( cd "${BACKEND}" && npm run typecheck ) && pass "backend typecheck" || fail "backend typecheck"

step "TypeScript: frontend type-check"
( cd "${FRONTEND}" && npm run typecheck ) && pass "frontend typecheck" || fail "frontend typecheck"

step "Build: backend"
( cd "${BACKEND}" && npm run build ) && pass "backend build" || fail "backend build"

step "Build: frontend"
( cd "${FRONTEND}" && npm run build ) && pass "frontend build" || fail "frontend build"

# step "Docs: sync Docker Hub README from README.md"
# ./scripts/sync_docker_readme.sh && pass "sync_docker_readme" || fail "sync_docker_readme"

printf "\n${GREEN}${BOLD}All checks passed!${RESET}\n"
