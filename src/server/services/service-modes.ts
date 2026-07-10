import type { DemandeurSettingRow } from "./demandeur-settings";

export type ServiceModes = {
  recurringMode: boolean; // au moins un demandeur récurrent
  abMode: boolean; // au moins un demandeur en semaine A/B
  validationMode: boolean; // au moins un demandeur en validation
  themeMode: boolean; // au moins un demandeur en thèmes
  // (La jauge est portée par CHAQUE CRÉNEAU — slots.jauge — plus par la matrice.)
};

export function deriveServiceModes(rows: DemandeurSettingRow[]): ServiceModes {
  return {
    recurringMode: rows.some((r) => r.recurrent),
    abMode: rows.some((r) => r.semaineAb),
    validationMode: rows.some((r) => r.validation),
    themeMode: rows.some((r) => r.themes),
  };
}
