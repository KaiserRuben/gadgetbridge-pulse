#!/usr/bin/env node
/**
 * Pulse v3 dashboard screenshot harness.
 *
 * Spins up headless Chromium via Playwright, walks a list of routes
 * across multiple viewports, and writes PNGs into tmp/screenshots/.
 *
 * The Next.js dev server must already be running on http://localhost:3030.
 */

import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const outDir = path.join(repoRoot, "tmp", "screenshots");

const BASE_URL = process.env.PULSE_BASE_URL ?? "http://localhost:3030";
const RICH_DATE = "2026-05-09";
const ABSTAIN_DATE = "2026-05-04";

const routes = [
  { path: "/", slug: "home" },
  { path: `/?date=${RICH_DATE}`, slug: "home-with-rich-date-param" },
  { path: `/?date=${ABSTAIN_DATE}`, slug: "home-with-abstain-date-param" },
  { path: `/day/${RICH_DATE}`, slug: `day-${RICH_DATE}` },
  { path: `/day/${ABSTAIN_DATE}`, slug: `day-${ABSTAIN_DATE}` },
  { path: `/sleep/${RICH_DATE}`, slug: `sleep-${RICH_DATE}` },
  { path: `/recovery/${RICH_DATE}`, slug: `recovery-${RICH_DATE}` },
  { path: `/activity/${RICH_DATE}`, slug: `activity-${RICH_DATE}` },
  { path: "/week/2026-W19", slug: "week-2026-W19" },
  { path: "/explore", slug: "explore" },
];

const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "desktop", width: 1440, height: 900 },
];

const consoleEntries = [];
const networkIssues = [];
const captureLog = [];

function ts() {
  return new Date().toISOString().split("T")[1].replace("Z", "");
}

function log(...args) {
  console.log(`[${ts()}]`, ...args);
}

async function ensureOutDir() {
  await fs.mkdir(outDir, { recursive: true });
}

async function captureRoute(browser, route, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });
  const page = await context.newPage();

  const localConsole = [];
  const localNetwork = [];

  page.on("console", (msg) => {
    const type = msg.type();
    if (type === "error" || type === "warning") {
      const entry = {
        route: route.path,
        viewport: viewport.name,
        type,
        text: msg.text(),
      };
      consoleEntries.push(entry);
      localConsole.push(entry);
    }
  });

  page.on("pageerror", (err) => {
    const entry = {
      route: route.path,
      viewport: viewport.name,
      type: "pageerror",
      text: err.message,
    };
    consoleEntries.push(entry);
    localConsole.push(entry);
  });

  page.on("response", (response) => {
    const status = response.status();
    if (status >= 400) {
      const entry = {
        route: route.path,
        viewport: viewport.name,
        status,
        url: response.url(),
      };
      networkIssues.push(entry);
      localNetwork.push(entry);
    }
  });

  const fileName = `${route.slug}--${viewport.name}.png`;
  const filePath = path.join(outDir, fileName);
  let pageStatus = null;
  let error = null;

  try {
    const response = await page.goto(`${BASE_URL}${route.path}`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    pageStatus = response?.status() ?? null;

    // Wait for network to settle but don't fail if it never does
    try {
      await page.waitForLoadState("networkidle", { timeout: 10_000 });
    } catch (_) {
      // Continue anyway — some routes keep websockets open.
    }

    // Give React/charts a beat to paint.
    await page.waitForTimeout(750);

    await page.screenshot({
      path: filePath,
      fullPage: true,
      animations: "disabled",
    });
  } catch (err) {
    error = err.message;
  } finally {
    await context.close();
  }

  const stat = await fs.stat(filePath).catch(() => null);
  const entry = {
    route: route.path,
    slug: route.slug,
    viewport: viewport.name,
    file: fileName,
    bytes: stat?.size ?? 0,
    status: pageStatus,
    error,
    consoleIssues: localConsole.length,
    networkIssues: localNetwork.length,
  };
  captureLog.push(entry);
  log(
    `${route.path}@${viewport.name} -> ${fileName} (${stat?.size ?? 0}B, http=${pageStatus}, console=${localConsole.length}, net=${localNetwork.length})${error ? ` ERR=${error}` : ""}`
  );
}

async function main() {
  await ensureOutDir();
  const browser = await chromium.launch({ headless: true });
  log(`Launched Chromium, base=${BASE_URL}, output=${outDir}`);
  try {
    for (const route of routes) {
      for (const viewport of viewports) {
        await captureRoute(browser, route, viewport);
      }
    }
  } finally {
    await browser.close();
  }

  // Persist a JSON manifest for downstream review.
  const manifest = {
    base: BASE_URL,
    generatedAt: new Date().toISOString(),
    captures: captureLog,
    consoleEntries,
    networkIssues,
  };
  await fs.writeFile(
    path.join(outDir, "_manifest.json"),
    JSON.stringify(manifest, null, 2)
  );

  log(
    `Done. Captures=${captureLog.length}, console issues=${consoleEntries.length}, network issues=${networkIssues.length}.`
  );
}

main().catch((err) => {
  console.error("screenshot-pulse failed:", err);
  process.exit(1);
});
