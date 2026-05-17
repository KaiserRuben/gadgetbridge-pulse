import { NextResponse } from "next/server";

/**
 * Design-pass photo placeholders. Returns a deterministic SVG so meal
 * cards have something to render before the real `/api/nutrition/photo/[id]`
 * route ships with the runner. Hue is derived from the meal id slug so
 * different meals get visually distinct cards.
 *
 * Real photos arrive via Stage 5b of NUTRITION_PLAN — this file goes away
 * (or starts returning a 404) once those routes are wired up.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const slug = name.replace(/\.[a-z]+$/i, "");

  // Hash the slug into a hue so each meal gets a distinct warm tone.
  let h = 0;
  for (let i = 0; i < slug.length; i++) {
    h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  const hue2 = (hue + 40) % 360;
  const hue3 = (hue + 220) % 360;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice">
  <defs>
    <radialGradient id="g1" cx="30%" cy="20%" r="80%">
      <stop offset="0%" stop-color="hsl(${hue} 64% 56%)" stop-opacity="0.9"/>
      <stop offset="55%" stop-color="hsl(${hue2} 60% 42%)" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="hsl(${hue3} 36% 14%)" stop-opacity="1"/>
    </radialGradient>
    <radialGradient id="g2" cx="70%" cy="80%" r="70%">
      <stop offset="0%" stop-color="hsl(${hue2} 72% 60%)" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="hsl(${hue3} 30% 12%)" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grain" width="6" height="6" patternUnits="userSpaceOnUse">
      <rect width="6" height="6" fill="transparent"/>
      <circle cx="1" cy="1" r="0.5" fill="hsl(0 0% 0% / 0.18)"/>
      <circle cx="4" cy="3" r="0.4" fill="hsl(0 0% 100% / 0.08)"/>
    </pattern>
  </defs>
  <rect width="800" height="600" fill="url(#g1)"/>
  <rect width="800" height="600" fill="url(#g2)"/>
  <g opacity="0.55">
    <circle cx="220" cy="180" r="120" fill="hsl(${hue2} 58% 48% / 0.45)"/>
    <circle cx="560" cy="380" r="160" fill="hsl(${hue} 62% 36% / 0.4)"/>
    <ellipse cx="640" cy="160" rx="90" ry="50" fill="hsl(${hue2} 72% 64% / 0.35)"/>
  </g>
  <rect width="800" height="600" fill="url(#grain)" opacity="0.55"/>
</svg>`;

  return new NextResponse(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
