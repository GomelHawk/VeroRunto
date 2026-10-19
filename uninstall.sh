#!/usr/bin/env bash
# Remove the vero-runto plugin.
#   ./uninstall.sh                        remove it for your user
#   ./uninstall.sh --scope project DIR    remove it from DIR's shared settings
#   ./uninstall.sh --scope local DIR      remove it from DIR's local settings
#
# VeroRunto writes no files of its own: nothing is left behind once the plugin is gone.
# The VeroPlugins marketplace stays registered: the other Vero plugins install from it.
set -euo pipefail

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

case "$SCOPE" in
  user) DIR="$PWD" ;;
  project|local)
    [ -n "$DIR" ] || { echo "--scope $SCOPE needs the project's directory: ./uninstall.sh --scope $SCOPE DIR"; exit 1; }
    DIR="$(cd "$DIR" 2>/dev/null && pwd)" || { echo "No such directory: $DIR"; exit 1; }
    ;;
  *) echo "Unknown scope: $SCOPE (user, project or local)"; exit 1 ;;
esac

# A step that finds nothing to remove is not fatal - the plugin may never have been
# installed at this scope - but it says so rather than passing in silence.
echo "Uninstalling the plugin at $SCOPE scope (this removes its hooks module and command)..."
(cd "$DIR" && claude plugin uninstall "$PLUGIN@$MARKETPLACE" --scope "$SCOPE") \
  || echo "  (not removed: see the message above)"

echo
echo "Done. VeroRunto wrote no files in your projects; every command it ran went through"
echo "Claude Code's Bash tool, and is in the transcript. The VeroPlugins marketplace is"
echo "still registered, for the other Vero plugins; remove it yourself if you want to:"
echo "  claude plugin marketplace remove $MARKETPLACE"
