"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { motion } from "motion/react";

import { Glyph, type GlyphName } from "@/components/ui/glyph";
import { Stat } from "@/components/ui/stat";
import { cn } from "@/lib/cn";

export type Coord = { lat: number; lon: number };

type LayerKey = "osm" | "topo" | "off";
type Tone = "activity" | "heart" | "sleep";

const LAYERS: Record<LayerKey, { url: string | null; attribution: string; label: string }> = {
  osm: {
    url: process.env.NEXT_PUBLIC_PULSE_MAP_TILES_URL ?? "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution:
      process.env.NEXT_PUBLIC_PULSE_MAP_TILES_ATTRIBUTION ??
      '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    label: "Karte",
  },
  topo: {
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution:
      '© <a href="https://opentopomap.org">OpenTopoMap</a> (© <a href="https://www.openstreetmap.org/copyright">OSM</a>)',
    label: "Gelände",
  },
  off: { url: null, attribution: "", label: "Aus" },
};

const TONE_HEX: Record<Tone, string> = {
  activity: "#22c55e",
  heart:    "#f43f5e",
  sleep:    "#7c3aed",
};

const STORAGE_KEY = "pulse:map:layer";

/**
 * GPS trail map with custom dark-tinted basemap + synced elevation profile.
 *
 * Privacy: the OSM/Topo basemap fetches tiles from public servers (your IP
 * is visible to them per request). Pick "Aus" to render only the trail on a
 * clean surface — fully local, no network traffic.
 *
 * Map UI:
 *   - Top-left: km-offset input ("0", "5.2", "max", "min").
 *   - Top-right: custom zoom + fit-bounds buttons (matching our chip style).
 *   - Bottom-left: privacy footnote when basemap active.
 *   - Bottom-right: layer toggle (Karte / Gelände / Aus).
 *
 * Cross-sync:
 *   - Hover elevation profile → marker on map.
 *   - Hover map polyline → highlighted x-position on profile.
 *
 * Tile filter: a CSS filter inverts + desaturates OSM tiles so they live in
 * our dark surface tokens. Topo gets a slightly softer treatment.
 */
