FROM node:22-alpine AS base
RUN apk add --no-cache python3 make g++ sqlite-dev unzip
WORKDIR /app

COPY runner/package.json runner/package-lock.json* ./
RUN npm ci --include=dev

# Source mounted at runtime in dev (volume); copied in prod builds
# COPY runner/src ./src

ENV NODE_ENV=production

# Default: watch mode (launchd handles restart)
CMD ["node", "--import", "tsx/esm", "src/index.ts", "watch"]
