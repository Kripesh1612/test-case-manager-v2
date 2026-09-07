# syntax=docker/dockerfile:1.7
# =============================================================================
# Test Case Manager — production image
# -----------------------------------------------------------------------------
# Two stages:
#   1. `deps`  — install ALL deps (incl. devDependencies so the Prisma CLI
#                is available for `migrate deploy` at container start). Runs
#                on a slim Debian+Node base so the install layer is small.
#   2. `runner`— copy the prebuilt node_modules + source onto the official
#                `cypress/included` Debian image so Phase 8's spawned
#                Electron browser can actually start (Alpine's musl fails
#                with "Error relocating … cairo_restore: symbol not found").
#
# Why `cypress/included:13.17.0` as the runner base:
#   Phase 8 spawns Cypress as a child process against a real headless
#   browser. Cypress's bundled Electron binary is glibc-linked and on
#   Alpine (musl) it dies at startup. `cypress/included` ships a
#   Debian image with Node 22 + Cypress + every system dep pre-installed
#   (libgtk, libnss, libdrm, fonts, …), so the spawned browser actually
#   starts. We still ship our own `cypress` from package.json — the
#   bundled binary is what `node_modules/.bin/cypress` dispatches to.
# =============================================================================

FROM node:22-bookworm-slim AS deps
WORKDIR /app

# Prisma's engine needs openssl at runtime; install it here so the
# generated Prisma client + CLI work in the deps stage too.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Copy ONLY the manifest + lockfile first so this layer caches when
# only source code changes. Then copy the Prisma schema so `prisma
# generate` (run by Prisma's postinstall) can read it before we copy
# the rest of the source.
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci

# =============================================================================

FROM cypress/included:13.17.0 AS runner
WORKDIR /app

# cypress/included already ships `node` (uid 1000). Reuse it.
ENV NODE_ENV=production \
    PORT=3001

# Bring in the fully-installed node_modules from the deps stage
# (includes the generated Prisma client and the `prisma` CLI for
# migrate deploy).
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
# React client build (built locally with `npm run build -w client`
# before `docker compose build app` so the image can serve the SPA
# from /assets).
COPY client/dist ./client/dist

# /app/storage holds Cypress run artifacts (stdout.log, stderr.log,
# result.json). The executor writes here at run time — the
# pre-existing permission issue documented in tcm-storage-permission.md
# won't bite again if /app/storage is created with the right owner
# at image build time.
RUN mkdir -p /app/storage && chown -R node:node /app/storage

# Entrypoint waits for Postgres, applies migrations, then starts the
# server.
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER node
EXPOSE 3001

# Healthcheck pings the same /health endpoint Cypress exercises.
# start-period bumped to 25s because the cypress/included base is
# bigger to pull than the Alpine one — the first boot can be slow.
HEALTHCHECK --interval=10s --timeout=3s --start-period=25s --retries=5 \
  CMD wget --quiet --tries=1 --spider http://localhost:3001/health || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "index.js"]
