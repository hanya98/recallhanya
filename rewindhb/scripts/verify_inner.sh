#!/usr/bin/env bash
# hermes-verify-recallos (inner) — ad-hoc verification, run via verify.sh
# Uses python3 -c with argv to avoid heredoc-with-arg quirks.
set -uo pipefail

pass=0; fail=0; warn=0
say()   { printf "  %s\n" "$*"; }
ok()    { printf "  \033[32mOK\033[0m  %s\n" "$*";  pass=$((pass+1)); }
nok()   { printf "  \033[31mFAIL\033[0m %s\n" "$*";  fail=$((fail+1)); }
soft()  { printf "  \033[33mWARN\033[0m %s\n" "$*";  warn=$((warn+1)); }
head()  { printf "\n\033[1m%s\033[0m\n" "$*"; }

# ---------------------------------------------- 1. file presence
head "[1] File presence"
required=(
  README.md
  docs/01-product-vision.md docs/02-problem-statement.md docs/03-user-personas.md
  docs/04-user-flow.md docs/05-feature-list.md docs/06-information-architecture.md
  docs/07-technical-architecture.md docs/08-database-schema.md docs/09-api-endpoints.md
  docs/10-extension-architecture.md docs/11-semantic-search-flow.md
  docs/12-memory-snapshot-architecture.md docs/13-vector-database-design.md
  docs/14-roadmap.md docs/15-landing-page-copy.md docs/16-demo-script.md
  design/logo.svg
  apps/web/package.json apps/extension/manifest.json apps/extension/package.json
  apps/extension/src/background/service-worker.js apps/extension/src/content/extractor.js
  services/api/pyproject.toml services/api/app/main.py
  services/api/app/routers/memories.py services/api/app/routers/search.py
  web/landing.html web/dashboard-timeline.html web/spotlight.html
  web/memory-graph.html web/memory-detail.html
)
for f in "${required[@]}"; do
  if [[ -f "$ROOT/$f" ]]; then ok "$f"; else nok "MISSING: $f"; fi
done

# ---------------------------------------------- 2. manifest sanity
head "[2] Manifest + package JSON parses"
for j in apps/extension/manifest.json apps/extension/package.json apps/web/package.json; do
  if python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$ROOT/$j" 2>/dev/null; then
    ok "$j parses"
  else
    nok "$j failed to parse"
  fi
done

if python3 -c "import tomllib,sys; tomllib.load(open(sys.argv[1],'rb'))" "$ROOT/services/api/pyproject.toml" 2>/dev/null; then
  ok "pyproject.toml parses (tomllib)"
else
  nok "pyproject.toml failed to parse"
fi

if python3 -c "
import json, sys
m = json.load(open(sys.argv[1]))
assert m.get('manifest_version') == 3
assert 'background' in m and 'service_worker' in m['background']
assert 'content_scripts' in m and len(m['content_scripts']) > 0
assert 'permissions' in m and len(m['permissions']) > 0
" "$ROOT/apps/extension/manifest.json" 2>/dev/null; then
  ok "manifest.json has manifest_version=3 + required fields"
else
  nok "manifest.json missing required fields"
fi

# ---------------------------------------------- 3. Python AST + static checks
head "[3] Python AST + static checks"
for py in services/api/app/main.py services/api/app/routers/memories.py services/api/app/routers/search.py; do
  if python3 -c "import ast,sys; ast.parse(open(sys.argv[1]).read())" "$ROOT/$py" 2>/dev/null; then
    ok "$py parses"
  else
    nok "$py — AST parse failed"
  fi
done

# 'until' param shadowing bug regression check
if python3 -c "
import ast, sys
tree = ast.parse(open(sys.argv[1]).read())
for node in ast.walk(tree):
    if isinstance(node, ast.FunctionDef) and node.name == 'search':
        for sub in ast.walk(node):
            if isinstance(sub, ast.Assign):
                for tgt in sub.targets:
                    if isinstance(tgt, ast.Name) and tgt.id == 'until':
                        raise SystemExit('reassigned')
" "$ROOT/services/api/app/routers/search.py" 2>/dev/null; then
  ok "search.py — no shadowing of 'until' param"
else
  nok "search.py — 'until' still being shadowed"
fi

# relativedelta import regression check
if python3 -c "
import sys
src = open(sys.argv[1]).read()
if 'from dateutil.relativedelta import relativedelta' not in src:
    raise SystemExit('missing import')
" "$ROOT/services/api/app/routers/search.py" 2>/dev/null; then
  ok "search.py imports relativedelta from dateutil"
else
  nok "search.py missing relativedelta import"
fi

# ---------------------------------------------- 4. Extension JS syntax
head "[4] Extension JS — node --check"
for js in apps/extension/src/background/service-worker.js apps/extension/src/content/extractor.js; do
  if command -v node >/dev/null && node --check "$ROOT/$js" 2>/dev/null; then
    ok "$js — node --check passed"
  else
    o=$(tr -cd '{' < "$ROOT/$js" | wc -c | tr -d ' ')
    c=$(tr -cd '}' < "$ROOT/$js" | wc -c | tr -d ' ')
    if [[ "$o" == "$c" ]]; then
      soft "$js — braces balanced ($o); node not present"
    else
      nok "$js — unbalanced braces"
    fi
  fi
done

# ---------------------------------------------- 5. HTML sanity
head "[5] HTML — non-trivial size"
for h in web/landing.html web/dashboard-timeline.html web/spotlight.html web/memory-graph.html web/memory-detail.html; do
  s=$(wc -c < "$ROOT/$h")
  if [[ "$s" -gt 1000 ]]; then ok "$h — $(printf '%5d' $s) bytes"; else nok "$h — too small"; fi
done

# ---------------------------------------------- 6. README
head "[6] README"
if grep -q "/docs" "$ROOT/README.md"; then ok "README links /docs"; else nok "README missing /docs link"; fi
if grep -qiE "tailwind|next\.js|fastapi|postgres" "$ROOT/README.md"; then ok "README mentions stack"; else nok "README missing stack refs"; fi

# ---------------------------------------------- 7. Brief constraints
head "[7] Brief constraints"
if grep -qiE "operating system|desktop app" "$ROOT/docs/01-product-vision.md"; then
  soft "vision doc mentions OS — verify it's framed as roadmap-only"
else
  ok "vision doc keeps scope to web + extension"
fi
if grep -qiE "desktop|native|OS" "$ROOT/docs/14-roadmap.md"; then
  ok "roadmap defers OS to later"
else
  nok "roadmap missing OS deferral"
fi
if grep -qiE "never.*raw HTML|raw HTML.*never|no raw HTML" "$ROOT/docs/12-memory-snapshot-architecture.md"; then
  ok "snapshot doc states no-raw-HTML"
else
  nok "snapshot doc missing raw-HTML guarantee"
fi

# ---------------------------------------------- summary
head "Summary"
printf "  pass=%d  fail=%d  warn=%d  root=%s\n" "$pass" "$fail" "$warn" "$ROOT"
if [[ "$fail" -gt 0 ]]; then exit 1; fi
exit 0
