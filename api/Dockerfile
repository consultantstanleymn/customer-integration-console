# Build from the repo root:  docker build -f api/Dockerfile -t cic-api .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY mocks/package.json mocks/
COPY web/package.json web/
RUN npm ci --workspace api --include-workspace-root
COPY tsconfig.base.json ./
COPY api api
RUN npm run build -w api

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY mocks/package.json mocks/
COPY web/package.json web/
RUN npm ci --workspace api --omit=dev && npm cache clean --force
COPY --from=build /app/api/dist api/dist
COPY api/migrations api/migrations
COPY api/sql api/sql
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1:4000/health || exit 1
CMD ["node", "api/dist/server.js"]
