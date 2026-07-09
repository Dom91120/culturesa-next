/**
 * Libellé d'exercice « année scolaire » Y-Y+1 d'une date : Y = année si le mois est ≥ août
 * (1-indexé), sinon année-1. Convention UNIQUE de l'app (bascule d'exercice + stats), pour
 * éviter des libellés divergents. Accepte une chaîne ISO `YYYY-MM-DD` (lue telle quelle) ou
 * une `Date` (interprétée en UTC, comme les colonnes `@db.Date` stockées à minuit UTC).
 */
export function schoolYearLabel(date: Date | string): string {
  const y =
    typeof date === "string"
      ? Number.parseInt(date.slice(5, 7), 10) >= 8
        ? Number.parseInt(date.slice(0, 4), 10)
        : Number.parseInt(date.slice(0, 4), 10) - 1
      : date.getUTCMonth() + 1 >= 8
        ? date.getUTCFullYear()
        : date.getUTCFullYear() - 1;
  return `${y}-${y + 1}`;
}
