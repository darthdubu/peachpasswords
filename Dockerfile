FROM node:20-alpine AS builder

WORKDIR /app

# Copy root files
COPY package.json package-lock.json tsconfig.json ./

# Copy workspace packages
COPY packages/shared ./packages/shared
COPY packages/server ./packages/server
# We don't need extension for the server image

# Install dependencies
RUN npm ci

# Build shared
WORKDIR /app/packages/shared
RUN npm run build

# Build server
WORKDIR /app/packages/server
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy built artifacts and dependencies
# Note: This is a simplified approach. Ideally we'd prune devDependencies.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/server/dist ./dist
COPY --from=builder /app/packages/server/package.json ./
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json

# Environment variables
ENV PORT=8743
ENV HOST=0.0.0.0
ENV NODE_ENV=production

EXPOSE 8743

CMD ["node", "dist/index.js"]
