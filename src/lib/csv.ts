// Helpers d'export CSV partagés par les routes /export (éditions, stats, mes
// réservations). Mutualisé à l'identique des trois copies locales (audit
// duplication D4) : un correctif (échappement, séparateur, BOM) ne se fait plus
// qu'à un seul endroit.

// Caractères qui, en tête de cellule, déclenchent l'évaluation d'une formule à
// l'ouverture dans Excel / LibreOffice / Sheets (CSV/formula injection) :
// `= + - @` plus tab (0x09) et CR (0x0D). Cf. recommandation OWASP.
const FORMULA_TRIGGERS = /^[=+\-@\t\r]/;

/**
 * Échappe une valeur pour une cellule CSV : guillemets doublés, valeur toujours
 * quotée. Neutralise en amont l'injection de formule en préfixant d'une
 * apostrophe toute valeur débutant par un caractère déclencheur — le tableur
 * affiche alors le contenu en texte brut, sans l'interpréter.
 *
 * Compromis assumé (sortie visible) : une valeur légitime commençant par l'un de
 * ces caractères (téléphone « +33… », thème « => … ») reçoit ce préfixe `'`.
 * Acceptable pour nos exports (Excel FR), où la donnée reste lisible et où le
 * risque d'exécution (`=cmd|…`, `HYPERLINK`/`WEBSERVICE`) prime.
 */
export function csvCell(v: string | number): string {
  const s = String(v);
  const safe = FORMULA_TRIGGERS.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
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
