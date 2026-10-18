# API server only (the apps talk to it over HTTPS). Node 22.18+ runs the shared .ts files directly.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY shared ./shared
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server/index.mjs"]
