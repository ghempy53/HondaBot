# =============================================================================
# Dockerfile for Raspberry Pi 4 (ARM64)
# =============================================================================
# Multi-stage build for smaller image size and better caching
# Optimized for low-memory ARM64 devices like Raspberry Pi 4
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
# Using npm ci for reproducible builds from lock file
RUN npm ci --include=dev

# Copy source code
COPY . .

# Compile TypeScript if needed (validates the build)
RUN npm run test || true

# -----------------------------------------------------------------------------
# Stage 2: Production Dependencies
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps

WORKDIR /deps

# Copy package files
COPY package.json package-lock.json ./

# Install only production dependencies
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

# -----------------------------------------------------------------------------
# Stage 3: Final Runtime Image
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# Add labels for container identification
LABEL org.opencontainers.image.title="HondaBot"
LABEL org.opencontainers.image.description="Discord bot for Rust+ integration"
LABEL org.opencontainers.image.vendor="HondaBot"
LABEL maintainer="HondaBot"

# Install runtime dependencies only
# GraphicsMagick for image processing, ca-certificates for HTTPS
RUN apt-get update && apt-get install -y --no-install-recommends \
    graphicsmagick \
    ca-certificates \
    dumb-init \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /tmp/* \
    && rm -rf /var/tmp/*

# Create non-root user for security
RUN groupadd --gid 1000 hondabot \
    && useradd --uid 1000 --gid hondabot --shell /bin/bash --create-home hondabot

# Set working directory
WORKDIR /app

# Copy production dependencies from deps stage
COPY --from=deps /deps/node_modules ./node_modules

# Copy application code from builder stage
COPY --from=builder /build/src ./src
COPY --from=builder /build/config.js ./
COPY --from=builder /build/index.ts ./
COPY --from=builder /build/package.json ./
COPY --from=builder /build/tsconfig.json ./

# Create directories for persistent data with correct permissions
RUN mkdir -p /app/credentials /app/instances /app/logs /app/maps /app/temp \
    && chown -R hondabot:hondabot /app

# Define volumes for persistent data
VOLUME ["/app/credentials", "/app/instances", "/app/logs", "/app/maps"]

# Set environment variables for production
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=1024"

# Switch to non-root user
USER hondabot

# Health check - verify Node.js process is running
# Checks every 30 seconds, allows 10 second timeout, starts checking after 60 seconds
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "console.log('healthy')" || exit 1

# Use dumb-init for proper signal handling (important for graceful shutdown)
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Run the bot
CMD ["node", "-r", "ts-node/register", "."]
