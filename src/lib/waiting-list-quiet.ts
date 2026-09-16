// ─── Délai de carence de l'attribution automatique (Dom 2026-09-16) ───────────────
// Un échange de créneaux fait en deux glissers, ou toute manipulation en cours dans
// l'agenda, libère un créneau quelques instants. Si la tâche « Liste d'attente » passe à
// ce moment-là, elle l'attribue à un inscrit — c'est arrivé en production. La tâche
// n'apparie donc un service que si son agenda est CALME depuis `minutes` : aucune
// réservation ni aucun créneau modifié dans cet intervalle (dernière activité = max des
// `updatedAt`, la même mesure que la sonde de rafraîchissement des grilles).
//
// Une suppression seule ne laisse pas de trace : un créneau libéré par un refus est
// attribuable dès le passage suivant — c'est le but. Pure, testable.

export const WAITLIST_QUIET_KEY = "waitlist.quietMinutes";
export const DEFAULT_WAITLIST_QUIET_MINUTES = 15;
export const MAX_WAITLIST_QUIET_MINUTES = 1440;

/** Valeur lue en configuration → minutes valides (entier 0..1440), sinon le défaut. */
export function parseQuietMinutes(raw: string | null | undefined): number {
  if (raw == null || raw === "") return DEFAULT_WAITLIST_QUIET_MINUTES;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 0 && n <= MAX_WAITLIST_QUIET_MINUTES
    ? n
    : DEFAULT_WAITLIST_QUIET_MINUTES;
}

/**
 * L'agenda est-il calme ? Vrai si aucune activité connue (`lastActivity` null), si le
 * délai est 0, ou si la dernière activité remonte à au moins `minutes` minutes.
 */
export function agendaIsQuiet(lastActivity: Date | null, now: Date, minutes: number): boolean {
  if (minutes <= 0 || lastActivity == null) return true;
  return now.getTime() - lastActivity.getTime() >= minutes * 60_000;
}
