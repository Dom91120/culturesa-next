"use client";

import { PrinterGlyph } from "@/components/ui-glyphs";

// `iconOnly` : bouton compact icône seule (imprimante), sans libellé — le nom accessible
// vient de `title` / `aria-label`. Sinon bouton avec libellé texte. Refonte Dom 2026-09-09 :
// bouton d'action `.acct-action`, pictogramme SVG partagé.
export function PrintButton({
  label = "Imprimer",
  iconOnly = false,
  title = "Imprimer",
  href,
}: {
  label?: string;
  iconOnly?: boolean;
  title?: string;
  // Si fourni : le bouton ouvre ce lien (ex. PDF serveur) au lieu de window.print().
  href?: string;
}) {
  if (iconOnly) {
    if (href) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener"
          className="acct-action no-print"
          title={title}
          aria-label={title}
        >
          <PrinterGlyph size={15} />
        </a>
      );
    }
    return (
      <button
        type="button"
        className="acct-action no-print"
        onClick={() => window.print()}
        title={title}
        aria-label={title}
      >
        <PrinterGlyph size={15} />
      </button>
    );
  }
  return (
    <button
      type="button"
      className="btn btn-ghost no-print"
      onClick={() => window.print()}
      title={title}
      style={{
        fontSize: ".7rem",
        padding: ".25rem .65rem",
        display: "inline-flex",
        alignItems: "center",
        gap: ".35rem",
      }}
    >
      <PrinterGlyph size={13} /> {label}
    </button>
  );
}
