// Helpers d'export CSV partagés par les routes /export (éditions, stats, mes
// réservations). Mutualisé à l'identique des trois copies locales (audit
// duplication D4) : un correctif (échappement, séparateur, BOM) ne se fait plus
// qu'à un seul endroit.

/** Échappe une valeur pour une cellule CSV : guillemets doublés, valeur toujours quotée. */
export function csvCell(v: string | number): string {
  return `"${String(v).replace(/"/g, '""')}"`;
}

/**
 * Construit une réponse CSV téléchargeable, compatible Excel FR : BOM UTF-8,
 * cellules échappées jointes par « ; », lignes séparées par CRLF.
 */
export function csvResponse(rows: (string | number)[][], filename: string): Response {
  const body = rows.map((cols) => cols.map(csvCell).join(";")).join("\r\n");
  return new Response(`﻿${body}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
