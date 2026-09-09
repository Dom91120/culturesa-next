import type { ReactNode } from "react";
import { initials, UserOffGlyph } from "@/app/(admin)/users/account-ui";
import { ArrowBackGlyph } from "@/components/ui-glyphs";
import { ExerciceNav } from "./exercice-nav";
import { ExportButton } from "./export-button";
import { PrintButton } from "./print-button";

// ════════════════════════════════════════════════════════════════════════════
//  Socle commun des écrans d'édition — refonte Dom 2026-09-09 : barre d'en-tête
//  (retour, titre avec pictogramme et service, navigation d'exercice, plage éventuelle,
//  filtres, CSV, PDF), résumé en pastilles, cellule « personne » avec avatar. Le PDF
//  (Puppeteer) rend cette même page : les actions sont `.no-print`, le reste s'imprime.
// ════════════════════════════════════════════════════════════════════════════

export type EditionTone = "ok" | "info" | "warn" | "neutral" | "purple";
const TONE: Record<EditionTone, string> = {
  ok: "is-ok",
  info: "is-info",
  warn: "is-warn",
  neutral: "is-neutral",
  purple: "is-purple",
};

export function EditionHeader({
  serviceId,
  serviceLabel,
  title,
  icon,
  tone = "ok",
  exercices,
  selectedId,
  center,
  right,
  csvHref,
  pdfHref,
}: {
  serviceId: string;
  serviceLabel: string;
  title: string;
  icon: ReactNode;
  tone?: EditionTone;
  /** Navigation d'exercice (absente pour les éditions « état du jour »). */
  exercices?: { id: number; label: string }[];
  selectedId?: number | null;
  /** Bloc après le titre (ex. navigation de plage ◀ semaine ▶), imprimé. */
  center?: ReactNode;
  /** Filtres et sélecteurs à droite (non imprimés). */
  right?: ReactNode;
  csvHref?: string;
  pdfHref?: string;
}) {
  return (
    <div className="edh">
      {/* Retour aux Éditions en icône seule (Dom 2026-09-09) : flèche « revenir » courbée,
        libellé en infobulle et pour les lecteurs d'écran. */}
      <a
        href={`/services/${serviceId}/editions`}
        className="edh-back no-print"
        title="Retour aux Éditions"
        aria-label="Retour aux Éditions"
      >
        <ArrowBackGlyph size={15} />
      </a>
      <span className="edh-title">
        <span className={`rg-ico ${TONE[tone]}`}>{icon}</span>
        {title}
        <span className="edh-svc">· {serviceLabel}</span>
      </span>
      {exercices && exercices.length > 0 && (
        <span className="ed-exo">
          <ExerciceNav exercices={exercices} selectedId={selectedId ?? null} />
        </span>
      )}
      {center}
      <span style={{ flex: 1 }} />
      {(right || csvHref || pdfHref) && (
        <span className="edh-actions no-print">
          {right}
          {csvHref && <ExportButton href={csvHref} />}
          {pdfHref && <PrintButton iconOnly href={pdfHref} title="Imprimer (PDF)" />}
        </span>
      )}
    </div>
  );
}

export type SummaryPill = { text: string; tone?: EditionTone; icon?: ReactNode };

/** Résumé sous la barre : pastilles (effectifs, signalements) + texte calé à droite. */
export function EditionSummary({ pills, right }: { pills: SummaryPill[]; right?: ReactNode }) {
  if (pills.length === 0 && !right) return null;
  return (
    <div className="edh-sum">
      {pills.map((p) => (
        <span key={p.text} className={`ms-pill ${TONE[p.tone ?? "neutral"]}`}>
          {p.icon}
          {p.text}
        </span>
      ))}
      {right && <span className="edh-sum-right">{right}</span>}
    </div>
  );
}

/** Cellule « personne » : avatar à initiales, nom en gras, sous-ligne facultative. */
export function Who({
  nom,
  prenom,
  email,
  sub,
  anonymized = false,
}: {
  nom: string;
  prenom: string;
  email?: string;
  sub?: ReactNode;
  anonymized?: boolean;
}) {
  const name = `${nom} ${prenom}`.trim();
  return (
    <span className="ed-who">
      <span className={`ed-av${anonymized ? " is-anon" : ""}`} aria-hidden="true">
        {anonymized ? <UserOffGlyph size={12} /> : initials(prenom, nom, email)}
      </span>
      <span style={{ minWidth: 0 }}>
        <span className="ed-nm">{name || (anonymized ? "Compte anonymisé" : "—")}</span>
        {sub && <span className="ed-sub">{sub}</span>}
      </span>
    </span>
  );
}

/** Nom combiné « NOM Prénom » (historique) → avatar + nom. */
export function WhoLabel({
  label,
  email,
  sub,
}: {
  label: string;
  email?: string;
  sub?: ReactNode;
}) {
  const anonymized = label === "Compte anonymisé" || label === "";
  const [nom, ...rest] = label.split(" ");
  return (
    <Who nom={nom ?? ""} prenom={rest.join(" ")} email={email} sub={sub} anonymized={anonymized} />
  );
}

/** Texte figé « — » en gris pour les cellules vides. */
export const dash = <span className="ed-mu">—</span>;
