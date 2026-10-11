import dotenv from "dotenv";
dotenv.config({ quiet: true });
import puppeteer from "puppeteer";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";

// Saves source files only. Downloaded bundles are never imported or executed
// by this script; visiting the portal runs its normal UI code in Chrome.
const args = process.argv.slice(2);
const [caseId] = args;
if (args.length !== 1 || !caseId || !/^\d+$/.test(caseId)) {
  console.error("Usage: yarn collect-bundles 13813");
  process.exitCode = 1;
} else if (!process.env.USER_PROFILE_PATH) {
  console.error("USER_PROFILE_PATH is required to reuse the app's logged-in browser profile.");
  process.exitCode = 1;
} else {
  const origin = "https://weslah.seha.sa";
  const output = resolve(`results/bundles/${caseId}-${Date.now()}`);
  const profile = resolve(join(process.env.USER_PROFILE_PATH, "Profile 1"));
  const manifest = new Map();
  const sources = new Map();
  const pending = new Set();
  const failed = new Map();
  let browser;
  let page;
  let responseHandler;
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
    console.log(`Opening the app's saved browser session for case ${caseId}.`);
    browser = await puppeteer.launch({
          headless: false,
          userDataDir: profile,
          defaultViewport: null,
          pipe: true,
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
    // Observe before navigation so even a fast/cached details response counts.
    const detailsLoaded = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.origin === origin && url.pathname === `/api/referrals/${caseId}`;
    }, { timeout: 30_000 }).then((response) => ({ response }), (error) => ({ error }));
    await page.goto(`${origin}/facility-referrals/view/${caseId}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const details = await detailsLoaded;
    if (details.error) {
      throw new Error("The case details did not load. Check that the saved Wasla session is active and this case is accessible.");
    }
    if (!details.response.ok()) {
      throw new Error(`Case details returned HTTP ${details.response.status()}; bundle capture is incomplete.`);
    }
    await details.response.text();
    await page.waitForNetworkIdle({ idleTime: 1000, timeout: 15_000 }).catch(() => {
      console.log("Background requests are still active; collecting loaded assets and their imports.");
    });
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
    if (/already running|ProcessSingleton|SingletonLock/i.test(error.message)) {
      console.error("Stop the bot/Chrome using USER_PROFILE_PATH, then rerun this command. The saved login is retained.");
    }
    process.exitCode = 1;
  } finally {
    if (page && responseHandler) page.off("response", responseHandler);
    await Promise.allSettled([...pending]);
    await writeFile(join(output, "manifest.json"), JSON.stringify({
      caseId, collectedAt: new Date().toISOString(),
      files: [...manifest.values()],
      failures: [...failed].map(([url, error]) => ({ url, error })),
    }, null, 2)).catch(() => {});
    if (browser) {
      await browser.close();
    }
  }
}
