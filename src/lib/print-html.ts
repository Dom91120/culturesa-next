import { escapeHtml } from "@/lib/email-theme";

/**
 * Imprime un document HTML autonome SANS pop-up : le HTML est injecté dans un iframe
 * caché (srcdoc, même origine), dont on déclenche l'impression — `print()` sur l'iframe
 * n'imprime QUE son document, sans toucher à la page hôte. L'iframe est retiré après
 * l'impression (`afterprint`), avec un filet de sécurité.
 *
 * Avantages vs `window.open` : aucune fenêtre visible, aucun bloqueur de pop-ups, pas de
 * script inline (l'impression est déclenchée depuis la page hôte → compatible CSP).
 *
 * `html` doit être un document complet (`<!DOCTYPE html>… <style>…</style> …`).
 */
export function printHtmlDocument(html: string): void {
  if (typeof document === "undefined") return;
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  iframe.onload = () => {
    const win = iframe.contentWindow;
    if (!win) {
      iframe.remove();
      return;
    }
    win.addEventListener("afterprint", () => iframe.remove());
    win.focus();
    win.print();
    // Filet de sécurité : certains navigateurs n'émettent pas toujours `afterprint`.
    setTimeout(() => iframe.remove(), 60_000);
  };
  iframe.srcdoc = html;
  document.body.appendChild(iframe);
}

// ─── Gabarit « liste imprimable » des deux grilles agenda ────────────────────
// Échafaudage jumeau des impressions admin (liste des réservations de la semaine)
// et usager (mes réservations de la période) — audit 2026-07-24 : squelette de
// document (titre + méta + table ou état vide) et CSS N&B communs ; seules les
// données (titre, méta, colonnes, lignes) et la densité diffèrent.

/** Cellule d'une ligne : texte (échappé au rendu) + centrage optionnel (classe .c). */
export type PrintCell = { text: string; center?: boolean };

// Variante standard (usager) / compacte (admin : police réduite, cellules sur une
// seule ligne — white-space:nowrap — pour que « 09:00 – 10:00 » ne se coupe pas).
const PRINT_TABLE_CSS = {
  normal:
    "*{color:#000;background:#fff}body{font-family:system-ui,Arial,sans-serif;margin:24px;font-size:12px}h1{font-size:16px;margin:0 0 4px}.meta{color:#444;margin:0 0 16px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:4px 8px;text-align:left}th{background:#eee !important;font-size:11px;text-transform:uppercase;letter-spacing:.04em}.empty{color:#444}",
  compact:
    "*{color:#000;background:#fff}body{font-family:system-ui,Arial,sans-serif;margin:18px;font-size:10px}h1{font-size:14px;margin:0 0 3px}.meta{color:#444;margin:0 0 10px;font-size:10px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:2px 6px;text-align:left;white-space:nowrap}td.c{text-align:center}th{background:#eee !important;font-size:9px;text-transform:uppercase;letter-spacing:.03em}.empty{color:#444}",
} as const;

/** Compose le document tableau (ou l'état vide) et lance son impression. */
export function printTableDocument(opts: {
  title: string;
  /** Ligne méta sous le titre (texte en clair, échappé ici). */
  meta: string;
  head: string[];
  rows: PrintCell[][];
  compact?: boolean;
}): void {
  const { title, meta, head, rows, compact } = opts;
  const inner = rows.length
    ? `<table><thead><tr>${head.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows
        .map(
          (r) =>
            `<tr>${r
              .map((c) => `<td${c.center ? ' class="c"' : ""}>${escapeHtml(c.text)}</td>`)
              .join("")}</tr>`,
        )
        .join("")}</tbody></table>`
    : '<p class="empty">Aucune réservation pour cette période.</p>';
  const css = compact ? PRINT_TABLE_CSS.compact : PRINT_TABLE_CSS.normal;
  printHtmlDocument(
    `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${css}</style></head><body><h1>${escapeHtml(title)}</h1><div class="meta">${escapeHtml(meta)}</div>${inner}</body></html>`,
  );
}