export function GpsMap({
  points,
  elevations,
  tone = "activity",
  height = 420,
  className,
}: {
  points: Coord[];
  elevations?: Array<number | null>;
  tone?: Tone;
  height?: number;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const polyline = useRef<L.Polyline | null>(null);
  const cursorMarker = useRef<L.CircleMarker | null>(null);
  const tileLayer = useRef<L.TileLayer | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [layer, setLayer] = useState<LayerKey>("osm");
  const [searchInput, setSearchInput] = useState("");
  const [pulseAt, setPulseAt] = useState<{ lat: number; lon: number; key: number } | null>(null);

  // Read persisted layer choice (client-only).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "osm" || saved === "topo" || saved === "off") setLayer(saved);
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, layer);
  }, [layer]);

  // Init map once + draw trail.
  useEffect(() => {
    if (!mapRef.current || map.current) return;
    if (points.length < 2) return;

    const m = L.map(mapRef.current, {
      zoomControl: false,
      scrollWheelZoom: true,
      attributionControl: false,
      preferCanvas: false, // SVG renderer so we can hover the polyline.
    });
    map.current = m;

    const latlngs = points.map((p) => [p.lat, p.lon] as [number, number]);
    polyline.current = L.polyline(latlngs, {
      color: TONE_HEX[tone],
      weight: 3.5,
      opacity: 0.95,
      lineCap: "round",
      lineJoin: "round",
    }).addTo(m);

    // Map → profile sync (hover polyline → snap profile cursor to nearest pt).
    polyline.current.on("mousemove", (ev: L.LeafletMouseEvent) => {
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < points.length; i++) {
        const dLat = points[i].lat - ev.latlng.lat;
        const dLon = points[i].lon - ev.latlng.lng;
        const d = dLat * dLat + dLon * dLon;
        if (d < bestDist) { bestDist = d; best = i; }
      }
      setHoverIdx(best);
    });
    polyline.current.on("mouseout", () => setHoverIdx(null));

    // Start (hollow) + end (filled) markers with bounce-in.
    const startMarker = L.circleMarker(latlngs[0], {
      radius: 6, color: TONE_HEX[tone], fillColor: "#ffffff",
      weight: 2, fillOpacity: 1, className: "pulse-start",
    }).addTo(m);
    const endMarker = L.circleMarker(latlngs[latlngs.length - 1], {
      radius: 6, color: TONE_HEX[tone], fillColor: TONE_HEX[tone],
      weight: 2, fillOpacity: 1, className: "pulse-end",
    }).addTo(m);
    [startMarker, endMarker].forEach((mk) => {
      const el = mk.getElement();
      if (el instanceof SVGElement) {
        el.style.transformOrigin = "center";
        el.style.transform = "scale(0)";
        el.style.transition = "transform 360ms cubic-bezier(0.34, 1.56, 0.64, 1)";
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            el.style.transform = "scale(1)";
          });
        });
      }
    });

    m.fitBounds(L.latLngBounds(latlngs), { padding: [28, 28] });

    return () => {
      m.remove();
      map.current = null;
      polyline.current = null;
      cursorMarker.current = null;
      tileLayer.current = null;
    };
  }, [points, tone]);

  // Apply / swap tile layer when `layer` changes (or after init).
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (tileLayer.current) {
      m.removeLayer(tileLayer.current);
      tileLayer.current = null;
    }
    const cfg = LAYERS[layer];
    if (!cfg.url) return;
    tileLayer.current = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: layer === "topo" ? 17 : 19,
      className: layer === "topo" ? "pulse-tile pulse-tile-topo" : "pulse-tile",
    }).addTo(m);
    // Trail must stay above tiles.
    polyline.current?.bringToFront();
  }, [layer]);

  // Sync hover marker position.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (hoverIdx == null || hoverIdx < 0 || hoverIdx >= points.length) {
      if (cursorMarker.current) {
        cursorMarker.current.remove();
        cursorMarker.current = null;
      }
      return;
    }
    const p = points[hoverIdx];
    if (!cursorMarker.current) {
      cursorMarker.current = L.circleMarker([p.lat, p.lon], {
        radius: 7, color: TONE_HEX[tone], fillColor: TONE_HEX[tone],
        weight: 2, fillOpacity: 0.9,
      }).addTo(m);
    } else {
      cursorMarker.current.setLatLng([p.lat, p.lon]);
    }
  }, [hoverIdx, points, tone]);

  // Pulse animation when search jumps to a point.
  useEffect(() => {
    if (!pulseAt || !map.current) return;
    const m = map.current;
    const ring = L.circleMarker([pulseAt.lat, pulseAt.lon], {
      radius: 8, color: TONE_HEX[tone], weight: 2, fill: false,
    }).addTo(m);
    const el = ring.getElement();
    if (el instanceof SVGElement) {
      el.style.transformOrigin = "center";
      el.style.animation = "gpsMapPulse 900ms ease-out forwards";
    }
    const timer = window.setTimeout(() => ring.remove(), 1000);
    return () => {
      window.clearTimeout(timer);
      ring.remove();
    };
  }, [pulseAt, tone]);

  // Distance-along-track + min/max indices for search.
  const distSeries = useMemo(() => {
    if (points.length === 0) return null;
    const R = 6_371_000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const cum: number[] = new Array(points.length).fill(0);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const dLat = toRad(b.lat - a.lat);
      const dLon = toRad(b.lon - a.lon);
      const sa = Math.sin(dLat / 2);
      const so = Math.sin(dLon / 2);
      const h = sa * sa + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * so * so;
      cum[i] = cum[i - 1] + 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    }
    let minEle = Infinity, maxEle = -Infinity, minIdx = 0, maxIdx = 0, ascent = 0, descent = 0;
    if (elevations && elevations.length === points.length) {
      for (let i = 0; i < points.length; i++) {
        const e = elevations[i];
        if (e == null) continue;
        if (e < minEle) { minEle = e; minIdx = i; }
        if (e > maxEle) { maxEle = e; maxIdx = i; }
        if (i > 0) {
          const prev = elevations[i - 1];
          if (prev != null) {
            const d = e - prev;
            if (d > 0) ascent += d;
            else descent -= d;
          }
        }
      }
    }
    return {
      cum,
      totalM: cum[cum.length - 1],
      minEle: Number.isFinite(minEle) ? minEle : null,
      maxEle: Number.isFinite(maxEle) ? maxEle : null,
      minIdx,
      maxIdx,
      ascent: Math.round(ascent),
      descent: Math.round(descent),
    };
  }, [points, elevations]);

  // Helpers for the map control buttons.
  const onZoomIn  = () => map.current?.zoomIn();
  const onZoomOut = () => map.current?.zoomOut();
  const onFit     = () => {
    if (!map.current || points.length < 2) return;
    const latlngs = points.map((p) => [p.lat, p.lon] as [number, number]);
    map.current.fitBounds(L.latLngBounds(latlngs), { padding: [28, 28] });
  };

  function jumpTo(idx: number) {
    const m = map.current;
    if (!m || idx < 0 || idx >= points.length) return;
    const p = points[idx];
    m.setView([p.lat, p.lon], Math.max(m.getZoom(), 16), { animate: true });
    setHoverIdx(idx);
    setPulseAt({ lat: p.lat, lon: p.lon, key: Date.now() });
  }

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!distSeries) return;
    const raw = searchInput.trim().toLowerCase();
    if (!raw) return;
    if (raw === "max" && distSeries.maxIdx != null) { jumpTo(distSeries.maxIdx); return; }
    if (raw === "min" && distSeries.minIdx != null) { jumpTo(distSeries.minIdx); return; }
    const km = Number.parseFloat(raw.replace(",", "."));
    if (!Number.isFinite(km) || km < 0) return;
    const targetM = km * 1000;
    let lo = 0, hi = distSeries.cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (distSeries.cum[mid] < targetM) lo = mid + 1;
      else hi = mid;
    }
    jumpTo(lo);
  }

  if (points.length < 2) return null;

  const cfg = LAYERS[layer];

  return (
    <div ref={containerRef} className={cn("flex flex-col", className)}>
      {/* MAP */}
      <div className="relative">
        <div
          ref={mapRef}
          style={{ width: "100%", height, background: "var(--color-surface-2)" }}
          className="overflow-hidden rounded-t-[var(--radius-card)]"
        />
        {/* Tile filter + pulse animation styles. Scoped via the .pulse-tile class. */}
        <style jsx global>{`
          .leaflet-container { background: var(--color-bg-elevated); font-family: inherit; }
          .pulse-tile {
            filter: invert(0.92) hue-rotate(180deg) saturate(0.45) brightness(0.95) contrast(1.05);
          }
          .pulse-tile-topo {
            filter: invert(0.85) hue-rotate(180deg) saturate(0.55) brightness(1) contrast(0.92);
          }
          @keyframes gpsMapPulse {
            0%   { transform: scale(0.6); opacity: 0.85; }
            100% { transform: scale(2.6); opacity: 0; }
          }
        `}</style>

        {/* Top-left: search input */}
        <form
          onSubmit={onSearch}
          className="absolute top-3 left-3 z-[400] flex items-center gap-1.5 rounded-[var(--radius-chip)] bg-[var(--color-surface)]/95 backdrop-blur px-2.5 py-1.5 border border-[var(--color-border-strong)] shadow-[var(--shadow-pop)]"
        >
          <Glyph name="Compass" size={13} className="text-subtle" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="km / max / min"
            inputMode="decimal"
            className="w-24 sm:w-[110px] bg-transparent outline-none text-[0.75rem] sm:text-[0.8125rem] num-mono placeholder:text-[var(--color-text-faint)]"
          />
        </form>

        {/* Top-right: zoom + fit buttons */}
        <div className="absolute top-3 right-3 z-[400] flex flex-col gap-1.5">
          <ChipButton onClick={onZoomIn} icon="ChevronRight" rotate={-90} label="Zoom +" />
          <ChipButton onClick={onZoomOut} icon="ChevronRight" rotate={90} label="Zoom −" />
          <ChipButton onClick={onFit} icon="Compass" label="Track einrahmen" />
        </div>

        {/* Bottom-right: layer toggle */}
        <div className="absolute bottom-3 right-3 z-[400] flex items-center gap-0.5 rounded-[var(--radius-chip)] bg-[var(--color-surface)]/95 backdrop-blur p-0.5 border border-[var(--color-border-strong)] shadow-[var(--shadow-pop)]">
          {(["osm", "topo", "off"] as LayerKey[]).map((k) => {
            const active = layer === k;
            return (
              <button
                key={k}
                onClick={() => setLayer(k)}
                className={cn(
                  "px-2.5 py-1 text-[0.75rem] rounded-[calc(var(--radius-chip)-2px)] transition-colors",
                  active
                    ? "bg-[var(--color-surface-2)] text-[var(--color-text)]"
                    : "text-subtle hover:text-[var(--color-text)]",
                )}
              >
                {LAYERS[k].label}
              </button>
            );
          })}
        </div>

        {/* Bottom-left: privacy hint + attribution */}
        {cfg.url && (
          <div className="absolute bottom-3 left-3 z-[400] flex items-center gap-1.5 text-caption text-subtle pr-3 max-w-[60%]">
            <Glyph name="Sparkles" size={11} />
            <span className="text-[10.5px] leading-tight">
              Kacheln öffentlich geladen — IP sichtbar.
              <span
                className="ml-1 opacity-70"
                dangerouslySetInnerHTML={{ __html: cfg.attribution }}
              />
            </span>
          </div>
        )}
      </div>

      {/* STATS + ELEVATION PROFILE */}
      {distSeries && (
        <div className="bg-[var(--color-surface)] border-t border-[var(--color-border)]">
          {/* Stat row */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 px-4 md:px-5 py-4">
            <Stat label="Distanz" value={(distSeries.totalM / 1000).toFixed(2)} unit="km" />
            <Stat label="↑ Anstieg" value={distSeries.ascent || "—"} unit="m" />
            <Stat label="↓ Abstieg" value={distSeries.descent || "—"} unit="m" />
            <Stat label="Max" value={distSeries.maxEle != null ? Math.round(distSeries.maxEle) : "—"} unit="m" />
            <Stat label="Min" value={distSeries.minEle != null ? Math.round(distSeries.minEle) : "—"} unit="m" />
          </div>
          <div className="border-t border-[var(--color-border)]">
            <ElevationProfile
              points={points}
              elevations={elevations ?? []}
              cum={distSeries.cum}
              totalM={distSeries.totalM}
              minEle={distSeries.minEle}
              maxEle={distSeries.maxEle}
              tone={tone}
              hoverIdx={hoverIdx}
              onHoverIdx={setHoverIdx}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ChipButton({
  onClick, icon, label, rotate = 0,
}: {
  onClick: () => void;
  icon: GlyphName;
  label: string;
  rotate?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid place-items-center size-9 rounded-[var(--radius-chip)] bg-[var(--color-surface)]/95 backdrop-blur border border-[var(--color-border-strong)] text-[var(--color-text)] hover:bg-[var(--color-surface-2)] shadow-[var(--shadow-pop)] transition-colors"
    >
      <span style={rotate ? { transform: `rotate(${rotate}deg)`, display: "inline-flex" } : undefined}>
        <Glyph name={icon} size={14} />
      </span>
    </button>
  );
}

function ElevationProfile({
  points, elevations, cum, totalM, minEle, maxEle, tone, hoverIdx, onHoverIdx,
}: {
  points: Coord[];
  elevations: Array<number | null>;
  cum: number[];
  totalM: number;
  minEle: number | null;
  maxEle: number | null;
  tone: Tone;
  hoverIdx: number | null;
  onHoverIdx: (idx: number | null) => void;
}) {
  const W = 1000;
  const H = 130;
  const pad = { l: 40, r: 12, t: 14, b: 22 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  const lo = minEle ?? 0;
  const hi = Math.max(maxEle ?? lo + 5, lo + 5);
  const xRange = totalM || 1;

  const projected = useMemo(() => {
    return points.map((p, i) => {
      const e = elevations[i];
      if (e == null) return null;
      return {
        idx: i,
        x: pad.l + (cum[i] / xRange) * innerW,
        y: pad.t + innerH - ((e - lo) / (hi - lo)) * innerH,
        e,
      };
    });
  }, [points, elevations, cum, xRange, lo, hi, pad.l, pad.t, innerW, innerH]);

  // Build line + per-segment fills (ascent vs descent).
  const segments = useMemo(() => {
    const ascentParts: string[] = [];
    const descentParts: string[] = [];
    let lastDir: "up" | "down" | null = null;
    for (let i = 1; i < projected.length; i++) {
      const a = projected[i - 1];
      const b = projected[i];
      if (!a || !b) continue;
      const dir: "up" | "down" = b.e > a.e ? "up" : "down";
      const baseY = pad.t + innerH;
      const seg = `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} L ${b.x.toFixed(1)} ${b.y.toFixed(1)} L ${b.x.toFixed(1)} ${baseY} L ${a.x.toFixed(1)} ${baseY} Z`;
      if (dir === "up") ascentParts.push(seg); else descentParts.push(seg);
      lastDir = dir;
    }
    void lastDir;
    return { ascentD: ascentParts.join(" "), descentD: descentParts.join(" ") };
  }, [projected, pad.t, innerH]);

  const linePath = useMemo(() => {
    let d = "";
    let started = false;
    for (const p of projected) {
      if (!p) continue;
      d += `${started ? "L" : "M"} ${p.x.toFixed(1)} ${p.y.toFixed(1)} `;
      started = true;
    }
    return d;
  }, [projected]);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const xLocal = ((e.clientX - rect.left) / rect.width) * W;
    if (xLocal < pad.l || xLocal > W - pad.r) {
      onHoverIdx(null);
      return;
    }
    const targetM = ((xLocal - pad.l) / innerW) * xRange;
    let l = 0, r = cum.length - 1;
    while (l < r) {
      const mid = (l + r) >> 1;
      if (cum[mid] < targetM) l = mid + 1;
      else r = mid;
    }
    onHoverIdx(l);
  }

  // Tooltip state
  const hoverPt = hoverIdx != null && projected[hoverIdx] ? projected[hoverIdx] : null;
  const hoverEle = hoverIdx != null ? elevations[hoverIdx] : null;
  const hoverDistKm = hoverIdx != null && cum[hoverIdx] != null ? cum[hoverIdx] / 1000 : null;

  const tickEles = (() => {
    const mid = Math.round((lo + hi) / 2);
    return [Math.round(lo), mid, Math.round(hi)];
  })();

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        onMouseMove={onMove}
        onMouseLeave={() => onHoverIdx(null)}
        style={{ display: "block", cursor: "crosshair" }}
        role="img"
        aria-label="Höhenprofil"
      >
        {/* y-axis ticks + grid */}
        {tickEles.map((e, i) => {
          const y = pad.t + innerH - ((e - lo) / (hi - lo || 1)) * innerH;
          return (
            <g key={i}>
              <line
                x1={pad.l} y1={y} x2={W - pad.r} y2={y}
                stroke="var(--color-border)" strokeOpacity={0.5} strokeDasharray="2 4"
              />
              <text
                x={pad.l - 6} y={y + 3} fontSize="9.5"
                fill="var(--color-text-faint)" textAnchor="end"
                style={{ fontFamily: "var(--font-mono, ui-monospace), monospace", letterSpacing: "0.02em" }}
              >
                {e}m
              </text>
            </g>
          );
        })}

        {/* Ascent fill (up segments, band-up tint) */}
        <path d={segments.ascentD} fill="var(--color-band-up)" fillOpacity={0.16} />
        {/* Descent fill (down segments, band-down tint) */}
        <path d={segments.descentD} fill="var(--color-band-down)" fillOpacity={0.14} />

        {/* Profile line */}
        <motion.path
          d={linePath}
          stroke={TONE_HEX[tone]}
          strokeWidth={1.75}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.0, ease: [0.16, 1, 0.3, 1] }}
        />

        {/* Hover crosshair */}
        {hoverPt && (
          <>
            <line
              x1={hoverPt.x} y1={pad.t} x2={hoverPt.x} y2={pad.t + innerH}
              stroke="var(--color-border-strong)" strokeWidth={1} strokeDasharray="3 3"
            />
            <circle cx={hoverPt.x} cy={hoverPt.y} r={3.5} fill={TONE_HEX[tone]} />
          </>
        )}

        {/* x labels */}
        <text x={pad.l} y={H - 5} fontSize="9.5" fill="var(--color-text-faint)" style={{ fontFamily: "var(--font-mono, ui-monospace), monospace" }}>0</text>
        <text x={W - pad.r} y={H - 5} fontSize="9.5" fill="var(--color-text-faint)" textAnchor="end" style={{ fontFamily: "var(--font-mono, ui-monospace), monospace" }}>
          {(totalM / 1000).toFixed(1)} km
        </text>
      </svg>

      {/* Tooltip — pop card style matching Timeline.tsx */}
      {hoverPt && hoverDistKm != null && (
        <div
          style={{
            position: "absolute",
            left: `${(hoverPt.x / W) * 100}%`,
            top: `${(hoverPt.y / H) * 100}%`,
            transform: "translate(-50%, calc(-100% - 12px))",
            pointerEvents: "none",
          }}
        >
          <div className="rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)]/95 px-3 py-2 text-caption shadow-[var(--shadow-pop)] whitespace-nowrap">
            {hoverEle != null && (
              <div className="num-mono text-[var(--color-text)]">{Math.round(hoverEle)} m</div>
            )}
            <div className="text-subtle num-mono">{hoverDistKm.toFixed(2)} km</div>
          </div>
        </div>
      )}
    </div>
  );
}
