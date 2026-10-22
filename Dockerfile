# FloodFirst: API + indexer + the built web app, one container (works on Render, Fly, Railway, any Docker host).
# Build from the repository root:  docker build -t floodfirst .
FROM node:22-slim AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web ./
# Same-origin API (VITE_API_URL unset): the API server serves this build.
RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY services/package*.json services/
RUN cd services && npm ci --omit=dev && npm i --no-save tsx
COPY services services
COPY deployments deployments
COPY --from=web /app/web/dist web/dist
ENV NODE_ENV=production DATABASE_PATH=/tmp/floodfirst.sqlite
# The platform sets PORT (Render uses 10000); the server reads it when API_PORT is not set.
EXPOSE 10000
WORKDIR /app/services
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "fetch('http://localhost:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "src/main.ts"]
