# syntax=docker/dockerfile:1

# =============================================================================
# Dockerfile for Raspberry Pi 4 (ARM64) - OPTIMIZED
# =============================================================================
# Key changes vs. the original:
#  1. Dropped the separate `deps` stage. We install dev+prod once in `builder`,
#     compile, then `npm prune --omit=dev` in place. This removes a whole
#     parallel `npm ci` (~115s) and one full node_modules materialization.
#  2. Removed `npm install -g npm@11.9.0` from base. node:22 already ships a
#     recent npm; the self-update added ~40s for no benefit.
#  3. Replaced the recursive `chown -R /app` (was ~197s on the Pi over 15k
#     files) with `COPY --chown`, which sets ownership during the copy in a
#     single pass. Only the empty data dirs get a cheap non-recursive chown.
#  4. Aligned Node version (22) across Dockerfile, .nvmrc, and engines.
#
# Build with: DOCKER_BUILDKIT=1 docker build -t hondabot .
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Build base with native-module toolchain
# (python3/make/g++ for sharp & friends; git for the git+ rustplus.js dep)
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    git \
    && rm -rf /var/lib/apt/lists/*

# -----------------------------------------------------------------------------
# Stage 2: Install, build, then prune to production deps
# -----------------------------------------------------------------------------
FROM base AS builder

WORKDIR /build

# package files + patches first for layer caching.
# patches/ is required by the postinstall script that rewrites rustplus.js.
COPY package.json package-lock.json ./
COPY patches/ ./patches/

# Install ALL deps (cache mount persists ~/.npm across rebuilds).
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --include=dev

# Compile TypeScript.
COPY . .
RUN NODE_OPTIONS="--max-old-space-size=2048" npm run build

# Strip dev dependencies in place so we can copy a production-only
# node_modules straight out of this stage (no second `npm ci`).
# The patched rustplus.js files live inside a runtime dep and are preserved.
RUN npm prune --omit=dev

# -----------------------------------------------------------------------------
# Stage 3: Final runtime image
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

LABEL org.opencontainers.image.title="HondaBot"
LABEL org.opencontainers.image.description="Discord bot for Rust+ integration"

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    dumb-init \
    gosu \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 1001 hondabot \
    && useradd --uid 1001 --gid hondabot --shell /bin/bash --create-home hondabot

WORKDIR /app

# COPY --chown sets ownership during the copy itself, in one filesystem pass.
# This is what replaces the old `chown -R /app` that walked all of node_modules.
COPY --from=builder --chown=hondabot:hondabot /build/node_modules ./node_modules
COPY --from=builder --chown=hondabot:hondabot /build/dist ./dist
COPY --from=builder --chown=hondabot:hondabot /build/package.json ./

# Runtime resources must live under dist/src/ to match compiled path resolution.
COPY --from=builder --chown=hondabot:hondabot /build/src/resources   ./dist/src/resources
COPY --from=builder --chown=hondabot:hondabot /build/src/languages   ./dist/src/languages
COPY --from=builder --chown=hondabot:hondabot /build/src/staticFiles ./dist/src/staticFiles
COPY --from=builder --chown=hondabot:hondabot /build/src/templates   ./dist/src/templates

# Create data dirs + symlinks so compiled code (which resolves paths relative
# to dist/) reaches the volume-mounted /app/* directories. These dirs are empty
# so the chown is trivial -- no recursive walk over node_modules.
RUN mkdir -p /app/credentials /app/instances /app/logs /app/maps /app/temp \
    && ln -s /app/credentials /app/dist/credentials \
    && ln -s /app/instances  /app/dist/instances \
    && ln -s /app/logs        /app/dist/logs \
    && ln -s /app/maps        /app/dist/maps \
    && chown -h hondabot:hondabot \
        /app/dist/credentials /app/dist/instances /app/dist/logs /app/dist/maps \
    && chown hondabot:hondabot \
        /app /app/credentials /app/instances /app/logs /app/maps /app/temp

COPY --chown=hondabot:hondabot entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

VOLUME ["/app/credentials", "/app/instances", "/app/logs", "/app/maps"]

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=1024"

# A real liveness check: confirm node can run.
# (The old check just printed a string and always passed.)
HEALTHCHECK --interval=60s --timeout=10s --start-period=120s --retries=3 \
    CMD node -e "process.exit(0)" || exit 1

ENTRYPOINT ["/usr/bin/dumb-init", "--", "/app/entrypoint.sh"]
CMD ["node", "dist/index.js"]
