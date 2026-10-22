# API + indexer (+ optional oracle loop). Build from the repository root: docker build -f services/Dockerfile -t floodfirst-api .
FROM node:22-slim
WORKDIR /app
COPY services/package*.json services/
RUN cd services && npm ci --omit=dev && npm i tsx
COPY services services
COPY deployments deployments
ENV NODE_ENV=production DATABASE_PATH=/data/floodfirst.sqlite
VOLUME /data
EXPOSE 8787
WORKDIR /app/services
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "src/main.ts"]
