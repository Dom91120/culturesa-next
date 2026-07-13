import type { DemandeurSettingRow } from "./demandeur-settings";

export type ServiceModes = {
  recurringMode: boolean; // le service propose des créneaux récurrents (Service.recurrentMode)
  abMode: boolean; // alternance Semaine A/B (Service.semaineAb, ssi récurrent actif)
  validationMode: boolean; // au moins un demandeur en validation
  themeMode: boolean; // au moins un demandeur en thèmes
  // (La jauge est portée par CHAQUE CRÉNEAU — slots.jauge. Récurrent et A/B sont
  // GLOBAUX au service ; seuls validation/thèmes restent par demandeur.)
};

export function deriveServiceModes(
  service: { recurrentMode: boolean; semaineAb: boolean },
  rows: DemandeurSettingRow[],
): ServiceModes {
  return {
    recurringMode: service.recurrentMode,
    abMode: service.recurrentMode && service.semaineAb,
    validationMode: rows.some((r) => r.validation),
    themeMode: rows.some((r) => r.themes),
  };
}
