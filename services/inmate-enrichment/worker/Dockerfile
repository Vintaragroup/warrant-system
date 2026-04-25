FROM node:20-alpine
WORKDIR /app
COPY . .
RUN (npm ci || npm install) \
 && npm run -w shared build \
 && npm run -w worker build \
 && npm prune --omit=dev
CMD ["node", "worker/dist/index.js"]
