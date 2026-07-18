import type { DemandeurSettingRow } from "./demandeur-settings";

export type ServiceModes = {
  recurringMode: boolean; // le service propose des créneaux récurrents (Service.recurrentMode)
  // L'alternance Semaine A/B est désormais DISPONIBLE pour tout service récurrent : la
  // parité (A / B / toutes) se choisit créneau par créneau (Slot.weeks) via le bouton
  // « Semaine A/B » de l'agenda. Plus de drapeau service dédié (Service.semaineAb conservé
  // en base mais inutilisé). Donc abMode = recurringMode.
  abMode: boolean;
  validationMode: boolean; // au moins un demandeur en validation
  themeMode: boolean; // au moins un demandeur en thèmes
  // (La jauge est portée par CHAQUE CRÉNEAU — slots.jauge. Récurrent est GLOBAL au
  // service ; validation/thèmes restent par demandeur.)
};

export function deriveServiceModes(
  service: { recurrentMode: boolean },
  rows: DemandeurSettingRow[],
): ServiceModes {
  return {
    recurringMode: service.recurrentMode,
    abMode: service.recurrentMode,
    validationMode: rows.some((r) => r.validation),
    themeMode: rows.some((r) => r.themes),
  };
}
