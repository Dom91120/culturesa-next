import { prisma } from "@/server/db";

/** Lit plusieurs clés de configuration applicative (table app_config). */
export async function getConfigMany(keys: string[]): Promise<Record<string, string>> {
  const rows = await prisma.appConfig.findMany({ where: { key: { in: keys } } });
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = "";
  for (const r of rows) out[r.key] = r.value ?? "";
  return out;
}

/** Clé app_config de l'URL publique de l'application (saisie en Administration › Configuration). */
export const APP_URL_KEY = "app.url";

/**
 * URL publique de l'application (pour les liens dans les e-mails). Priorité à la valeur
 * saisie en Administration › Configuration (`app.url`), repli sur les variables
 * d'environnement. Sans slash final ; "" si rien n'est configuré.
 */
export async function getAppUrl(): Promise<string> {
  const cfg = (await getConfigMany([APP_URL_KEY]))[APP_URL_KEY]?.trim();
  const fromEnv =
    process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
  return (cfg || fromEnv).replace(/\/$/, "");
}

/** Existe-t-il une clé `<prefix>…` dont la valeur vaut exactement `value` ? */
export async function isConfigValueUsed(prefix: string, value: string): Promise<boolean> {
  const n = await prisma.appConfig.count({ where: { key: { startsWith: prefix }, value } });
  return n > 0;
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

/** Supprime une ou plusieurs clés de configuration applicative (no-op si liste vide). */
export async function deleteConfig(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await prisma.appConfig.deleteMany({ where: { key: { in: keys } } });
}
