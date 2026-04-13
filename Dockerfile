# Build stage with full Node.js
FROM node:24-bookworm-slim AS builder

RUN npm install -g pnpm@10

WORKDIR /app

ARG GITHUB_SHA
ENV GITHUB_SHA=${GITHUB_SHA}

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install all dependencies (including dev for build), skip prepare script
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy source code
COPY . .

# Build the application
RUN pnpm run build

# Compile TypeScript startup script and custom server to JavaScript
RUN pnpm exec tsc scripts/start-prod.ts --outDir scripts --module nodenext --moduleResolution nodenext --target es2022
RUN pnpm exec tsc server.ts auth-middleware.ts --module nodenext --moduleResolution nodenext --target es2022 --esModuleInterop

# Download fonts for PDF generation (react-pdf requires TTF format)
RUN mkdir -p /app/fonts && \
    apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \
    curl -sL "https://github.com/adobe-fonts/source-sans/raw/release/TTF/SourceSans3-Regular.ttf" -o /app/fonts/source-sans-3-regular.ttf && \
    curl -sL "https://github.com/adobe-fonts/source-sans/raw/release/TTF/SourceSans3-It.ttf" -o /app/fonts/source-sans-3-italic.ttf && \
    curl -sL "https://github.com/adobe-fonts/source-sans/raw/release/TTF/SourceSans3-Semibold.ttf" -o /app/fonts/source-sans-3-semibold.ttf && \
    apt-get remove -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

# Production dependencies only
FROM node:24-bookworm-slim AS prod-deps

RUN npm install -g pnpm@10

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

# Final stage with distroless
FROM gcr.io/distroless/nodejs24-debian12:nonroot

WORKDIR /app

# Copy package files
COPY --from=builder /app/package.json ./

# Copy production node_modules
COPY --from=prod-deps /app/node_modules ./node_modules

# Copy built application
COPY --from=builder /app/build ./build

# Copy fonts for PDF generation
COPY --from=builder /app/fonts ./fonts

# Copy migration files and config
COPY --from=builder /app/app/db/migrations ./app/db/migrations
COPY --from=builder /app/.node-pg-migrate.json ./

# Copy compiled startup script and custom server
COPY --from=builder /app/scripts/start-prod.js ./scripts/
COPY --from=builder /app/server.js ./
COPY --from=builder /app/auth-middleware.js ./

# Expose port (adjust based on your app)
EXPOSE 3000

# Run startup script that does migrations + starts server
CMD ["scripts/start-prod.js"]
