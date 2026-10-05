FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
ENV PUPPETEER_SKIP_DOWNLOAD=1
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-noto-core ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium PORT=8080
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/server/package.json ./server/
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/migrations ./server/migrations
COPY --from=build /app/web/dist ./web/dist
WORKDIR /app/server
EXPOSE 8080
CMD ["node", "dist/src/index.js"]
