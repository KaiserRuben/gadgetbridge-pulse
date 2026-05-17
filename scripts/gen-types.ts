#!/usr/bin/env tsx
/**
 * Regenerates lib/types/generated.d.ts from runner/src/schemas/{v2,training}/*.schema.json
 * using `json-schema-to-typescript` (runtime API).
 *
 * Run via `npm run gen:types`.
 *
 * Schema directories scanned in order; each emits a section header so the
 * resulting .d.ts is greppable by source directory.
 */
import { readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compileFromFile } from "json-schema-to-typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SCHEMA_DIRS: Array<{ label: string; path: string }> = [
  { label: "v2", path: resolve(__dirname, "..", "runner", "src", "schemas", "v2") },
  { label: "training", path: resolve(__dirname, "..", "runner", "src", "schemas", "training") },
  { label: "nutrition", path: resolve(__dirname, "..", "runner", "src", "schemas", "nutrition") },
];
const OUT_FILE = resolve(__dirname, "..", "lib", "types", "generated.d.ts");

async function main(): Promise<void> {
  const parts: string[] = [
    "// AUTO-GENERATED FILE — do not edit.",
    "// Source: runner/src/schemas/{v2,training}/*.schema.json",
    "// Run `npm run gen:types` to regenerate.",
    "",
  ];

  let totalFiles = 0;

  for (const dir of SCHEMA_DIRS) {
    const files = readdirSync(dir.path)
      .filter((f) => f.endsWith(".schema.json"))
      .sort();

    if (files.length === 0) {
      // eslint-disable-next-line no-console
      console.warn(`[gen:types] no schemas in ${dir.path}, skipping`);
      continue;
    }

    parts.push(`// ════════ ${dir.label} ════════`);
    parts.push("");

    for (const file of files) {
      const path = resolve(dir.path, file);
      const ts = await compileFromFile(path, {
        bannerComment: "",
        additionalProperties: false,
        strictIndexSignatures: true,
        $refOptions: {
          dereference: { circular: false },
        },
      });
      parts.push(`// ── ${dir.label}/${file} ──`);
      parts.push(ts.trim());
      parts.push("");
      totalFiles += 1;
    }
  }

  if (totalFiles === 0) {
    throw new Error("No *.schema.json files found in any schema directory");
  }

  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, parts.join("\n"));
  // eslint-disable-next-line no-console
  console.log(`[gen:types] wrote ${OUT_FILE} (${totalFiles} schemas)`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
