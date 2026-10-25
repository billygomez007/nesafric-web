# NesAfric web on Google Cloud Run. Build: see cloudbuild.yaml and docs/cloud-run-deployment.md.
# Two targets share the dependency layer:
#   runner  - the traced Next.js standalone server (the Cloud Run service)
#   migrate - Prisma CLI + migrations, run as a Cloud Run job before each rollout

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
# postinstall runs `prisma generate` into src/platform/database/generated.
RUN mkdir -p src/platform/database && npm ci --no-audit --no-fund

FROM deps AS builder
COPY . .
# NEXT_PUBLIC_* values are inlined into the browser bundle at build time, so they are build args.
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_GTM_ID
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_GTM_ID=$NEXT_PUBLIC_GTM_ID \
    NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build

FROM deps AS migrate
ENV NODE_ENV=production
CMD ["npx", "prisma", "migrate", "deploy"]

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=8080
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 8080
# Cloud Run sends SIGTERM and waits 10 s; the Next.js server finishes in-flight requests and
# pending after() callbacks (the WhatsApp reply path) before it exits.
CMD ["node", "server.js"]
