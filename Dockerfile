FROM node:20-slim AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json package-lock.json turbo.json ./
COPY packages/core/package.json packages/core/
COPY packages/gateway/package.json packages/gateway/
COPY packages/chains/package.json packages/chains/
COPY packages/wallet/package.json packages/wallet/
COPY packages/skills/package.json packages/skills/
COPY packages/skills-sdk/package.json packages/skills-sdk/
COPY packages/agent/package.json packages/agent/
COPY packages/pipeline/package.json packages/pipeline/
COPY packages/agent-sdk/package.json packages/agent-sdk/
COPY packages/marketplace/package.json packages/marketplace/
COPY packages/data-pipeline/package.json packages/data-pipeline/
COPY apps/server/package.json apps/server/
RUN npm ci

# Build
FROM deps AS builder
COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/ apps/
RUN npx turbo build

# Production
FROM base AS runner
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/gateway/dist ./packages/gateway/dist
COPY --from=builder /app/packages/gateway/package.json ./packages/gateway/
COPY --from=builder /app/packages/chains/dist ./packages/chains/dist
COPY --from=builder /app/packages/chains/package.json ./packages/chains/
COPY --from=builder /app/packages/wallet/dist ./packages/wallet/dist
COPY --from=builder /app/packages/wallet/package.json ./packages/wallet/
COPY --from=builder /app/packages/skills/dist ./packages/skills/dist
COPY --from=builder /app/packages/skills/package.json ./packages/skills/
COPY --from=builder /app/packages/skills-sdk/dist ./packages/skills-sdk/dist
COPY --from=builder /app/packages/skills-sdk/package.json ./packages/skills-sdk/
COPY --from=builder /app/packages/agent/dist ./packages/agent/dist
COPY --from=builder /app/packages/agent/package.json ./packages/agent/
COPY --from=builder /app/packages/pipeline/dist ./packages/pipeline/dist
COPY --from=builder /app/packages/pipeline/package.json ./packages/pipeline/
COPY --from=builder /app/packages/agent-sdk/dist ./packages/agent-sdk/dist
COPY --from=builder /app/packages/agent-sdk/package.json ./packages/agent-sdk/
COPY --from=builder /app/packages/marketplace/dist ./packages/marketplace/dist
COPY --from=builder /app/packages/marketplace/package.json ./packages/marketplace/
COPY --from=builder /app/packages/data-pipeline/dist ./packages/data-pipeline/dist
COPY --from=builder /app/packages/data-pipeline/package.json ./packages/data-pipeline/
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/server/package.json ./apps/server/
COPY --from=builder /app/package.json ./

RUN mkdir -p /app/data/wallets /app/data/skills

EXPOSE 8080 9090

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:9090/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "apps/server/dist/index.js"]
