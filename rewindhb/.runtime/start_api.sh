#!/usr/bin/env bash
cd /Users/animeshpathak/rewind/services/api
source .venv/bin/activate
LOG=/Users/animeshpathak/rewind/.runtime/run.log

export RECALLOS_DATABASE_URL="postgresql+asyncpg://animeshpathak@/recallos"
export PGHOST=/tmp
# Dev mode: disable any external API calls
unset OPENAI_API_KEY
unset GEMINI_API_KEY

{
  echo
  echo "=== Start uvicorn on :8000 (background) ==="
  nohup uvicorn app.main:app --host 127.0.0.1 --port 8000 --log-level info \
    > /Users/animeshpathak/rewind/.runtime/uvicorn.log 2>&1 &
  echo "pid=$!"
  sleep 3
  echo
  echo "=== uvicorn.log tail ==="
  tail -40 /Users/animeshpathak/rewind/.runtime/uvicorn.log
  echo
  echo "=== healthz ==="
  curl -sS http://127.0.0.1:8000/healthz
  echo
  echo "=== readyz ==="
  curl -sS http://127.0.0.1:8000/readyz
  echo
} 2>&1 | tee -a "$LOG"
