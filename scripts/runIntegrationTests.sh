#!/bin/sh
# Runs the integration tests in a separate, hidden VS Code instance with its own
# profile and no other extensions, so it never touches your normal VS Code windows.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SANDBOX="${TMPDIR:-/tmp}/local-copilot-integration"
RESULTS="$ROOT/out/test/integration/results.txt"
rm -rf "$SANDBOX" "$RESULTS"
mkdir -p "$SANDBOX/user-data" "$SANDBOX/extensions"

npm --prefix "$ROOT" run compile --silent

open -W -g -j -n -a "Visual Studio Code" --args \
  --user-data-dir "$SANDBOX/user-data" \
  --extensions-dir "$SANDBOX/extensions" \
  --disable-extensions \
  --skip-welcome --skip-release-notes --disable-workspace-trust \
  --extensionDevelopmentPath="$ROOT" \
  --extensionTestsPath="$ROOT/out/test/integration/suite"

cat "$RESULTS"
grep -q '^PASSED' "$RESULTS"
