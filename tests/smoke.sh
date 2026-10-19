#!/usr/bin/env bash
# VeroRunto smoke test. No Claude Code, no network, no credentials - just bash, grep and
# python3, so it runs identically on a developer's machine and on a CI runner.
#
#   tests/smoke.sh
#
# It guards the repository's invariants. The first one is the important one: the only
# way the hooks module runs a command is Claude Code's own Bash tool, under its permission
# rules. The module's own logic is TypeScript and is tested by
# `claude plugin test ./plugins/vero-runto`.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN="$ROOT/plugins/vero-runto"

pass=0 fail=0
ok()   { pass=$((pass+1)); printf '  \033[32mok\033[0m    %s\n' "$1"; }
no()   { fail=$((fail+1)); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; [ $# -gt 1 ] && printf '        %s\n' "$2"; }

echo "== the module runs only through the Bash tool =="

# The plugin's promise: a command runs through Claude Code's Bash tool - its permission
# rules, its dialog, its sandbox - and never as a process of the plugin's own, never as
# another tool, never as a prompt in the person's name. Not in the module, not in
# anything it imports.
for f in "$PLUGIN"/hooks/*.ts "$PLUGIN"/hooks/*.tsx; do
  [ -e "$f" ] || continue
  name="${f#"$ROOT"/}"
  if grep -nE '\$\.process|\.process\.(run|spawn)|\$\.agent|\$\.model|command\.run\(|asUser' "$f"; then
    no "no process, agent, model or prompt in the person's name: $name" "the lines above would let VeroRunto act outside the Bash tool"
  else
    ok "no process, agent, model or prompt in the person's name: $name"
  fi
  calls="$(grep -cE '\$\.tool\.call\(' "$f")"
  bash_calls="$(grep -cE "\\\$\\.tool\\.call\\(\\{ tool: 'Bash'," "$f")"
  if [ "$calls" -eq "$bash_calls" ]; then
    ok "every tool call is the Bash tool: $name ($calls)"
  else
    no "every tool call is the Bash tool: $name" "$calls tool calls, $bash_calls of them { tool: 'Bash', ... }"
  fi
done

echo
echo "== repository hygiene =="

for f in install.sh uninstall.sh tests/smoke.sh; do
  [ -x "$ROOT/$f" ] && ok "executable: $f" || no "executable: $f" "not +x - it will not run once cloned"
  if grep -q $'\r$' "$ROOT/$f"; then
    no "LF endings: $f" "CRLF found - dies with: /usr/bin/env: 'bash\\r': No such file or directory"
  else
    ok "LF endings: $f"
  fi
done

for f in plugins/vero-runto/.claude-plugin/plugin.json plugins/vero-runto/hooks/hooks.json; do
  if python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$ROOT/$f" 2>/dev/null; then
    ok "valid JSON: $f"
  else
    no "valid JSON: $f"
  fi
done

# macOS still ships bash 3.2 as /bin/bash. `mapfile`/`readarray` are bash 4+. (This file
# names them in the pattern; CI parses it under bash 3.2 instead.)
for f in install.sh uninstall.sh; do
  if grep -qE '^[^#]*\b(mapfile|readarray)\b' "$ROOT/$f"; then
    no "no bash 4+ syntax: $f" "mapfile/readarray needs bash 4; macOS ships 3.2"
  else
    ok "no bash 4+ syntax: $f"
  fi
done

# hooks.json must not be declared in plugin.json as well, or the plugin loads twice.
# Check the parsed key, not the raw text.
if python3 -c 'import json,sys; sys.exit(1 if "hooks" in json.load(open(sys.argv[1])) else 0)' \
     "$PLUGIN/.claude-plugin/plugin.json"; then
  ok "plugin.json does not declare hooks"
else
  no "plugin.json does not declare hooks" "hooks/hooks.json is auto-discovered; declaring it loads the plugin twice"
fi

# The plugin is a mod: hooks.json names the hooks module and nothing else.
if python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1])) == {"modules": ["./register.tsx"]} else 1)' \
     "$PLUGIN/hooks/hooks.json"; then
  ok "hooks.json names only the hooks module"
else
  no "hooks.json names only the hooks module" "a command hook beside it is never needed here"
fi

# VeroPlugins is the only marketplace: this repository publishes no catalog of its own,
# and the plugin carries the shared source check that enforces it.
[ ! -e "$ROOT/.claude-plugin/marketplace.json" ] && ok "no marketplace.json of its own" \
  || no "no marketplace.json of its own" "the catalog is VeroPlugins; delete .claude-plugin/marketplace.json"
for f in hooks/source-check.ts tests/source-check.test.ts; do
  [ -f "$PLUGIN/$f" ] && ok "the plugin carries $f" || no "the plugin carries $f" "copy it from VeroPlugins/shared/"
done
if grep -q 'REPO="GomelHawk/VeroPlugins"' "$ROOT/install.sh" && grep -q 'MARKETPLACE="vero-plugins"' "$ROOT/install.sh"; then
  ok "install.sh installs from VeroPlugins"
else
  no "install.sh installs from VeroPlugins" "REPO must be GomelHawk/VeroPlugins and MARKETPLACE vero-plugins"
fi
own="verorunto-market""place"   # spelt in two parts, or this file would match itself
if grep -rq "$own" --exclude-dir=.git "$ROOT"; then
  no "no marketplace of its own is named anywhere" "$(grep -rl "$own" --exclude-dir=.git "$ROOT" | tr '\n' ' ')"
else
  ok "no marketplace of its own is named anywhere"
fi

# The plugin directory carries its own copies of the README and LICENSE: a marketplace
# install sees only that directory. Byte for byte the same as the repository's, or one
# of them has gone stale. Compared without carriage returns: .gitattributes owns endings.
for f in README.md LICENSE; do
  cmp -s <(tr -d '\r' < "$ROOT/$f") <(tr -d '\r' < "$PLUGIN/$f") && ok "$f is the same in the plugin" \
    || no "$f is the same in the plugin" "edit both, or copy one over the other"
done

# claude.ai organization distribution rejects a plugin with a top-level bin/.
[ ! -e "$PLUGIN/bin" ] && ok "no top-level bin/ in the plugin" \
  || no "no top-level bin/ in the plugin" "organization distribution rejects it"

# Every image the README shows ships in the repository.
for img in $(grep -oE 'assets/[A-Za-z0-9_.-]+' "$ROOT/README.md" | sort -u); do
  [ -f "$ROOT/$img" ] && ok "README image exists: $img" || no "README image exists: $img"
done

echo
if [ "$fail" -eq 0 ]; then
  printf '\033[32m%s passed, 0 failed\033[0m\n' "$pass"; exit 0
else
  printf '\033[31m%s passed, %s FAILED\033[0m\n' "$pass" "$fail"; exit 1
fi
