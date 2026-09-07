import { DAY_NAMES } from "@/lib/agenda-core";

// Libellés PURS d'un créneau et de la suppression d'une réservation (partagés par les
// e-mails, les rappels, la liste d'attente et ses éditions). Source unique des noms de
// jours = DAY_NAMES (lib/agenda-core — audit D2).

/** Libellé « créneau » lisible : date+heure (ponctuel) ou jour+heure (récurrent). */
export function formatSlotLabel(slot: {
  startTime: string;
  endTime: string;
  slotDate: Date | null;
  slotDay: string | null;
}): string {
  const s = (slot.startTime || "").slice(0, 5);
  const e = (slot.endTime || "").slice(0, 5);
  const time = s && e ? `${s} – ${e}` : "Journée entière";
  if (slot.slotDate) {
    // slotDate stocké à minuit UTC → formatage en UTC pour éviter tout décalage de jour.
    const d = slot.slotDate.toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    return `${d} · ${time}`;
  }
  const day = slot.slotDay ? (DAY_NAMES[slot.slotDay] ?? slot.slotDay) : "";
  return [day, time].filter(Boolean).join(" · ");
}

// ─── Suppression d'une réservation obtenue depuis la liste d'attente (Dom 2026-09-07) ──
// Le MODE dit comment la réservation a disparu ; l'acteur (« NOM Prénom ») n'est
// renseigné que pour un gestionnaire / administrateur.

export const WAITLIST_DELETION_MODES = {
  usager: "annulée par l'usager",
  gestionnaire: "supprimée par le service",
  refus: "refusée",
  creneau: "retirée avec son créneau",
  periode: "retirée avec sa période",
  exercice: "retirée avec son exercice",
} as const;

export type WaitlistDeletionMode = keyof typeof WAITLIST_DELETION_MODES;

export const isWaitlistDeletionMode = (m: string): m is WaitlistDeletionMode =>
  m in WAITLIST_DELETION_MODES;

/**
 * « annulée par l'usager le 12/09/2026 », « supprimée par le service le 12/09/2026
 * (DUPONT Marie) »… Chaîne vide si la réservation n'a pas été supprimée.
 */
export function waitlistDeletionLabel(mode: string, atIso: string | null, par: string): string {
  if (!atIso) return "";
  const what = isWaitlistDeletionMode(mode) ? WAITLIST_DELETION_MODES[mode] : "supprimée";
  const when = new Date(atIso).toLocaleDateString("fr-FR");
  return `${what} le ${when}${par ? ` (${par})` : ""}`;
}
