# Build from the repo root:  docker build -f web/Dockerfile --build-arg API_URL=http://api:4000 -t cic-web .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY mocks/package.json mocks/
COPY web/package.json web/
RUN npm ci --workspace web --include-workspace-root
COPY tsconfig.base.json ./
COPY web web
# The /api proxy target is fixed at build time (Next.js rewrites).
ARG API_URL=http://api:4000
ENV API_URL=$API_URL NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w web

FROM node:22-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build /app/web/.next/standalone ./
COPY --from=build /app/web/.next/static web/.next/static
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /opt/yarn-*
USER node
EXPOSE 3000
CMD ["node", "web/server.js"]
