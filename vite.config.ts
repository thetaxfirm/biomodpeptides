import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import searchPublication from "./lib/seo-publication-v1.json";
import { readExecutionProfile } from "./scripts/execution-profile.mjs";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const managedLinux = readExecutionProfile() === "managed-linux";

const production = process.env.BIOMOD_DEPLOY === "true";
const localBindingConfig = {
  ...(production ? {
    name: "biomod-peptides",
    account_id: "99aaaddf04e12ed1467d146bb2467455",
    workers_dev: false,
    routes: [
      { pattern: "trybiomod.com", custom_domain: true },
      { pattern: "www.trybiomod.com", custom_domain: true },
    ],
    // Runtime settings (COMMERCE_MODE, AUTHORIZENET_*, TAXJAR_*, STORE_*) are managed in the
    // Cloudflare dashboard. keep_vars stops each deploy from erasing them. Unset COMMERCE_MODE
    // keeps checkout disabled.
    keep_vars: true,
    vars: { SEO_PUBLIC_ORIGIN: searchPublication.origin, SEO_PUBLIC_LAUNCH_APPROVED: "true", SEO_INDEXING_ENABLED: "true", SEO_REVIEWED_PRODUCT_SLUGS: searchPublication.productSlugs.join(",") },
  } : {}),
  main: "vinext/server/fetch-handler",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: production ? "biomod-peptides" : "site-creator-d1",
          database_id: production ? "877af242-59d4-4122-a1ff-50fcf02a54dc" : SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
          migrations_dir: production ? "../../drizzle" : "drizzle",
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Use Miniflare's local Request.cf placeholder unless fetching is requested.
  process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= "false";
  process.env.WRANGLER_SEND_METRICS ??= "false";

  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.WRANGLER_REGISTRY_PATH ??= ".wrangler/dev-registry";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      ...(managedLinux ? { host: "0.0.0.0", allowedHosts: ["terminal.local"] } : {}),
      ...(isCodexSeatbeltSandbox ? { watch: { useFsEvents: false, usePolling: true } } : {}),
    },
    plugins: [
      vinext(),
      sites({ mockAuth: false }),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: localBindingConfig,
      }),
    ],
  };
});
