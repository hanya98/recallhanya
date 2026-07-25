#!/usr/bin/env bash
# Bring up the API and probe it.
cd /Users/animeshpathak/rewind/services/api
source .venv/bin/activate
LOG=/Users/animeshpathak/rewind/.runtime/run.log

{
  echo
  echo "=== Try importing main ==="
  python -c "from app.main import app; print('IMPORT OK')" 2>&1 | head -40
} | tee -a "$LOG"
