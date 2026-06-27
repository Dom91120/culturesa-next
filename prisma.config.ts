import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7 : la configuration de la CLI (schéma, migrations, seed, datasource) vit ici
// (remplace la clé `prisma` de package.json). Les variables d'env ne sont plus chargées
// automatiquement → `dotenv/config` les injecte pour les commandes Prisma.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
