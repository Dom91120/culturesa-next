import { prisma } from "@/server/db";
import { openingForDate } from "@/server/services/opening";

/**
 * Une ligne de la matrice service × demandeur : le demandeur (référentiel
 * global) activé pour ce service, avec ses 4 modes booléens.
 *   - `recurrent`   : le demandeur réserve en mode récurrent.
 *   - `semaineAb`   : alternance Semaine A / Semaine B (n'a de sens que pour
 *                     les récurrents ; uniforme parmi tous les récurrents).
 *   - `validation`  : les réservations passent par une validation.
 *   - `themes`      : la saisie d'un thème est demandée.
 * (La jauge est portée par CHAQUE CRÉNEAU — slots.jauge — plus par la matrice.)
 */
export type DemandeurSettingRow = {
  demandeurId: number;
  recurrent: boolean;
  semaineAb: boolean;
  validation: boolean;
  themes: boolean;
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
    },
  });
  return rows;
}

/**
 * Une ligne de la matrice enrichie pour le bandeau debug admin :
 *   - `label`                : libellé du demandeur.
 *   - `openOnHolidays`       : ouvert les jours fériés (niveau EXERCICE — on lit
 *                              l'exercice couvrant AUJOURD'HUI, même valeur sur
 *                              toutes les lignes ; hors exercice = fermé).
 *   - `openOnSchoolHolidays` : ouvert pendant les vacances scolaires (niveau
 *                              DEMANDEUR, propre à chaque ligne).
 */
export type DemandeurSettingLabeledRow = DemandeurSettingRow & {
  label: string;
  openOnHolidays: boolean;
  openOnSchoolHolidays: boolean;
};

/**
 * Comme {@link getServiceDemandeurSettings} mais avec le libellé du demandeur et
 * les deux flags « ouverture » (jours fériés / vacances scolaires), pour le bandeau
 * debug admin (port legacy `dem-info`). Trié par libellé.
 */
export async function getServiceDemandeurSettingsLabeled(
  serviceId: string,
): Promise<DemandeurSettingLabeledRow[]> {
  const today = new Date().toISOString().slice(0, 10);
  const [opening, rows] = await Promise.all([
    openingForDate(prisma, serviceId, today),
    prisma.serviceDemandeurSettings.findMany({
      where: { serviceId },
      select: {
        demandeurId: true,
        recurrent: true,
        semaineAb: true,
        validation: true,
        themes: true,
        demandeur: { select: { label: true, openOnSchoolHolidays: true } },
      },
    }),
  ]);
  const openOnHolidays = opening?.openOnHolidays ?? false;
  return rows
    .map((r) => ({
      demandeurId: r.demandeurId,
      label: r.demandeur?.label ?? "",
      recurrent: r.recurrent,
      semaineAb: r.semaineAb,
      validation: r.validation,
      themes: r.themes,
      openOnHolidays,
      openOnSchoolHolidays: r.demandeur?.openOnSchoolHolidays ?? false,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
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
        })),
      });
    }
  });
}
