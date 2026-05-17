import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["better-sqlite3"],
  /**
   * Standalone output trims node_modules to traced deps only — without it,
   * the Pi image balloons past 1GB. `npm start` runs the vanilla
   * `.next/standalone/server.js` emitted by Next.
   */
  output: "standalone",
  typedRoutes: false
};

export default config;
