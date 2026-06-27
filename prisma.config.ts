import { createRequire } from "node:module";
import { defineConfig } from "prisma/config";

// Prisma 7 : la configuration de la CLI (schéma, migrations, seed, datasource) vit ici
// (remplace la clé `prisma` de package.json). Les variables d'env ne sont plus chargées
// automatiquement → on charge `.env` EN LOCAL pour les commandes Prisma. Chargement
// DÉFENSIF : en production (image Docker minimale), `dotenv` peut être absent et
// `DATABASE_URL` est déjà dans l'environnement → on ignore alors silencieusement.
try {
  createRequire(import.meta.url)("dotenv/config");
} catch {}

// On lit `process.env.DATABASE_URL` (et non `env()`) pour que le chargement de la config
// NE LÈVE PAS quand la variable est absente : `prisma generate` (build Docker / CI) n'a pas
// besoin de l'URL, seule la connexion (migrate deploy au runtime) en a besoin.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
