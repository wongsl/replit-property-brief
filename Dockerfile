# ---- Stage 1: Build ----
FROM node:20-slim AS builder
WORKDIR /app

# Install build dependencies
COPY package*.json ./
RUN npm ci

# Copy all source files
COPY . .

# Build the frontend (Vite) and bundle the server (esbuild)
RUN npm run build

# ---- Stage 2: Production ----
FROM node:20-slim AS runner
WORKDIR /app

# Copy package manifests and install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Construct DATABASE_URL from individual components at runtime
# (components are injected as env vars by ECS task definition)
CMD ["sh", "-c", "export DATABASE_URL=\"postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}\" && node dist/index.cjs"]
