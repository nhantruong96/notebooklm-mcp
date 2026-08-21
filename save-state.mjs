/**
 * Export state.json from an already-logged-in Chrome profile.
 *
 * auth.mjs runs the vendor's performSetup(), which wipes the profile and
 * demands a fresh interactive login. When the profile ALREADY holds a valid
 * Google session and only the state.json export was lost (e.g. the setup
 * window was closed early), this script recovers it without another login:
 * open the persistent profile, load NotebookLM, and if it comes up logged in,
 * call the vendor's own saveBrowserState().
 *
 *   node C:\Tools\notebooklm-mcp\save-state.mjs
 *
 * Non-destructive: never clears auth data. If the profile is NOT logged in,
 * it reports the URL it landed on and changes nothing.
 */
import { readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

function resolvePackageDist() {
  const npxRoot = join(process.env.LOCALAPPDATA ?? "", "npm-cache", "_npx");
  const candidates = [];
  if (existsSync(npxRoot)) {
    for (const entry of readdirSync(npxRoot)) {
      const dist = join(npxRoot, entry, "node_modules", "notebooklm-mcp", "dist");
      if (existsSync(join(dist, "auth", "auth-manager.js"))) candidates.push(dist);
    }
  }
  const local = join(HERE, "dist");
  if (existsSync(join(local, "auth", "auth-manager.js"))) candidates.push(local);
  if (candidates.length === 0) throw new Error("Could not find notebooklm-mcp package.");
  return candidates[0];
}

const distUrl = pathToFileURL(resolvePackageDist()).href;
const { AuthManager } = await import(`${distUrl}/auth/auth-manager.js`);
const { CONFIG, ensureDirectories } = await import(`${distUrl}/config.js`);
// Channel selection: the bundled Chromium is usually not installed, so reuse
// the vendor's system-Chrome preference and fallback logic.
const { getPreferredChannel, withChannel, isChannelFailure } = await import(
  `${distUrl}/browser/chromium-fallback.js`
);
const { chromium } = await import("patchright");

ensureDirectories();
console.log("chrome profile:", CONFIG.chromeProfileDir);
console.log("state file    :", join(CONFIG.browserStateDir, "state.json"));
console.log("");

const launchOptions = {
  headless: false,
  viewport: CONFIG.viewport,
  locale: "en-US",
  timezoneId: "Europe/Berlin",
  args: [
    "--disable-blink-features=AutomationControlled",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
  ],
};

const preferred = getPreferredChannel();
console.log("browser channel:", preferred);
let context;
try {
  context = await chromium.launchPersistentContext(
    CONFIG.chromeProfileDir,
    withChannel(launchOptions, preferred),
  );
} catch (err) {
  if (preferred === "chrome" && isChannelFailure(err)) {
    console.log("System Chrome failed to launch — falling back to bundled Chromium.");
    context = await chromium.launchPersistentContext(
      CONFIG.chromeProfileDir,
      withChannel(launchOptions, "chromium"),
    );
  } else {
    throw err;
  }
}

let ok = false;
try {
  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  console.log("Opening https://notebooklm.google.com/ ...");
  await page.goto("https://notebooklm.google.com/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  // Give any auth redirect time to settle.
  await page.waitForTimeout(8000);
  const url = page.url();
  console.log("landed on     :", url);

  // Google rebranded NotebookLM to Gemini Notebook and now serves it from
  // notebook.google.com. The vendor code still only checks the old
  // notebooklm.google.com host, which no longer matches — accept both.
  const LOGGED_IN_HOSTS = [
    "https://notebooklm.google.com/",
    "https://notebook.google.com/",
  ];

  if (LOGGED_IN_HOSTS.some((h) => url.startsWith(h))) {
    console.log("Session is valid — exporting state...");
    const auth = new AuthManager();
    await auth.saveBrowserState(context, page);
    ok = true;
  } else {
    console.log("NOT logged in — the profile has no usable Google session.");
    console.log("Run auth.mjs and log in again (leave the window alone).");
  }
} finally {
  await context.close();
}

console.log("");
console.log("RESULT:", ok ? "SUCCESS" : "FAILED");
process.exit(ok ? 0 : 1);
