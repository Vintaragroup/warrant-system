# server/Dockerfile
# Multi-stage build for Node API (Express)

FROM node:20-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

# Install only production deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy source
COPY src ./src
COPY src/openapi.yaml ./openapi.yaml

# Expose port and start
EXPOSE 8080
CMD ["node", "src/index.js"]
