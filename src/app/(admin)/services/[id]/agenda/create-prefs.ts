/**
 * Réglages du mode « Création de créneau » mémorisés d'une visite à l'autre.
 *
 * Ils vivent EN BASE, sur le service (colonnes `create*` de `services`), au même titre
 * que la capacité par défaut : ce sont des défauts du service, partagés par tous ses
 * gestionnaires et retrouvés depuis n'importe quel poste. L'écriture passe par
 * `setServiceCreatePrefsAction` ; ce module ne porte que l'assainissement des valeurs
 * relues, qui peuvent avoir vieilli entre deux visites.
 */

/** Type de créneau créé en « Semaine réelle » (récurrent / ponctuel / répliqué). */
export type CreateKind = "rec" | "uniq" | "multi";

const KIND_VALUES: CreateKind[] = ["rec", "uniq", "multi"];

/**
 * Valeur mémorisée → état du sélecteur. « Récurrent » retombe sur « ponctuel » quand le
 * service a perdu son mode récurrent depuis la dernière visite : le sélecteur ne propose
 * plus ce choix, le gestionnaire ne pourrait donc plus en sortir.
 */
export function asCreateKind(value: string, recurringMode: boolean): CreateKind {
  const kind = KIND_VALUES.includes(value as CreateKind) ? (value as CreateKind) : "uniq";
  return kind === "rec" && !recurringMode ? "uniq" : kind;
}

/**
 * Demandeurs autorisés par défaut → liste utilisable. La colonne est un tableau d'ids
 * sans clé étrangère : on écarte ceux qui ne sont plus configurés pour le service,
 * faute de quoi un id mort partirait dans la création et n'y autoriserait personne.
 */
export function sanitizeDemIds(ids: number[], serviceDemandeurIds: number[]): number[] {
  const known = new Set(serviceDemandeurIds);
  return ids.filter((id) => known.has(id));
}
