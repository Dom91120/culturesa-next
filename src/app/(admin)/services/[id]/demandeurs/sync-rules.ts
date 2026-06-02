import type { DemandeurSettingRow } from "@/server/services/demandeur-settings";

/**
 * Champ booléen d'une ligne de la matrice susceptible d'être basculé via un
 * toggle dans l'UI.
 */
export type ToggleField = "recurrent" | "semaineAb" | "validation" | "themes" | "jauge";

/**
 * Applique les RÈGLES DE SYNCHRO INTER-LIGNES du legacy (`_catApplyToggle`,
 * `public/js/app.js`). Fonction PURE : retourne un NOUVEAU tableau (les lignes
 * non modifiées sont réutilisées telles quelles) après avoir basculé le champ
 * `field` de la ligne `idx`.
 *
 * Règles (après bascule de la valeur propre de la ligne) :
 *   - `recurrent` devient false : `semaineAb = false` sur cette ligne, et on
 *     copie la `jauge` d'une AUTRE ligne non-récurrente existante (la première)
 *     vers cette ligne (héritage du mode ponctuel).
 *   - `recurrent` devient true : on copie `semaineAb` ET `jauge` depuis une
 *     AUTRE ligne récurrente existante (la première) vers cette ligne.
 *   - `semaineAb` : propage la nouvelle valeur à TOUTES les lignes récurrentes
 *     (Semaine A/B est partagé entre tous les récurrents).
 *   - `jauge` : propage la nouvelle valeur à TOUTES les lignes du même mode
 *     (toutes récurrentes si la ligne l'est, sinon toutes les ponctuelles).
 *   - `validation` / `themes` : purement par ligne, aucune propagation.
 */
export function applyToggle(
  rows: DemandeurSettingRow[],
  idx: number,
  field: ToggleField,
): DemandeurSettingRow[] {
  if (idx < 0 || idx >= rows.length) return rows;

  // Copie de travail : on duplique chaque ligne pour ne jamais muter l'entrée.
  const next = rows.map((r) => ({ ...r }));
  const target = next[idx];
  target[field] = !target[field];

  if (field === "recurrent" && !target.recurrent) {
    target.semaineAb = false;
    const otherPonct = next.find((r, i) => i !== idx && !r.recurrent);
    if (otherPonct) target.jauge = otherPonct.jauge;
  } else if (field === "recurrent" && target.recurrent) {
    const other = next.find((r, i) => i !== idx && r.recurrent);
    if (other) {
      target.semaineAb = other.semaineAb;
      target.jauge = other.jauge;
    }
  } else if (field === "semaineAb") {
    const val = target.semaineAb;
    for (const r of next) if (r.recurrent) r.semaineAb = val;
  } else if (field === "jauge") {
    const val = target.jauge;
    const isRec = target.recurrent;
    for (const r of next) if (r.recurrent === isRec) r.jauge = val;
  }

  return next;
}

/**
 * Normalise l'état initial chargé depuis la base (fidèle à `loadParamsDemandeurs`).
 * Garantit la cohérence même si la base contient des valeurs hétérogènes :
 *   - si AU MOINS une ligne récurrente a `jauge=true` → toutes les récurrentes
 *     l'ont ; idem pour les ponctuelles ;
 *   - si AU MOINS une ligne récurrente a `semaineAb=true` → toutes les
 *     récurrentes l'ont.
 * Fonction PURE : retourne un nouveau tableau.
 */
export function normalizeInitial(rows: DemandeurSettingRow[]): DemandeurSettingRow[] {
  const next = rows.map((r) => ({ ...r }));
  const recHasJauge = next.some((r) => r.recurrent && r.jauge);
  const ponctHasJauge = next.some((r) => !r.recurrent && r.jauge);
  const recHasAb = next.some((r) => r.recurrent && r.semaineAb);
  for (const r of next) {
    if (r.recurrent && recHasJauge) r.jauge = true;
    if (!r.recurrent && ponctHasJauge) r.jauge = true;
    if (r.recurrent && recHasAb) r.semaineAb = true;
  }
  return next;
}
