// Explicit, maintained release gate. No live HTTP tests or provider operations.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error("Release checks require Node 22.13 or later (isolated SQLite fixtures).");
  process.exit(1);
}
const tests = [
  "sales-v24.cjs", "address-normalization-v1.cjs",
  "promo-checkout-v1.cjs", "promo-ui-v1.cjs",
  "cart-save-recovery-v1.cjs", "checkout-owner-recovery-v1.cjs",
  "store-load-recovery-v1.cjs", "account-load-recovery-v1.cjs",
  "admin-read-recovery-v1.cjs", "admin-password-setup-v1.cjs",
  "auth-return-v1.cjs", "payment-return-v1.cjs",
  "payments-authorizenet-v1.mjs", "payment-lookup-completeness-v1.cjs",
  "product-discovery-v1.cjs", "storefront-search-v2.cjs",
  "product-schema-identifiers-v1.cjs", "search-readable-facts-v1.cjs",
  "promo-analytics-v1.cjs", "promo-analytics-export-v1.cjs",
  "sales-diagnostics-v1.cjs", "sales-diagnostics-export-v1.cjs",
  "shopping-measurement-client-v1.cjs", "traffic-measurement-v1.cjs",
  "traffic-metrics-v1.cjs", "coa-delivery-v1.cjs",
  "coa-routes-v1.cjs", "coa-scheduler-v1.cjs", "coa-automation-ui-v1.cjs",
];
// Do not pass ambient provider credentials, NODE_OPTIONS or .env files to tests.
const env = Object.fromEntries(
  ["PATH", "SystemRoot", "TMPDIR", "TEMP", "TMP", "HOME", "CI"]
    .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]),
);
env.NO_COLOR = "1";
function run(label, executable, args) {
  console.log(`\nChecking ${label}`);
  const result = spawnSync(executable, args, { cwd: root, env, stdio: "inherit", timeout: 120_000 });
  if (result.error || result.signal || result.status !== 0) {
    console.error(`Release stopped: ${label} failed${result.signal ? ` (${result.signal})` : ""}.`);
    process.exit(result.status || 1);
  }
}
run("working diff", "git", ["diff", "--check"]);
run("staged diff", "git", ["diff", "--cached", "--check"]);
run("TypeScript", process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit", "--incremental", "false"]);
for (const test of tests) run(test, process.execPath, [`tests/${test}`]);
console.log(`\nRelease checks passed: TypeScript and ${tests.length} isolated suites. Live verification is still required.`);
