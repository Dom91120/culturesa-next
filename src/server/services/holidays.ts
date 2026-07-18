import type { Prisma } from "@/generated/prisma/client";
import { toDateInput } from "@/lib/format";
import { getConfigMany } from "@/server/config";
import { prisma } from "@/server/db";

/** Nombre de périodes de vacances en base pour une zone. */
export function countSchoolHolidays(zone: string) {
  return prisma.schoolHoliday.count({ where: { zone } });
}

/** Zone de vacances scolaires configurée (défaut "A"). */
export async function getSchoolZone(): Promise<string> {
  const cfg = await getConfigMany(["school.zone"]);
  return cfg["school.zone"] || "A";
}

export type SchoolHolidayRange = { dateStart: string; dateEnd: string };

/** Plages de vacances scolaires (ISO `yyyy-mm-dd`) d'une zone — source unique
 *  (4 copies du `findMany` + mapping avant l'audit 2026-07-18). */
export async function loadSchoolHolidayRanges(
  db: Prisma.TransactionClient,
  zone: string,
): Promise<SchoolHolidayRange[]> {
  const rows = await db.schoolHoliday.findMany({
    where: { zone },
    select: { dateStart: true, dateEnd: true },
  });
  return rows.map((r) => ({
    dateStart: toDateInput(r.dateStart),
    dateEnd: toDateInput(r.dateEnd),
  }));
}

type GovRow = {
  description?: string;
  start_date?: string;
  end_date?: string;
};

/**
 * Importe les vacances scolaires depuis l'open data de l'Éducation nationale
 * (dataset `fr-en-calendrier-scolaire`, API Explore v2.1) pour une zone (A/B/C)
 * et remplace les entrées de cette zone. Repris à l'identique de l'ancien
 * `includes/holidays.php::refresh_school_holidays`. Retourne le nombre importé.
 */
export async function refreshSchoolHolidaysFromGov(zone: string): Promise<number> {
  const z = zone.toUpperCase();
  if (!["A", "B", "C"].includes(z)) throw new Error("Zone invalide");

  // Plage : année courante ± 1 (comme le legacy).
  const year = new Date().getFullYear();
  const yearStart = year - 1;
  const yearEnd = year + 1;

  const where = `zones="Zone ${z}" AND start_date>="${yearStart}-01-01" AND end_date<="${yearEnd}-12-31"`;
  const params = new URLSearchParams({
    where,
    limit: "100",
    select: "description,start_date,end_date,zones,population",
  });
  const url = `https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records?${params}`;

  const resp = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`Erreur API data.gouv.fr (HTTP ${resp.status})`);
  const data = (await resp.json()) as { results?: GovRow[] };
  if (!Array.isArray(data.results)) throw new Error("Réponse data.gouv.fr invalide");

  // Dédup : plusieurs populations (Élèves/Enseignants) pour une même période.
  const seen = new Set<string>();
  const rows: { zone: string; dateStart: Date; dateEnd: Date; label: string }[] = [];
  for (const row of data.results) {
    const start = (row.start_date ?? "").slice(0, 10);
    const end = (row.end_date ?? "").slice(0, 10);
    const label = (row.description ?? "").slice(0, 255);
    if (!start || !end) continue;
    const key = `${start}|${end}|${label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ zone: z, dateStart: new Date(start), dateEnd: new Date(end), label });
  }

  await prisma.$transaction([
    prisma.schoolHoliday.deleteMany({ where: { zone: z } }),
    prisma.schoolHoliday.createMany({ data: rows }),
  ]);

  return rows.length;
}
