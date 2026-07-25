#!/usr/bin/env bash
# Smoke-test the RecallOS API end-to-end.
cd /Users/animeshpathak/rewind/services/api
source .venv/bin/activate
LOG=/Users/animeshpathak/rewind/.runtime/run.log

export RECALLOS_DATABASE_URL="postgresql+asyncpg://animeshpathak@/recallos"
export PGHOST=/tmp
unset OPENAI_API_KEY GEMINI_API_KEY

python /Users/animeshpathak/rewind/.runtime/seed_and_test.py 2>&1
