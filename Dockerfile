# ─── Stage 1: Build all packages ─────────────────────────────────────────────
FROM node:24-alpine AS builder

WORKDIR /app

# Copy workspace manifests first (leverages Docker layer cache)
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json ./packages/web/

# Install all dependencies
RUN npm ci

# Copy source code
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/server ./packages/server
COPY packages/web ./packages/web

# Build: shared → server → web
RUN npm run build -w @zenith/shared \
 && npm run build -w @zenith/server \
 && npm run build -w @zenith/web

# Patch shared package.json so Node.js can resolve @zenith/shared at runtime.
# The source package.json exports TypeScript files (for tsx dev), which plain
# Node.js cannot execute. After the build, we switch exports to the compiled dist.
RUN node -e "\
  var fs = require('fs'); \
  var p = JSON.parse(fs.readFileSync('packages/shared/package.json', 'utf8')); \
  p.main = './dist/index.js'; \
  p.exports = { '.': './dist/index.js', './*': './dist/*.js' }; \
  fs.writeFileSync('packages/shared/package.json', JSON.stringify(p, null, 2)); \
"

# ─── Stage 2: Server production image ────────────────────────────────────────
FROM node:22-alpine AS server

WORKDIR /app

# Copy workspace manifests for production dependency install
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json ./packages/web/

# Install production dependencies only.
# This creates node_modules/@zenith/shared symlink → packages/shared
RUN npm ci --omit=dev

# Overwrite shared package.json with the patched version (exports → dist/)
# and copy compiled shared JS (the symlink target needs the dist files)
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist

# Copy compiled server and Drizzle migration files
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/packages/server/drizzle ./packages/server/drizzle

WORKDIR /app/packages/server

# Create directory for local file storage (used when STORAGE_PROVIDER=local)
RUN mkdir -p storage

COPY docker/entrypoint.sh /entrypoint.sh
# Strip Windows CRLF line endings (safe no-op on Linux)
RUN sed -i 's/\r//' /entrypoint.sh && chmod +x /entrypoint.sh

EXPOSE 3300

ENTRYPOINT ["/entrypoint.sh"]

# ─── Stage 3: Web frontend served by Nginx ───────────────────────────────────
FROM nginx:1.27-alpine AS web

# Copy compiled static assets from the builder
COPY --from=builder /app/packages/web/dist /usr/share/nginx/html

# Copy nginx virtual host config
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
