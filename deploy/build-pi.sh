#!/usr/bin/env bash
# Build Pulse v4 dashboard on the Pi (no docker).
#
# Runs out of $REPO (default `$PWD`), the Syncthing-replicated clone.
# Produces .next/standalone with the vanilla Next-generated server.js.
# The dashboard is pure SSR — no custom server, no websocket layer.
#
# Usage:
#   REPO=/path/to/pulse bash deploy/build-pi.sh
set -eu

REPO="${REPO:-$PWD}"
cd "$REPO"

echo "[1/4] npm ci (incl dev deps for build)"
npm ci --include=dev

echo "[2/4] next build"
npm run build

echo "[3/4] swap in full next + @next/swc native binary"
rm -rf .next/standalone/node_modules/next
cp -r node_modules/next .next/standalone/node_modules/next
mkdir -p .next/standalone/node_modules/@next
for pkg in node_modules/@next/*; do
  [ -d "$pkg" ] && cp -r "$pkg" ".next/standalone/node_modules/@next/$(basename "$pkg")"
done

echo "[4/4] prune devDeps to reclaim disk"
npm prune --omit=dev

echo "Done. Standalone bundle ready at $REPO/.next/standalone"
du -sh .next/standalone
