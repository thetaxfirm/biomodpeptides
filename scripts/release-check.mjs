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
  "affiliate-program-v1.cjs", "affiliate-route-v1.cjs",
  "product-batch-v1.cjs", "label-lot-reports-v1.cjs", "product-batch-admin-v1.cjs", "product-batch-history-v1.cjs", "product-batch-order-v1.cjs", "public-batch-consumers-v1.cjs",
  "pack-price-admin-v1.cjs",
  "product-availability-v1.cjs", "admin-products-ui-v1.cjs", "sale-display-v1.cjs",
  "change-history-v1.cjs", "change-history-system-v1.cjs", "change-history-route-v1.cjs", "change-history-ui-v1.cjs", "change-history-shipping-v1.cjs", "change-history-import-v1.mjs",
  "checkout-recovery-v1.cjs", "checkout-expiry-v1.cjs", "preorder-pricing-v1.cjs", "preorder-order-v1.cjs",
  "admin-shipping-services-ui-v1.cjs", "shipping-services-v1.cjs", "coa-shipping-v1.cjs", "admin-overview-v1.cjs", "shipping-settings-route-v1.cjs", "shipping-options-v1.cjs",
  "shipping-policy-history-v1.cjs", "merchant-policies-v1.cjs", "shipping-minimum-service-v1.cjs",
  "fulfillment-v1.cjs", "orders-queue-v1.cjs", "order-messages-v1.cjs", "pick-list-v1.cjs", "label-sheet-v1.cjs", "tracking-sweep-v1.cjs", "auto-label-v1.cjs", "orders-mark-shipped-v1.cjs", "easypost-v1.mjs", "easypost-admin-ui-v1.cjs", "sales-v24.cjs", "address-normalization-v1.cjs",
  "promo-checkout-v1.cjs", "promo-ui-v1.cjs",
  "cart-save-recovery-v1.cjs", "checkout-owner-recovery-v1.cjs",
  "store-load-recovery-v1.cjs", "account-load-recovery-v1.cjs",
  "admin-read-recovery-v1.cjs", "admin-password-setup-v1.cjs", "admin-landing-v1.cjs", "staff-access-v1.cjs",
  "admin-request-status-v1.cjs", "request-alerts-v1.cjs", "request-snapshot-v1.cjs", "request-desk-v1.cjs", "request-forward-v1.cjs", "request-cases-v1.cjs", "reply-overdue-v1.cjs",
  "auth-return-v1.cjs", "payment-return-v1.cjs",
  "payments-authorizenet-v1.mjs", "payment-lookup-completeness-v1.cjs",
  "product-discovery-v1.cjs", "storefront-search-v2.cjs",
  "product-schema-identifiers-v1.cjs", "search-readable-facts-v1.cjs", "canonical-host-redirect-v1.cjs", "search-buy-intent-v1.cjs", "social-preview-v1.cjs", "newsroom-v1.cjs", "sitemap-lastmod-v1.cjs", "legacy-domain-routes-v1.cjs", "editorial-vial-links-v1.cjs",
  "promo-analytics-v1.cjs", "promo-analytics-export-v1.cjs",
  "sales-diagnostics-v1.cjs", "sales-diagnostics-export-v1.cjs",
  "shopping-measurement-client-v1.cjs", "traffic-measurement-v1.cjs",
  "traffic-metrics-v1.cjs", "coa-delivery-v1.cjs",
  "coa-label-lot-v1.cjs", "request-replies-v1.cjs", "reply-simple-v1.cjs", "request-reply-route-v1.cjs", "coa-routes-v1.cjs", "coa-scheduler-v1.cjs", "coa-automation-ui-v1.cjs",
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
