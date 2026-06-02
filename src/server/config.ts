import { prisma } from "@/server/db";

/** Lit plusieurs clés de configuration applicative (table app_config). */
export async function getConfigMany(keys: string[]): Promise<Record<string, string>> {
  const rows = await prisma.appConfig.findMany({ where: { key: { in: keys } } });
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = "";
  for (const r of rows) out[r.key] = r.value ?? "";
  return out;
}

/** Écrit une clé de configuration applicative. */
export async function setConfig(key: string, value: string): Promise<void> {
  await prisma.appConfig.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

/** Écrit plusieurs clés de configuration en une seule transaction. */
export async function setConfigMany(entries: Record<string, string>): Promise<void> {
  const ops = Object.entries(entries).map(([key, value]) =>
    prisma.appConfig.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    }),
  );
  await prisma.$transaction(ops);
}
