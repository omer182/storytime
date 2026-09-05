# Build context is the storytime/ project root (see docker-compose.yml / the
# GitHub Actions workflow), so this can pull in the sibling ui/ project too -
# the final image is one process serving both the API and the built UI.

# ---- server: install deps + compile TypeScript ----
FROM node:20-slim AS server-base
# build tools needed to compile better-sqlite3's native binding
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server

FROM server-base AS server-build
COPY server/package*.json ./
RUN npm ci
COPY server/. .
RUN npm run build

FROM server-base AS server-prod-deps
COPY server/package*.json ./
RUN npm ci --omit=dev

# ---- ui: compile + bundle TypeScript ----
FROM node:20-slim AS ui-build
WORKDIR /app/ui
COPY ui/package*.json ./
RUN npm ci
COPY ui/. .
RUN npm run build

# ---- runtime: lean image, no build tools or dev deps ----
FROM node:20-slim AS runtime
WORKDIR /app/server

COPY --from=server-prod-deps /app/server/node_modules ./node_modules
COPY server/package.json ./
COPY --from=server-build /app/server/dist ./dist
COPY server/src/data ./src/data

COPY ui/index.html /app/ui/index.html
COPY ui/styles.css /app/ui/styles.css
COPY ui/hero-reading.jpg /app/ui/hero-reading.jpg
COPY ui/figure-images /app/ui/figure-images
COPY --from=ui-build /app/ui/app.js /app/ui/app.js
COPY --from=ui-build /app/ui/app.js.map /app/ui/app.js.map

ENV PORT=3000
EXPOSE 3000

CMD ["node", "dist/server.js"]
