import type { DemandeurSettingRow } from "./demandeur-settings";

export type ServiceModes = {
  // TOUT service propose désormais des créneaux récurrents, et l'alternance Semaine A/B est
  // toujours disponible : la parité (A / B / toutes) se choisit créneau par créneau
  // (Slot.weeks) via le bouton « Semaine A/B » de l'agenda. Les drapeaux service dédiés
  // (Service.recurrentMode / semaineAb) sont conservés en base mais inutilisés.
  recurringMode: boolean; // toujours vrai
  abMode: boolean; // toujours vrai
  validationMode: boolean; // au moins un demandeur en validation
  themeMode: boolean; // au moins un demandeur en thèmes
  // Thème OBLIGATOIRE : l'enregistrement est refusé tant qu'il est vide. N'a de sens
  // qu'avec `themeMode` — sans champ affiché, rien ne pourrait être renseigné —, d'où
  // le ET ci-dessous : un réglage resté à vrai sur un demandeur dont les thèmes ont
  // été éteints ne doit pas bloquer une réservation sur un champ invisible.
  themeRequired: boolean;
  // (La jauge est portée par CHAQUE CRÉNEAU — slots.jauge ; validation/thèmes par demandeur.)
};

export function deriveServiceModes(rows: DemandeurSettingRow[]): ServiceModes {
  return {
    recurringMode: true,
    abMode: true,
    validationMode: rows.some((r) => r.validation),
    themeMode: rows.some((r) => r.themes),
    themeRequired: rows.some((r) => r.themes && r.themeRequired),
  };
}
