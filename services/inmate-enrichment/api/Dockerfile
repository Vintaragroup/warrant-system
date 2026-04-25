FROM node:20-alpine
WORKDIR /app
# Copy entire monorepo so workspaces can build
COPY . .
# Install deps (including dev) for building, then prune dev deps for smaller image
RUN (npm ci || npm install) \
 && npm run -w shared build \
 && npm run -w api build \
 && npm prune --omit=dev
EXPOSE 4000
CMD ["node", "api/dist/index.js"]
