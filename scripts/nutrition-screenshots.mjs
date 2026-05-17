/**
 * Screenshot harness for the nutrition UI design pass.
 *
 * Drives a single Chromium instance through every nutrition route at three
 * widths × two themes and writes the resulting PNGs to
 *   docs/screenshots/nutrition/<route>-<theme>-<width>.png
 *
 * Theme switching: next-themes stores its choice in localStorage under the
 * key `theme` (attribute=class). We seed that value before navigation so the
 * server-rendered HTML hydrates against the correct mode.
 *
 * Run with:  node scripts/nutrition-screenshots.mjs
 */

import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "docs", "screenshots", "nutrition");
const BASE = "http://localhost:3030";

const routes = [
  { name: "index", path: "/nutrition" },
  { name: "day-today", path: "/nutrition/2026-05-17" },
  { name: "meal-bowl1", path: "/nutrition/meal/seed-bowl1" },
  { name: "meal-desert", path: "/nutrition/meal/seed-desert" },
  { name: "meal-drink", path: "/nutrition/meal/seed-drink" },
  { name: "trends", path: "/nutrition/trends" },
  { name: "targets", path: "/nutrition/targets" },
  { name: "log", path: "/nutrition/log" },
];

const widths = [390, 768, 1280];
const themes = ["dark", "light"];

const browser = await chromium.launch();

for (const theme of themes) {
  for (const w of widths) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: Math.max(900, w + 200) },
      deviceScaleFactor: 1,
      colorScheme: theme === "dark" ? "dark" : "light",
    });
    // Seed next-themes choice so hydration matches the desired theme.
    await ctx.addInitScript((t) => {
      try {
        window.localStorage.setItem("theme", t);
      } catch {
        // localStorage unavailable; SSR/cookie path falls back to default.
      }
    }, theme);

    const page = await ctx.newPage();

    for (const r of routes) {
      const url = `${BASE}${r.path}`;
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
        // Force the theme attribute in case the localStorage seed beat the
        // ThemeProvider mount in the strict SSR case.
        await page.evaluate((t) => {
          document.documentElement.classList.remove("dark", "light");
          document.documentElement.classList.add(t);
          document.documentElement.style.colorScheme = t;
        }, theme);
        // Let motion settle.
        await page.waitForTimeout(450);
        const file = path.join(OUT_DIR, `${r.name}-${theme}-${w}.png`);
        await page.screenshot({ path: file, fullPage: true });
        console.log(`✓ ${r.name}-${theme}-${w}`);
      } catch (err) {
        console.warn(`! ${r.name}-${theme}-${w}: ${err.message}`);
      }
    }

    await ctx.close();
  }
}

await browser.close();
console.log("done.");
