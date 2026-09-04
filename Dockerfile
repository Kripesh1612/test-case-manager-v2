# syntax=docker/dockerfile:1.7
# =============================================================================
# Test Case Manager — production image
# -----------------------------------------------------------------------------
# Stage 1 (`deps`): install ALL deps (incl. devDependencies so the Prisma CLI
# is available for `migrate deploy` at container start).
# Stage 2 (`runner`): copy the prebuilt node_modules + source, expose the
# port, and run migrations before starting the server.
# =============================================================================

FROM node:22-alpine AS deps
WORKDIR /app

# Prisma's engine on Alpine needs libc6-compat + openssl; bcrypt has no native
# build but the Prisma engine does. Keep these here so the runner stage can
# rely on them too.
RUN apk add --no-cache libc6-compat openssl

# Copy ONLY the manifest + lockfile first so this layer caches when only
# source code changes. Then copy the Prisma schema so `prisma generate` (run
# by Prisma's postinstall) can read it before we copy the rest of the source.
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci

# =============================================================================

FROM node:22-alpine AS runner
WORKDIR /app

RUN apk add --no-cache libc6-compat openssl \
 && addgroup -S tcm && adduser -S tcm -G tcm

ENV NODE_ENV=production \
    PORT=3001

# Bring in the fully-installed node_modules from the deps stage (includes the
# generated Prisma client and the `prisma` CLI for migrate deploy).
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma

# Source code — kept small and explicit
COPY index.js ./
COPY config.js ./
COPY db.js ./
COPY routes ./routes
COPY middleware ./middleware
COPY utils ./utils
COPY shared ./shared
COPY public ./public
# React client build (built locally with `npm run build -w client` before
# `docker compose build app` so the image can serve the SPA from /assets).
COPY client/dist ./client/dist

# Entrypoint waits for Postgres, applies migrations, then starts the server.
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER tcm
EXPOSE 3001

# Healthcheck pings the same /health endpoint Cypress exercises.
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD wget --quiet --tries=1 --spider http://localhost:3001/health || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "index.js"]
