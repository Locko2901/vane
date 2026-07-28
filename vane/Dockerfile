# syntax=docker/dockerfile:1

FROM node:26-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM node:26-alpine AS backend
WORKDIR /app/backend
RUN apk add --no-cache openssl
COPY backend/package.json ./
RUN npm install
COPY backend/ ./
COPY prisma ./prisma
RUN npx prisma generate
RUN npm run build

FROM node:26-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    DDNS_CONFIG_DIR=/ddns-config

RUN apk add --no-cache openssl

COPY backend/package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY prisma ./prisma
COPY --from=backend /app/backend/node_modules/.prisma ./node_modules/.prisma
COPY --from=backend /app/backend/node_modules/@prisma ./node_modules/@prisma

COPY --from=backend /app/backend/dist ./dist
COPY --from=frontend /app/frontend/dist ./public

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

VOLUME ["/data", "/ddns-config"]
EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
