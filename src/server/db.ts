import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Prisma 7 (client Rust-free) : la connexion passe par un driver adapter (pg).
// Singleton : évite d'épuiser le pool de connexions en dev (HMR). Le client ET son pool pg
// sont mémorisés sur globalThis : sans cela, chaque réévaluation du module (HMR) créait un
// nouveau `PrismaPg` (donc un nouveau pool pg) même en réutilisant le client — pool orphelin.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrisma(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrisma();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
