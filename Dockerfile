
# syntax=docker/dockerfile:1.7
# Pulse v4 dashboard — vanilla Next.js standalone build.
#
# The dashboard is pure SSR: every page calls `noStore()` and re-reads
# insight JSON / pulse.db on each request, so there's no custom server,
# no websocket broker, no realtime layer. The Next-generated
# `.next/standalone/server.js` is the runtime entry point.
#
# Targets:
#   linux/arm64 (Mac dev host)
#   linux/arm64 (Raspberry Pi)

FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ libsqlite3-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ── Deps stage ───────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --include=dev

# ── Builder stage ────────────────────────────────────────────────────────────
FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `npm run build` chain: next build → post-build (copy public + static).
# Then strip caches we don't need at runtime.
RUN npm run build \
    && rm -rf .next/cache .next/trace \
    && rm -rf .next/standalone/.next/cache .next/standalone/.next/trace

# The Next standalone tracer ships a minimal copy of `next` based on what
# the auto-generated server.js imports. Replace it with the full module so
# RSC features (programmatic API, SWC native binary) resolve at runtime.
RUN set -eux; \
    rm -rf .next/standalone/node_modules/next; \
    mkdir -p .next/standalone/node_modules/@next; \
    cp -r node_modules/next .next/standalone/node_modules/next; \
    # Platform-specific native SWC binary lives in @next/swc-linux-*. The
    # standalone tracer skips it because the binary path is resolved at
    # runtime from optionalDependencies, not via a static `require()`.
    for pkg in node_modules/@next/*; do \
      name="$(basename "$pkg")"; \
      cp -r "$pkg" ".next/standalone/node_modules/@next/$name"; \
    done

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates libsqlite3-0 \
    && rm -rf /var/lib/apt/lists/* \
    && addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 --ingroup nodejs nextjs

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3030
# `nextjs` user has no home dir (--no-create-home); next tries to mkdir
# $HOME/.cache/next-swc on first config load and EACCES on /nonexistent.
# Point HOME at a writable location.
ENV HOME=/tmp

# Standalone bundle includes traced node_modules + the Next-generated
# server.js + public + static. No full node_modules, no tsx.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./

USER nextjs
EXPOSE 3030
CMD ["node", "server.js"]
