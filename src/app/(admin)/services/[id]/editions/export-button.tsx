import { DownloadGlyph } from "@/app/(admin)/users/account-ui";

// Bouton « Export CSV » icône seule (lien vers la route d'export), même gabarit que
// PrintButton (iconOnly) — refonte Dom 2026-09-09 : bouton d'action `.acct-action`.
export function ExportButton({
  href,
  title = "Exporter en CSV",
}: {
  href: string;
  title?: string;
}) {
  return (
    <a href={href} className="acct-action no-print" title={title} aria-label={title}>
      <DownloadGlyph size={15} />
    </a>
  );
}
