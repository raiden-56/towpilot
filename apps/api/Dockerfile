# syntax=docker/dockerfile:1.7
# TowPilot API — multi-stage build. Build from the repository root:
#   docker build -f apps/api/Dockerfile -t towpilot-api .
FROM node:22-bookworm-slim AS deps
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace apps/api --include-workspace-root --ignore-scripts

FROM deps AS build
COPY apps/api apps/api
RUN npx --workspace apps/api prisma generate --schema apps/api/prisma/schema.prisma \
 && npm run build -w apps/api

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini && rm -rf /var/lib/apt/lists/* \
 && groupadd -r towpilot && useradd -r -g towpilot towpilot
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/prisma ./prisma
COPY --from=build /repo/apps/api/package.json ./package.json
RUN mkdir -p /app/storage && chown -R towpilot:towpilot /app/storage
USER towpilot
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:4000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
# Apply pending migrations, then start. Run a single migrating replica in multi-instance deployments.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
