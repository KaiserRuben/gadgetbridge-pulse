"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { GpsMap as GpsMapType } from "./gps-map";

// Leaflet imports `window` at module evaluation. Loading the map only on the
// client avoids an SSR ReferenceError while keeping the parent route a
// Server Component.
const GpsMapLazy = dynamic(() => import("./gps-map").then((m) => m.GpsMap), {
  ssr: false,
  loading: () => (
    <div className="h-[420px] grid place-items-center text-caption text-subtle">
      Karte lädt…
    </div>
  ),
});

export function GpsMapClient(props: ComponentProps<typeof GpsMapType>) {
  return <GpsMapLazy {...props} />;
}
