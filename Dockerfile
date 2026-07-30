# syntax=docker/dockerfile:1

##########
# 1. Base : Node 22 LTS sur Alpine + pnpm via corepack
##########
FROM node:22-alpine AS base
# openssl est requis par le moteur Prisma sur Alpine
RUN apk add --no-cache openssl
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

##########
# 2. Dependencies : installe toutes les deps (cache séparé du code)
##########
FROM base AS deps
# pnpm-workspace.yaml est INDISPENSABLE ici : depuis pnpm 11, il porte les réglages
# (allowBuilds, overrides). Les `overrides` sont inscrites dans le lockfile, donc une
# installation `--frozen-lockfile` sans ce fichier échoue sur
# ERR_PNPM_LOCKFILE_CONFIG_MISMATCH — le lockfile annonce des surcharges que la
# configuration copiée ne contient pas.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Cache du store pnpm pour des rebuilds rapides.
# --ignore-scripts : le postinstall (`prisma generate`) ne peut pas tourner ici (le
# schéma n'est pas encore copié) ; le client est généré au stage builder.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

##########
# 3. Builder : génère le client Prisma + build Next.js (standalone)
##########
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Génère le client Prisma à partir de prisma/schema.prisma
RUN pnpm prisma generate
# Build Next.js — nécessite `output: "standalone"` dans next.config
RUN pnpm build

##########
# 4. Runner : image finale minimale, non-root
##########
FROM base AS runner
ENV NODE_ENV=production
# Désactive la télémétrie Next.js
ENV NEXT_TELEMETRY_DISABLED=1

# Chromium système + polices : requis par la génération PDF des éditions (Puppeteer).
# On utilise le paquet Alpine plutôt que le Chromium bundlé (non téléchargé au build,
# cf. PUPPETEER_SKIP_DOWNLOAD). ttf-freefont/font-noto couvrent les accents FR.
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont font-noto
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_DOWNLOAD=true

# Client PostgreSQL (pg_dump/psql) : requis par l'onglet admin « Sauvegardes »
# (export à la volée + restauration). Version 17 = celle du service db.
RUN apk add --no-cache postgresql17-client

# Utilisateur non-root pour la sécurité
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# Output standalone de Next.js (serveur Node minimal + deps nécessaires)
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Prisma : schéma + migrations + config (Prisma 7 : URL/seed dans prisma.config.ts) +
# CLI/engine pour `migrate deploy` au démarrage
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/node_modules/.pnpm ./node_modules/.pnpm
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/.bin/prisma ./node_modules/.bin/prisma

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
