# Game server image (the static site deploys separately, e.g. on Vercel).
#   docker build -t chancla-server .
#   docker run -p 8787:8787 -e ALLOWED_ORIGINS=https://chancla.vercel.app chancla-server
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts ./
COPY shared ./shared
COPY server ./server
RUN npm run build:server

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist-server ./dist-server
USER node
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/readyz || exit 1
# node is PID 1 and handles SIGTERM itself (graceful shutdown).
CMD ["node", "dist-server/index.js"]
