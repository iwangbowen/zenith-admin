# ─── Stage 1: Build all packages ─────────────────────────────────────────────
FROM node:24-alpine AS builder

WORKDIR /app

# node-pty (packages/server dependency, used by the web terminal feature) ships
# no prebuilt binary for Linux and must be compiled via node-gyp, which needs
# Python + a C/C++ toolchain. This stage is discarded after build, so no cleanup
# is needed here.
RUN apk add --no-cache python3 make g++

# Copy workspace manifests first (leverages Docker layer cache)
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/analytics-sdk/package.json ./packages/analytics-sdk/
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json ./packages/web/

# Install all dependencies
RUN npm ci

# Copy source code
COPY tsconfig.base.json ./
COPY docker/build-studio.mjs docker/patch-shared-exports.mjs ./docker/
COPY packages/shared ./packages/shared
COPY packages/analytics-sdk ./packages/analytics-sdk
COPY packages/server ./packages/server
COPY packages/web ./packages/web

# Build: shared → analytics-sdk → server → web
RUN npm run build -w @zenith/shared \
 && npm run build -w @zenith/analytics-sdk \
 && npm run build -w @zenith/server \
 && npm run build -w @zenith/web

# Mastra Studio 静态资源:产出到 web dist 子目录,随 web 产物一起进 Nginx 镜像
# (版本由根 devDependencies 的 mastra 包管理;同源部署,鉴权由 API 侧强制)
RUN node docker/build-studio.mjs packages/web/dist/studio

# Patch shared package.json so Node.js can resolve @zenith/shared at runtime.
# The source package.json exports TypeScript files (for tsx dev), which plain
# Node.js cannot execute. After the build, we switch exports to the compiled dist
# (directory entries like "./analytics" map to "./dist/analytics/index.js").
RUN node docker/patch-shared-exports.mjs packages/shared

# ─── Stage 2: Server production image ────────────────────────────────────────
FROM node:24-alpine AS server

WORKDIR /app

# Copy workspace manifests for production dependency install
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/analytics-sdk/package.json ./packages/analytics-sdk/
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json ./packages/web/

# node-pty has no Linux prebuild and is compiled via node-gyp during install.
# libstdc++ is kept permanently (the compiled native addon links against it at
# runtime); python3/make/g++ are only needed to build it, so they're installed
# as a removable virtual group and dropped again once `npm ci` finishes to keep
# the production image lean.
RUN apk add --no-cache libstdc++ \
 && apk add --no-cache --virtual .build-deps python3 make g++ \
 && npm ci --omit=dev \
 && apk del .build-deps

# Overwrite shared package.json with the patched version (exports → dist/)
# and copy compiled shared JS (the symlink target needs the dist files)
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist

# Copy compiled server, Drizzle migration files and bundled runtime assets (CJK font for PDF export)
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/packages/server/drizzle ./packages/server/drizzle
COPY --from=builder /app/packages/server/assets ./packages/server/assets

WORKDIR /app/packages/server

# Local file storage / logs (bind-mounted volumes inherit this ownership on first creation);
# the service runs as the unprivileged `node` user shipped with the base image.
RUN mkdir -p storage logs && chown -R node:node /app/packages/server/storage /app/packages/server/logs

COPY docker/entrypoint.sh /entrypoint.sh
# Strip Windows CRLF line endings (safe no-op on Linux)
RUN sed -i 's/\r//' /entrypoint.sh && chmod +x /entrypoint.sh

USER node

EXPOSE 3300

ENTRYPOINT ["/entrypoint.sh"]

# ─── Stage 3: Web frontend served by Nginx ───────────────────────────────────
FROM nginx:1.30-alpine AS web

# Copy compiled static assets from the builder
COPY --from=builder /app/packages/web/dist /usr/share/nginx/html

# Copy nginx virtual host config
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
