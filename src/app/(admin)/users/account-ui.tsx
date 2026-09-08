import type { Role } from "@/generated/prisma/client";

// ─── Briques visuelles des onglets Comptes / Connectés (refonte Dom 2026-09-08) ──────
// Avatar à initiales teinté par rôle, pastilles (statut de confirmation, rôle), boutons
// d'action à pictogramme (crayon / flèche / personne barrée / avion — choix Dom) et
// pictogrammes d'affiliation. Pictogrammes = SVG inline (traits Tabler, MIT), rendu
// identique sur toutes les plateformes (convention Dom : pas d'emoji d'interface).
// Styles : classes `.acct-*` dans app-legacy.css.

type GlyphProps = { size?: number; strokeWidth?: number };

function Svg({
  size = 16,
  strokeWidth = 1.8,
  children,
  label,
}: GlyphProps & { children: React.ReactNode; label?: string }) {
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: pictogramme décoratif (aria-hidden) sauf si un libellé est fourni, auquel cas <title> est rendu
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      focusable="false"
    >
      {label && <title>{label}</title>}
      {children}
    </svg>
  );
}

/** Crayon — modifier la fiche. */
export const PencilGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4" />
    <path d="M13.5 6.5l4 4" />
  </Svg>
);

/** Flèche vers le bas — export RGPD. */
export const DownloadGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" />
    <path d="M7 11l5 5l5 -5" />
    <path d="M12 4v12" />
  </Svg>
);

/** Personne barrée — anonymiser (efface les données personnelles, garde les réservations). */
export const UserOffGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M8.18 8.189a4.01 4.01 0 0 0 2.616 2.627m3.507 -.545a4 4 0 1 0 -5.59 -5.552" />
    <path d="M6 21v-2a4 4 0 0 1 4 -4h4c.412 0 .81 .062 1.183 .178m2.633 2.618c.12 .38 .184 .785 .184 1.204v2" />
    <path d="M3 3l18 18" />
  </Svg>
);

/** Avion en papier — renvoyer le mail de confirmation. */
export const SendGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M10 14l11 -11" />
    <path d="M21 3l-6.5 18a.55 .55 0 0 1 -1 0l-3.5 -7l-7 -3.5a.55 .55 0 0 1 0 -1l18 -6.5" />
  </Svg>
);

/** Clé — réinitialiser la double authentification. */
export const KeyGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M16.555 3.843l3.602 3.602a2.877 2.877 0 0 1 0 4.069l-2.643 2.643a2.877 2.877 0 0 1 -4.069 0l-.301 -.301l-6.558 6.558a2 2 0 0 1 -1.239 .578l-.175 .008h-1.172a1 1 0 0 1 -.993 -.883l-.007 -.117v-1.172a2 2 0 0 1 .467 -1.284l.119 -.13l.414 -.414h2v-2h2v-2l2.144 -2.144l-.301 -.301a2.877 2.877 0 0 1 0 -4.069l2.643 -2.643a2.877 2.877 0 0 1 4.069 0z" />
    <path d="M15 9h.01" />
  </Svg>
);

/** Corbeille — suppression définitive d'un compte vide. */
export const TrashGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M4 7l16 0" />
    <path d="M10 11l0 6" />
    <path d="M14 11l0 6" />
    <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12" />
    <path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3" />
  </Svg>
);

/** Porte — déconnecter (Connectés). */
export const LogoutGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M14 8v-2a2 2 0 0 0 -2 -2h-7a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2 -2v-2" />
    <path d="M9 12h12l-3 -3" />
    <path d="M18 15l3 -3" />
  </Svg>
);

/** Coche — statut « Confirmé ». */
export const CheckGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M5 12l5 5l10 -10" />
  </Svg>
);

/** Enveloppe barrée — statut « En attente » (adresse non confirmée). */
export const MailOffGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M9 5h10a2 2 0 0 1 2 2v10m-2 2h-14a2 2 0 0 1 -2 -2v-10a2 2 0 0 1 2 -2" />
    <path d="M3 7l9 6l.565 -.377m2.435 -1.623l6 -4" />
    <path d="M3 3l18 18" />
  </Svg>
);

