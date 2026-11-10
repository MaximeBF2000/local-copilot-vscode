#!/bin/sh
# Runs the integration tests in a separate, hidden VS Code instance with its own
# profile and no other extensions, so it never touches your normal VS Code windows.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SANDBOX="${TMPDIR:-/tmp}/local-copilot-integration"
RESULTS="$ROOT/out/test/integration/results.txt"
rm -rf "$SANDBOX" "$RESULTS"
mkdir -p "$SANDBOX/user-data" "$SANDBOX/extensions" "$SANDBOX/workspace/src"

# A tiny TypeScript project, so definitions can be resolved across files by the language server.
cat > "$SANDBOX/workspace/src/pricing.ts" <<'TS'
export interface Price {
  amount: number;
  currency: 'EUR' | 'USD';
}

export function formatPrice(price: Price): string {
  return `${price.amount.toFixed(2)} ${price.currency}`;
}
TS
cat > "$SANDBOX/workspace/src/cart.ts" <<'TS'
import { Price, formatPrice } from './pricing';

export function cartTotal(prices: Price[]): string {
  const amount = prices.reduce((sum, p) => sum + p.amount, 0);
  return formatPrice({ amount, currency: 'EUR' });
}
TS

npm --prefix "$ROOT" run compile --silent

open -W -g -j -n -a "Visual Studio Code" --args \
  --user-data-dir "$SANDBOX/user-data" \
  --extensions-dir "$SANDBOX/extensions" \
  --disable-extensions \
  --enable-proposed-api local.local-copilot \
  --skip-welcome --skip-release-notes --disable-workspace-trust \
  --extensionDevelopmentPath="$ROOT" \
  --extensionTestsPath="$ROOT/out/test/integration/suite" \
  "$SANDBOX/workspace"

cat "$RESULTS"
grep -q '^PASSED' "$RESULTS"
