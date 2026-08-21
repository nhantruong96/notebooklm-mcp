/**
 * Standalone login runner for notebooklm-mcp.
 *
 * Why this exists: the `setup_auth` MCP tool waits up to 10 minutes for a
 * manual Google login, which is far longer than the MCP client's tool-call
 * timeout. The client cancels the call, the login flow is torn down before
 * it can persist state.json, and — because performSetup() calls
 * clearAllAuthData() on entry — each retry also wipes the previous session.
 * Running the vendor's own performSetup() in a plain Node process removes the
 * timeout entirely.
 *
 *   node C:\Tools\notebooklm-mcp\auth.mjs
 *
 * Then log in and LEAVE THE WINDOW ALONE. It closes itself once NotebookLM
 * loads; closing it by hand aborts the run and nothing is saved.
 *
 * Auth state expires after 24h, so expect to re-run this daily.
 */
import { readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Locate the notebooklm-mcp package. The MCP server is launched via
 * `npx notebooklm-mcp@latest`, so the npx cache copy is the one whose data
 * directory matters — prefer it, and fall back to this local checkout.
 * The npx cache folder is a content hash that changes on every update, so it
 * must be discovered rather than hard-coded.
 */
function resolvePackageDist() {
  const npxRoot = join(
    process.env.LOCALAPPDATA ?? "",
    "npm-cache",
    "_npx",
  );
  const candidates = [];

  if (existsSync(npxRoot)) {
    for (const entry of readdirSync(npxRoot)) {
      const dist = join(npxRoot, entry, "node_modules", "notebooklm-mcp", "dist");
      if (existsSync(join(dist, "auth", "auth-manager.js"))) candidates.push(dist);
    }
  }

  const local = join(HERE, "dist");
  if (existsSync(join(local, "auth", "auth-manager.js"))) candidates.push(local);

  if (candidates.length === 0) {
    throw new Error(
      "Could not find notebooklm-mcp. Run `npx notebooklm-mcp@latest --help` " +
        "once to populate the npx cache, or build the local checkout with `npm run build`.",
    );
  }
  return candidates[0];
}

const dist = resolvePackageDist();
const distUrl = pathToFileURL(dist).href;

const { AuthManager } = await import(`${distUrl}/auth/auth-manager.js`);
const { CONFIG, ensureDirectories } = await import(`${distUrl}/config.js`);

ensureDirectories();

console.log("package dist  :", dist);
console.log("data dir      :", CONFIG.dataDir);
console.log("state file    :", join(CONFIG.browserStateDir, "state.json"));
console.log("chrome profile:", CONFIG.chromeProfileDir);
console.log("");
console.log("A browser window will open. Log in to Google, then DO NOT close");
console.log("the window — it closes on its own once NotebookLM has loaded.");
console.log("");

const progress = async (message, current, total) => {
  console.log(`[${current}/${total}] ${message}`);
};

const auth = new AuthManager();
// Second argument is "show browser": true launches headed.
const ok = await auth.performSetup(progress, true);

console.log("");
console.log("RESULT:", ok ? "SUCCESS" : "FAILED");
if (ok) {
  console.log("Verify from Claude with the notebooklm get_health tool.");
} else {
  console.log("Nothing was saved. Common cause: the window was closed manually,");
  console.log("or login did not reach notebooklm.google.com within 10 minutes.");
}
process.exit(ok ? 0 : 1);