/** Bâtiment — service géré (gestionnaire). */
export const BuildingGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M3 21l18 0" />
    <path d="M9 8l1 0" />
    <path d="M9 12l1 0" />
    <path d="M9 16l1 0" />
    <path d="M14 8l1 0" />
    <path d="M14 12l1 0" />
    <path d="M14 16l1 0" />
    <path d="M5 21v-16a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v16" />
  </Svg>
);

/** Toque — structure (école, accueil…). */
export const SchoolGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M22 9l-10 -4l-10 4l10 4l10 -4v6" />
    <path d="M6 10.6v5.4a6 3 0 0 0 12 0v-5.4" />
  </Svg>
);

/** Personnes — catégorie sans structure (assistante maternelle…). */
export const UsersGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M9 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0" />
    <path d="M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    <path d="M21 21v-2a4 4 0 0 0 -3 -3.85" />
  </Svg>
);

// ─── Avatar et pastilles ─────────────────────────────────────────────────────

export const ROLE_LABEL: Record<Role, string> = {
  administrateur: "Administrateur",
  gestionnaire: "Gestionnaire",
  utilisateur: "Utilisateur",
};

/** Initiales « PN » (prénom + nom), repli sur la première lettre de l'e-mail. */
export function initials(prenom: string, nom: string, email = ""): string {
  const a = prenom.trim().charAt(0);
  const b = nom.trim().charAt(0);
  const s = `${a}${b}`.toUpperCase();
  return s || email.trim().charAt(0).toUpperCase() || "?";
}

export function Avatar({
  prenom,
  nom,
  email,
  role,
  anonymized = false,
}: {
  prenom: string;
  nom: string;
  email?: string;
  role: Role;
  anonymized?: boolean;
}) {
  if (anonymized) {
    return (
      <span className="acct-avatar is-anon" aria-hidden="true">
        <UserOffGlyph size={14} />
      </span>
    );
  }
  return (
    <span className={`acct-avatar role-${role}`} aria-hidden="true">
      {initials(prenom, nom, email)}
    </span>
  );
}

export function RolePill({ role, dim = false }: { role: Role; dim?: boolean }) {
  return (
    <span className={`acct-pill ${dim ? "is-anon" : `role-${role}`}`}>{ROLE_LABEL[role]}</span>
  );
}

export type AccountStatus = "confirmed" | "pending" | "anonymized";

const STATUS_META: Record<AccountStatus, { cls: string; label: string; title: string }> = {
  confirmed: {
    cls: "is-ok",
    label: "Confirmé",
    title: "Adresse e-mail confirmée par l'usager",
  },
  pending: {
    cls: "is-warn",
    label: "En attente",
    title: "Adresse e-mail non confirmée : le compte ne peut pas se connecter",
  },
  anonymized: {
    cls: "is-anon",
    label: "Anonymisé",
    title: "Données personnelles effacées (RGPD), réservations conservées",
  },
};

export function StatusPill({ status }: { status: AccountStatus }) {
  const m = STATUS_META[status];
  return (
    <span className={`acct-pill ${m.cls}`} title={m.title}>
      {status === "confirmed" && <CheckGlyph size={12} strokeWidth={2.4} />}
      {status === "pending" && <MailOffGlyph size={12} strokeWidth={2} />}
      {m.label}
    </span>
  );
}

/** Bouton d'action de ligne : pictogramme seul, libellé en infobulle et pour les lecteurs d'écran. */
export function ActionIconButton({
  label,
  tone,
  onClick,
  disabled,
  href,
  children,
}: {
  label: string;
  tone?: "warn" | "danger";
  onClick?: () => void;
  disabled?: boolean;
  href?: string;
  children: React.ReactNode;
}) {
  const cls = `acct-action${tone ? ` is-${tone}` : ""}`;
  if (href) {
    return (
      <a
        className={cls}
        href={href}
        target="_blank"
        rel="noreferrer"
        title={label}
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </a>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      {children}
    </button>
  );
}
