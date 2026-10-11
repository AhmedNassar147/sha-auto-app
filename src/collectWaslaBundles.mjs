import dotenv from "dotenv";
dotenv.config({ quiet: true });
import puppeteer from "puppeteer";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline/promises";

// Saves source files only. Downloaded bundles are never imported or executed
// by this script; visiting the portal runs its normal UI code in Chrome.
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
const caseId = option("--case");
if (!caseId || !/^\d+$/.test(caseId)) {
  console.error("Usage: npm run collect-bundles -- --case 13813 [--profile PATH] [--out PATH] [--browser-url URL]");
  process.exitCode = 1;
} else {
  const origin = "https://weslah.seha.sa";
  const output = resolve(option("--out") || `results/bundles/${Date.now()}`);
  const profile = resolve(
    option("--profile") ||
      (process.env.USER_PROFILE_PATH
        ? join(process.env.USER_PROFILE_PATH, "Profile 1")
        : "results/bundle-browser-profile"),
  );
  const endpoint = option("--browser-url");
  const manifest = new Map();
  const sources = new Map();
  const pending = new Set();
  const failed = new Map();
  let browser;
  let page;
  let responseHandler;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const isAsset = (url) => {
    try {
      const u = new URL(url);
      return u.origin === origin && /\.(?:m?js|css)$/i.test(u.pathname);
    } catch { return false; }
  };
  const save = async (url, body, contentType, source) => {
    if (/text\/html/i.test(contentType) || /^\s*<(?:!doctype|html)/i.test(body)) {
      throw new Error("HTML returned instead of bundle source");
    }
    const u = new URL(url);
    const base = u.pathname.split("/").pop().replace(/[^a-zA-Z0-9_.-]/g, "_");
    const hash = createHash("sha256").update(url).digest("hex").slice(0, 12);
    const file = `${hash}-${base}`;
    await writeFile(join(output, file), body, "utf8");
    sources.set(url, body);
    manifest.set(url, { url, file, contentType, source });
    failed.delete(url);
  };
  try {
    await mkdir(output, { recursive: true });
    console.log(endpoint
      ? "Connecting to Chrome; the existing browser will remain open."
      : `Opening browser profile: ${profile}\nStop the bot first if it uses this same profile.`);
    browser = endpoint
      ? await puppeteer.connect({ browserURL: endpoint })
      : await puppeteer.launch({
          headless: false,
          userDataDir: profile,
          ...(process.env.CHROME_EXECUTABLE_PATH
            ? { executablePath: process.env.CHROME_EXECUTABLE_PATH }
            : {}),
        });
    page = await browser.newPage();
    responseHandler = (response) => {
      const url = response.url();
      if (!isAsset(url)) return;
      const task = (async () => {
        try {
          if (!response.ok()) throw new Error(`HTTP ${response.status()}`);
          await save(url, await response.text(), response.headers()["content-type"] || "", "render");
        } catch (error) { failed.set(url, error.message); }
      })();
      pending.add(task);
      task.finally(() => pending.delete(task));
    };
    page.on("response", responseHandler);
    await page.goto("https://seha.sa/#/Dashboard", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await rl.question("Complete login if needed, open Services > Wasla so its session is ready, then press Enter here. ");
    await page.goto(`${origin}/facility-referrals/view/${caseId}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await rl.question("Wait for the case page to finish rendering, then press Enter to collect the remaining bundle imports. ");
    await Promise.allSettled([...pending]);

    // Include script/style resources already loaded, including cached assets.
    const resources = await page.evaluate(() => [
      ...performance.getEntriesByType("resource").map((e) => e.name),
      ...Array.from(document.querySelectorAll("script[src],link[href]"), (e) => e.src || e.href),
    ]);
    const queue = new Set(resources.filter(isAsset));
    const scanned = new Set();
    let downloaded = 0;
    for (;;) {
      for (const [url, body] of sources) {
        if (scanned.has(url)) continue;
        scanned.add(url);
        // Vite static/dynamic imports, preload map and CSS @import/url refs.
        for (const match of body.matchAll(/["']((?:\.\.?\/|\/|assets\/)[^"'\s]+\.(?:m?js|css)(?:\?[^"'\s]*)?)["']/g)) {
          const ref = match[1];
          const dependency = new URL(ref, ref.startsWith("assets/") ? origin + "/" : url).href;
          if (isAsset(dependency)) queue.add(dependency);
        }
      }
      const url = [...queue].find((u) => !manifest.has(u) && !failed.has(u));
      if (!url) break;
      if (++downloaded > 500) {
        console.warn("Stopped at 500 dependency downloads; review the manifest.");
        break;
      }
      try {
        const asset = await page.evaluate(async (url) => {
          const response = await fetch(url, { credentials: "include" });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return { body: await response.text(), contentType: response.headers.get("content-type") || "" };
        }, url);
        await save(url, asset.body, asset.contentType, "dependency");
      } catch (error) { failed.set(url, error.message); }
    }
    console.log(`Saved ${manifest.size} assets; ${failed.size} failed. Folder: ${output}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    if (page && responseHandler) page.off("response", responseHandler);
    await Promise.allSettled([...pending]);
    await writeFile(join(output, "manifest.json"), JSON.stringify({
      caseId, collectedAt: new Date().toISOString(),
      files: [...manifest.values()],
      failures: [...failed].map(([url, error]) => ({ url, error })),
    }, null, 2)).catch(() => {});
    rl.close();
    if (browser) {
      if (endpoint) {
        await page?.close().catch(() => {});
        browser.disconnect();
      } else await browser.close();
    }
  }
}
