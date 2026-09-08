// ─── Pictogrammes d'interface partagés (SVG inline, traits Tabler — MIT) ──────────
// Rendu identique sur toutes les plateformes (convention Dom : pas d'emoji d'interface).
// Les pictogrammes propres aux comptes (crayon, export, anonymiser…) vivent dans
// app/(admin)/users/account-ui.tsx ; ici ceux des tâches planifiées et de la barre
// d'outils générique.

type GlyphProps = { size?: number; strokeWidth?: number };

function Svg({
  size = 16,
  strokeWidth = 1.8,
  children,
}: GlyphProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** Lecture — exécuter maintenant. */
export const PlayGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M7 4v16l13 -8z" />
  </Svg>
);

/** Flèches circulaires — rafraîchir. */
export const RefreshGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4" />
    <path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" />
  </Svg>
);

/** Répétition — planification par intervalle. */
export const RepeatGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M4 12v-3a3 3 0 0 1 3 -3h13m-3 -3l3 3l-3 3" />
    <path d="M20 12v3a3 3 0 0 1 -3 3h-13m3 3l-3 -3l3 -3" />
  </Svg>
);

/** Calendrier et horloge — planification à heure fixe. */
export const CalendarTimeGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M11.795 21h-6.795a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v4" />
    <path d="M18 18m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0" />
    <path d="M15 3v4" />
    <path d="M7 3v4" />
    <path d="M3 11h16" />
    <path d="M18 16.496v1.504l1 1" />
  </Svg>
);

/** Sablier — liste d'attente / exécution en cours. */
export const HourglassGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M6.5 7h11" />
    <path d="M6.5 17h11" />
    <path d="M6 20v-2a6 6 0 1 1 12 0v2a1 1 0 0 1 -1 1h-10a1 1 0 0 1 -1 -1z" />
    <path d="M6 4v2a6 6 0 1 0 12 0v-2a1 1 0 0 0 -1 -1h-10a1 1 0 0 0 -1 1z" />
  </Svg>
);

/** Coche cerclée — auto-validation. */
export const CircleCheckGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" />
    <path d="M9 12l2 2l4 -4" />
  </Svg>
);

/** Enveloppe et flèche — notifications. */
export const MailForwardGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M12 18h-7a2 2 0 0 1 -2 -2v-10a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v7.5" />
    <path d="M3 6l9 6l9 -6" />
    <path d="M15 18h6" />
    <path d="M18 15l3 3l-3 3" />
  </Svg>
);

/** Bouclier et cadenas — RGPD. */
export const ShieldLockGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3" />
    <path d="M12 11m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />
    <path d="M12 12l0 2.5" />
  </Svg>
);

/** Cloche — rappels. */
export const BellGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6" />
    <path d="M9 17v1a3 3 0 0 0 6 0v-1" />
  </Svg>
);

/** Base et flèche — export de la base. */
export const DatabaseExportGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M4 6c0 1.657 3.582 3 8 3s8 -1.343 8 -3s-3.582 -3 -8 -3s-8 1.343 -8 3" />
    <path d="M4 6v6c0 1.657 3.582 3 8 3c1.118 0 2.183 -.086 3.15 -.241m4.85 -2.759v-6" />
    <path d="M4 12v6c0 1.657 3.582 3 8 3c.157 0 .312 -.002 .466 -.005m7.534 -1.995v-2" />
    <path d="M16 19h6" />
    <path d="M19 16l3 3l-3 3" />
  </Svg>
);

/** Fichier de code — crontab. */
export const FileCodeGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M14 3v4a1 1 0 0 0 1 1h4" />
    <path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" />
    <path d="M10 13l-1 2l1 2" />
    <path d="M14 13l1 2l-1 2" />
  </Svg>
);

/** Base de données — export. */
export const DatabaseGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M12 6m-8 0a8 3 0 1 0 16 0a8 3 0 1 0 -16 0" />
    <path d="M4 6v6a8 3 0 0 0 16 0v-6" />
    <path d="M4 12v6a8 3 0 0 0 16 0v-6" />
  </Svg>
);

/** Flèche montante — téléverser. */
export const UploadGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" />
    <path d="M7 9l5 -5l5 5" />
    <path d="M12 4l0 12" />
  </Svg>
);

/** Cadenas fermé — chiffré. */
export const LockGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6z" />
    <path d="M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0" />
    <path d="M8 11v-4a4 4 0 1 1 8 0v4" />
  </Svg>
);

/** Cadenas ouvert — en clair. */
export const LockOpenGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6z" />
    <path d="M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0" />
    <path d="M8 11v-5a4 4 0 0 1 8 0" />
  </Svg>
);

/** Flèche de retour circulaire — restaurer. */
export const RestoreGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M3.06 13a9 9 0 1 0 .49 -4.087" />
    <path d="M3 4.001v5h5" />
    <path d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
  </Svg>
);

/** Bouclier et coche — conservation des données (RGPD). */
export const ShieldCheckGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M11.46 20.846a12 12 0 0 1 -7.96 -14.846a12 12 0 0 0 8.5 -3a12 12 0 0 0 8.5 3a12 12 0 0 1 -.09 7.06" />
    <path d="M15 19l2 2l4 -4" />
  </Svg>
);

/** Horloge et flèche — journal / historique. */
export const HistoryGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M12 8l0 4l2 2" />
    <path d="M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5" />
  </Svg>
);

/** Horloge — tâche planifiée (acteur automatique). */
export const ClockGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" />
    <path d="M12 7v5l3 3" />
  </Svg>
);

/** Enveloppe — préavis, e-mail. */
export const MailGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-10z" />
    <path d="M3 7l9 6l9 -6" />
  </Svg>
);

/** Triangle d'alerte — au-delà du seuil. */
export const AlertGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M12 9v4" />
    <path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z" />
    <path d="M12 16h.01" />
  </Svg>
);

/** Flèche droite — enchaînement des étapes. */
export const ArrowRightGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M5 12l14 0" />
    <path d="M13 18l6 -6" />
    <path d="M13 6l6 6" />
  </Svg>
);
