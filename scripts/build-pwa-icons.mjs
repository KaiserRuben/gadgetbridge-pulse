// One-shot rasterizer: SVG -> PNG via `sharp`.
// Run: node scripts/build-pwa-icons.mjs
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const pub  = resolve(here, "..", "public");

const targets = [
  { src: "favicon.svg",        out: "icon-192.png",            size: 192 },
  { src: "favicon.svg",        out: "icon-512.png",            size: 512 },
  { src: "favicon.svg",        out: "apple-touch-icon.png",    size: 180 },
  { src: "icon-maskable.svg",  out: "icon-maskable-192.png",   size: 192 },
  { src: "icon-maskable.svg",  out: "icon-maskable-512.png",   size: 512 },
];

for (const t of targets) {
  const svg = await readFile(resolve(pub, t.src));
  const png = await sharp(svg, { density: 384 })
    .resize(t.size, t.size, { fit: "contain", background: { r: 10, g: 10, b: 10, alpha: 1 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(resolve(pub, t.out), png);
  console.log(`wrote ${t.out} (${t.size}x${t.size}, ${png.byteLength} bytes)`);
}
