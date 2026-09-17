/**
 * Événement global pour ré-ouvrir l'onboarding (« Revoir la présentation » du user-menu).
 * Isolé dans un module minuscule pour que l'émetteur (app-shell) et le chargeur paresseux
 * (onboarding-modal-lazy) puissent le connaître SANS embarquer la modale elle-même
 * (~1 000 lignes) dans le bundle initial — cf. audit perf 2026-09-17.
 */
export const ONBOARDING_REPLAY_EVENT = "culturesa:onboarding-replay";
