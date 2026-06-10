// Numéro de semaine ISO 8601 + parité A/B. Extrait pour être partagé sans créer de
// cycle d'import entre slots.ts et recurring-children.ts.

function fromISO(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00Z`);
}

/** Numéro de semaine ISO 8601 (= PHP date('W'), legacy _isoWeek). */
export function isoWeek(dateStr: string): number {
  const d = fromISO(dateStr);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

// Tag A/B d'une date — CONVENTION UNIQUE de l'app : semaine ISO IMPAIRE = A, paire = B
// (identique à realWeekParity des grilles agenda admin/usager). Toute la chaîne A/B
// (slots, miroirs, réservations, affichage) doit utiliser cette même convention.
export function slotWeekTag(dateStr: string): "A" | "B" {
  return isoWeek(dateStr) % 2 === 1 ? "A" : "B";
}
