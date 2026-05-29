#!/bin/sh
set -e

# Applique les migrations Prisma en attente avant de démarrer l'app.
# Idempotent : ne fait rien si la base est déjà à jour.
echo "→ Application des migrations Prisma..."
node_modules/.bin/prisma migrate deploy

echo "→ Démarrage de l'application Next.js..."
exec "$@"
