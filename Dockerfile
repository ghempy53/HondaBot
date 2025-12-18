# Use ARM64 Node base image
FROM arm64v8/node:22-bookworm

# Install dependencies (GraphicsMagick if needed)
RUN apt-get update \
 && apt-get install -y graphicsmagick \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files and install
COPY package.json package-lock.json ./
RUN npm install

# Copy all local code
COPY . .

# Expose volumes for persistent data
VOLUME [ "/app/credentials", "/app/instances", "/app/logs", "/app/maps" ]

# Run bot
CMD ["npm", "start", "run"]
