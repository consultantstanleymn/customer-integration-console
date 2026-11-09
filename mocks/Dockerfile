# One image for both mocks. Pick with the command: src/oidc.ts or src/source.ts.
# Build from the repo root:  docker build -f mocks/Dockerfile -t cic-mocks .
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY mocks/package.json mocks/
COPY web/package.json web/
RUN npm ci --workspace mocks --omit=dev && npm cache clean --force
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /opt/yarn-*
COPY mocks/src mocks/src
USER node
CMD ["node_modules/.bin/tsx", "mocks/src/oidc.ts"]
