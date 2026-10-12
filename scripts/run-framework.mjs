import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readExecutionProfile } from "./execution-profile.mjs";

const [command, ...args] = process.argv.slice(2);
if (!["dev", "build"].includes(command)) throw new Error("Expected dev or build.");
// The hosted main-branch build already sets BIOMOD_DEPLOY=true. Fail before
// compilation if shared commerce, admin, SEO or messaging checks regress.
if (command === "build" && process.env.BIOMOD_DEPLOY === "true") {
  const checked = spawnSync(process.execPath, [
    fileURLToPath(new URL("./release-check.mjs", import.meta.url)),
  ], { stdio: "inherit" });
  if (checked.error) throw checked.error;
  if (checked.status !== 0) process.exit(checked.status || 1);
}
const managedLinux = readExecutionProfile() === "managed-linux";

if (managedLinux && command === "build") {
  const result = spawnSync("bash", [
    fileURLToPath(new URL("./build-verified.sh", import.meta.url)), ...args,
  ], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

// Import in this process so the preview owner retains its PID and signals.
const cli = new URL(managedLinux
  ? "../node_modules/vite/bin/vite.js"
  : "../node_modules/vinext/dist/cli.js", import.meta.url);
process.argv = [process.execPath, fileURLToPath(cli), command,
  ...(!managedLinux && command === "dev" ? ["--port", "5173"] : []), ...args];
await import(cli.href);
