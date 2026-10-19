#!/usr/bin/env bash
# Install the vero-runto plugin from VeroPlugins, the marketplace every Vero plugin comes from.
#   ./install.sh                        install for your user
#   ./install.sh --scope project DIR    share it with everyone who works in DIR
#   ./install.sh --scope local DIR      install it for yourself, in DIR only
#
# Project and local scope write to DIR's .claude/ settings, so they need DIR: run from
# this clone, the current directory would be the clone itself. Every scope declares the
# GitHub marketplace, never this clone's path: a teammate has no such path, and the
# plugin works only when installed from VeroPlugins. To run the code in this clone
# instead, load it for one session: claude --plugin-dir "$PWD/plugins/vero-runto".
set -euo pipefail

REPO="GomelHawk/VeroPlugins"
MARKETPLACE="vero-plugins"
PLUGIN="vero-runto"
SCOPE="user"
DIR=""
case "${1:-}" in
  "") ;;
  --scope) SCOPE="${2:-}"; DIR="${3:-}" ;;
  *) echo "Unknown option: $1 (see the top of this script)"; exit 1 ;;
esac

command -v claude >/dev/null 2>&1 || { echo "claude CLI not found on PATH"; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "$SCOPE" in
  user) DIR="$PWD" ;;
  project|local)
    [ -n "$DIR" ] || { echo "--scope $SCOPE needs the project's directory: ./install.sh --scope $SCOPE DIR"; exit 1; }
    DIR="$(cd "$DIR" 2>/dev/null && pwd)" || { echo "No such directory: ${3:-}"; exit 1; }
    [ "$DIR" != "$HERE" ] || { echo "DIR is this clone; name the project to install VeroRunto into"; exit 1; }
    ;;
  *) echo "Unknown scope: $SCOPE (user, project or local)"; exit 1 ;;
esac

echo "Validating the plugin in this clone..."
claude plugin validate "$HERE/plugins/$PLUGIN"

echo
echo "Registering the VeroPlugins marketplace..."
if [ "$SCOPE" = "user" ]; then
  claude plugin marketplace add "$REPO"
else
  (cd "$DIR" && claude plugin marketplace add "$REPO" --scope "$SCOPE")
fi

echo
echo "The plugin is a mod: one hooks module that draws [ Copy ] and [ Run ] after every"
echo "! command in Claude's replies. Run goes through Claude Code's Bash tool, under your"
echo "permission rules, and only after you confirm."
echo
if [ "$SCOPE" = "user" ]; then
  claude plugin install "$PLUGIN@$MARKETPLACE"
else
  (cd "$DIR" && claude plugin install "$PLUGIN@$MARKETPLACE" --scope "$SCOPE")
  echo
  if [ "$SCOPE" = "project" ]; then
    echo "Written to $DIR/.claude/settings.json - commit it to share VeroRunto with the team."
  else
    echo "Written to $DIR/.claude/settings.local.json - for you only, never committed."
  fi
fi

echo
echo "Installed. Restart Claude Code, then:"
echo "  /vero-runto           what it does and its options"
