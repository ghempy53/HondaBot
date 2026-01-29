# =============================================================================
# Dockerfile for Raspberry Pi 4 (ARM64)
# =============================================================================
# Multi-stage build optimized for ARM64 devices like Raspberry Pi 4
# - Pre-compiles TypeScript for faster startup and lower memory usage
# - Uses slim base image to reduce size
# - Runs as non-root user for security
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Dependencies Builder
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder

# Install build dependencies needed for native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy package files first for better layer caching
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies for TypeScript compilation)
RUN npm ci --include=dev

# Copy source code
COPY . .

# Compile TypeScript to JavaScript for production
RUN NODE_OPTIONS="--max-old-space-size=2048" npm run build

# -----------------------------------------------------------------------------
# Stage 2: Production Dependencies
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps

WORKDIR /deps

COPY package.json package-lock.json ./

RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

# -----------------------------------------------------------------------------
# Stage 3: Final Runtime Image
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

LABEL org.opencontainers.image.title="HondaBot"
LABEL org.opencontainers.image.description="Discord bot for Rust+ integration"

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    graphicsmagick \
    ca-certificates \
    dumb-init \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd --gid 1000 hondabot \
    && useradd --uid 1000 --gid hondabot --shell /bin/bash --create-home hondabot

WORKDIR /app

# Copy production dependencies
COPY --from=deps /deps/node_modules ./node_modules

# Copy compiled JavaScript
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/package.json ./

# Copy runtime resources
COPY --from=builder /build/src/resources ./src/resources
COPY --from=builder /build/src/languages ./src/languages
COPY --from=builder /build/config.j[s]* ./

# Create data directories
RUN mkdir -p /app/credentials /app/instances /app/logs /app/maps /app/temp \
    && chown -R hondabot:hondabot /app

VOLUME ["/app/credentials", "/app/instances", "/app/logs", "/app/maps"]

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=1024"

USER hondabot

HEALTHCHECK --interval=60s --timeout=10s --start-period=120s --retries=3 \
    CMD node -e "console.log('healthy')" || exit 1

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/index.js"]
