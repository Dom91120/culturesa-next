import { prisma } from "@/server/db";

/**
 * Une ligne de la matrice service × demandeur : le demandeur (référentiel
 * global) activé pour ce service, avec ses 5 modes booléens.
 *   - `recurrent`   : le demandeur réserve en mode récurrent.
 *   - `semaineAb`   : alternance Semaine A / Semaine B (n'a de sens que pour
 *                     les récurrents ; uniforme parmi tous les récurrents).
 *   - `validation`  : les réservations passent par une validation.
 *   - `themes`      : la saisie d'un thème est demandée.
 *   - `jauge`       : une jauge s'applique (uniforme par mode : une valeur pour
 *                     les récurrents, une pour les ponctuels).
 */
export type DemandeurSettingRow = {
  demandeurId: number;
  recurrent: boolean;
  semaineAb: boolean;
  validation: boolean;
  themes: boolean;
  jauge: boolean;
};

/** Lit la matrice des demandeurs configurés pour un service, ordonnée par demandeurId. */
export async function getServiceDemandeurSettings(
  serviceId: string,
): Promise<DemandeurSettingRow[]> {
  const rows = await prisma.serviceDemandeurSettings.findMany({
    where: { serviceId },
    orderBy: { demandeurId: "asc" },
    select: {
      demandeurId: true,
      recurrent: true,
      semaineAb: true,
      validation: true,
      themes: true,
      jauge: true,
    },
  });
  return rows;
}

/**
 * Remplace TOUTE la matrice des demandeurs d'un service (fidèle au legacy :
 * delete-all puis recreate, en transaction). Ne conserve que les lignes ayant
 * un `demandeurId` valide (> 0), dédupliquées par `demandeurId` (première
 * occurrence gagnante).
 */
export async function saveServiceDemandeurSettings(
  serviceId: string,
  rows: DemandeurSettingRow[],
): Promise<void> {
  const seen = new Set<number>();
  const valid: DemandeurSettingRow[] = [];
  for (const row of rows) {
    if (!row.demandeurId || row.demandeurId <= 0) continue;
    if (seen.has(row.demandeurId)) continue;
    seen.add(row.demandeurId);
    valid.push(row);
  }

  await prisma.$transaction(async (tx) => {
    await tx.serviceDemandeurSettings.deleteMany({ where: { serviceId } });
    if (valid.length > 0) {
      await tx.serviceDemandeurSettings.createMany({
        data: valid.map((r) => ({
          serviceId,
          demandeurId: r.demandeurId,
          recurrent: r.recurrent,
          semaineAb: r.semaineAb,
          validation: r.validation,
          themes: r.themes,
          jauge: r.jauge,
        })),
      });
    }
  });
}
