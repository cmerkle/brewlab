# syntax=docker/dockerfile:1
# ---------- Stage 1: build frontend + API ----------
FROM node:24-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.server.json tsconfig.web.json vite.config.ts ./
COPY src ./src
RUN npm run build

# ---------- Stage 2: runtime ----------
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=7642 \
    TZ=UTC
# tzdata for the Monday 8 a.m. local refresh; tesseract for the no-key photo OCR fallback.
RUN apk add --no-cache tzdata tesseract-ocr tesseract-ocr-data-eng
COPY package.json package-lock.json ./
# Production dependencies only (toolchain present just long enough to build better-sqlite3 if needed).
RUN apk add --no-cache --virtual .build python3 make g++ \
 && npm ci --omit=dev \
 && npm cache clean --force \
 && apk del .build
COPY --from=build /app/dist ./dist
COPY seed-data ./seed-data
# The gear & recipe library (data, not code).
COPY catalog ./catalog
# Fictional demo data for first-run "Explore with demo data".
COPY demo ./demo
# Host files may lack world-read (e.g. mode 660); the app runs as `node`, so make them readable.
RUN chmod -R a+rX /app/dist /app/seed-data /app/catalog /app/demo \
 && mkdir -p /data/uploads && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 7642
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1
CMD ["node", "dist/server.js"]
