#!/usr/bin/env bash
# hermes-verify-recallos — ad-hoc verification for the RecallOS deliverable
# NOT a test suite. Checks the things that can be checked without a runtime
# (FastAPI deps, browser, Next.js install). Pass --root to point at the repo.

set -uo pipefail

ROOT="${RECALLOS_ROOT:-${1:-}}"
if [[ -z "$ROOT" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  if [[ -f "$SCRIPT_DIR/../README.md" ]]; then
    ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
  else
    ROOT="$(pwd)"
  fi
fi
export ROOT
cd "$ROOT"

bash "$ROOT/scripts/verify_inner.sh"

