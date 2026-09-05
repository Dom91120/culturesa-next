"use client";

// Composants PARTAGÉS des deux grilles agenda (admin / usager), extraits à
// l'identique des deux copies locales (audit duplication 2026-06).

import { useEffect } from "react";
import { DAY_NAMES, minutesToHHMM, type Pointage } from "@/lib/agenda-core";

// Coin haut-gauche + rangée d'en-têtes de jours de la grille (port legacy cornerAB).
// Coin : grosse lettre A/B de la semaine active en mode A/B, sinon l'horloge.
// En-têtes : nom du jour + (en Semaine réelle) la date sous le nom. Pur, identique
// entre les deux grilles ; rendu en premiers enfants de `.agenda-grid`.
export function AgendaWeekHeader({
  days,
  abMode,
  effectiveWeek,
  realweek,
  weekDateByDay,
  outOfPeriodCls,
  dayTip,
}: {
  days: string[];
  abMode: boolean;
  effectiveWeek: string | null;
  realweek: boolean;
  weekDateByDay: Record<string, string>;
  outOfPeriodCls: (d: string) => string;
  // Info-bulle d'un jour hachuré (closedDayTip, agenda-core) : « Jour férié »,
  // « Vacances scolaires » ou « Hors période » ; undefined = pas d'info-bulle.
  dayTip?: (d: string) => string | undefined;
}) {
  return (
    <>
      <div
        className="agenda-header-cell agenda-corner"
        data-tip={abMode && effectiveWeek ? `Semaine ${effectiveWeek}` : "Horaires"}
      >
        {abMode && effectiveWeek ? effectiveWeek : "🕘"}
      </div>
      {days.map((d) => (
        <div key={d} className={`agenda-header-cell${outOfPeriodCls(d)}`} data-tip={dayTip?.(d)}>
          {DAY_NAMES[d] ?? d}
          {realweek && weekDateByDay[d] && (
            <span className="agenda-day-sub">{weekDateByDay[d]}</span>
          )}
        </div>
      ))}
    </>
  );
}

// Colonne d'axe horaire de la grille (port legacy renderAgendaWeekly). En mode
// « masquer les horaires sans créneau », la grille est compactée : on n'affiche
// que les heures RÉELLEMENT visibles et on marque la fin réelle de chaque plage
// (rupture) avec son horaire exact. Logique 100 % dérivée de la géométrie — pure,
// identique entre les deux grilles.
export function AgendaTimeColumn({
  quarters,
  qIdx,
  gridStartMin,
  gridEndMin,
  totalH,
  hasLunch,
  lunchSkipFrom,
  lunchEnd,
  mapMinToY,
}: {
  quarters: number[];
  qIdx: Map<number, number>;
  gridStartMin: number;
  gridEndMin: number;
  totalH: number;
  hasLunch: boolean;
  lunchSkipFrom: number | null;
  lunchEnd: number;
  mapMinToY: (min: number) => number;
}) {
  // Grille vide (aucun quart visible : semaine sans créneau en mode compacté, ex.
  // semaine à cheval hors période active) : aucune heure à situer. On n'affiche
  // AUCUNE marque — sinon la seule borne rescapée (fin de grille, ex. « 18:00 »)
  // se retrouverait à top:0 remontée par is-break-end, débordant dans le coin.
  if (quarters.length === 0) return <div className="agenda-time-col" style={{ height: totalH }} />;
  const minLabel = minutesToHHMM;
  // Fin réelle de la grille = fin du dernier quart visible (≠ gridEndMin si compacté).
  const effectiveEnd = quarters.length ? quarters[quarters.length - 1] + 15 : gridEndMin;
  // La rupture de la pause méridienne est déjà signalée par sa bande grise :
  // on ne l'annote pas comme une rupture de plage.
  const isLunchBreak = (i: number) =>
    hasLunch &&
    lunchSkipFrom !== null &&
    quarters[i + 1] === lunchEnd &&
    quarters[i] + 15 >= lunchSkipFrom;
  const breakStarts = new Set<number>();
  for (let i = 0; i < quarters.length - 1; i++) {
    if (quarters[i + 1] - quarters[i] > 15 && !isLunchBreak(i)) {
      breakStarts.add(quarters[i + 1]);
    }
  }

  const marks: { key: string; top: number; cls: string; label: string }[] = [];
  // Heures pleines visibles + borne de fin réelle.
  let first = true;
  for (let m = Math.ceil(gridStartMin / 60) * 60; m <= effectiveEnd; m += 60) {
    if (m < gridStartMin) continue;
    if (m < effectiveEnd && !qIdx.has(m)) continue;
    let cls = "agenda-time-mark";
    if (m === effectiveEnd) cls += " is-break-end";
    else if (first || breakStarts.has(m)) cls += " is-break-start";
    marks.push({ key: `h-${m}`, top: mapMinToY(m), cls, label: minLabel(m) });
    first = false;
  }
  // Fin de chaque plage précédant une rupture (hors pause) : l'heure de fin réelle
  // du dernier créneau de la plage, remontée au-dessus de sa ligne.
  for (let i = 0; i < quarters.length - 1; i++) {
    if (quarters[i + 1] - quarters[i] > 15 && !isLunchBreak(i)) {
      const endOfPlage = quarters[i] + 15;
      marks.push({
        key: `e-${endOfPlage}`,
        top: mapMinToY(endOfPlage),
        cls: "agenda-time-mark is-break-end",
        label: minLabel(endOfPlage),
      });
    }
  }
  return (
    <div className="agenda-time-col" style={{ height: totalH }}>
      {marks.map((mk) => (
        <div key={mk.key} className={mk.cls} style={{ top: mk.top }}>
          {mk.label}
        </div>
      ))}
    </div>
  );
}

// Fond statique d'une colonne de jour : lignes de grille sur les quarts visibles
// (pointillé fin par quart, trait plein sur l'heure pleine) + bande grise de la
// pause méridienne. Pur, identique entre les deux grilles ; rendu en premiers
// enfants de la colonne, avant les blocs-créneaux.
export function AgendaDayBackground({
  quarters,
  hasLunch,
  lunchStart,
  lunchEnd,
  mapMinToY,
}: {
  quarters: number[];
  hasLunch: boolean;
  lunchStart: number;
  lunchEnd: number;
  mapMinToY: (min: number) => number;
}) {
  const ltop = hasLunch ? mapMinToY(lunchStart) : 0;
  const lh = hasLunch ? mapMinToY(lunchEnd) - ltop : 0;
  return (
    <>
      {quarters.map((min) => (
        <div
          key={min}
          className={`agenda-grid-line${min % 60 === 0 ? " is-hour" : ""}`}
          style={{ top: mapMinToY(min) }}
        />
      ))}
      {hasLunch && lh > 0 && (
        <div
          className="agenda-lunch-band"
          data-tip="Pause méridienne"
          style={{ top: ltop, height: lh }}
        />
      )}
    </>
  );
}

/**
 * Bande « Journée entière » : coin d'en-tête + une cellule par jour, au-dessus de la
 * grille horaire (port du legacy alldayRow ; squelette jumeau des deux grilles, audit
 * 2026-07-24). La condition d'affichage reste à chaque grille (admin : toujours en mode
 * création ; usager : dès qu'un bloc all-day existe), comme le contenu des cellules
 * (`children`, rendu par jour) et les interactions du mode création admin (`cellProps` :
 * data-attributes, curseur, mousedown du glisser-créer horizontal).
 */
export function AgendaAllDayRow({
  days,
  outOfPeriodCls,
  cellProps,
  children,
}: {
  days: string[];
  outOfPeriodCls: (d: string) => string;
  cellProps?: (d: string) => React.HTMLAttributes<HTMLDivElement> & {
    [key: `data-${string}`]: string | undefined;
  };
  children: (d: string) => React.ReactNode;
}) {
  return (
    <>
      <div className="agenda-header-cell agenda-allday-corner" data-tip="Journée entière">
        Journée entière
      </div>
      {days.map((d) => (
        <div
          key={`ad-${d}`}
          className={`agenda-allday-cell${outOfPeriodCls(d)}`}
          {...cellProps?.(d)}
        >
          {children(d)}
        </div>
      ))}
    </>
  );
}

/** Icône calendrier des créneaux libres (agenda usager) : l'emoji 📆 changeait
 * de dessin selon la plateforme (Google y écrit « July 17 » en dur sur Android) —
 * on sert donc le SVG de l'emoji Windows (version détaillée fournie par Dom,
 * public/calendar.svg) via <img> : ses filtres/dégradés portent des id internes
 * qui entreraient en collision si le SVG était inliné plusieurs fois. */
export function CalendarGlyph({ size = 24 }: { size?: number }) {
  return <img src="/calendar.svg" width={size} height={size} alt="" aria-hidden="true" />;
}

/** Item de légende « pastille créneau » (récurrent jaune / ponctuel vert) — même
 * vocabulaire visuel dans les deux grilles (classes .agenda-legend-* du legacy). */
export function AgendaLegendSwatch({
  kind,
  style,
  children,
}: {
  kind: "rec" | "uniq";
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <span className="agenda-legend-item" style={style}>
      <span className={`agenda-legend-swatch is-${kind}`} />
      {children}
    </span>
  );
}

// Pastille de pointage P (présent, vert) / A (absent, rouge) affichée en haut à
// droite du badge, reprise du legacy `_badgeIndicators` (classes .indic_p /
// .indic_a). Le pointage n'existe que sur les réservations ponctuelles datées,
// donc cette pastille n'apparaît qu'en « Semaine réelle ». Le badge parent doit
// être `position: relative` pour l'ancrer.
// `onClick` (optionnel) : la pastille devient un vrai bouton et N'EST PLUS
// transparente au clic — en mode pointage, cliquer le macaron A ouvre la fiche
// pour saisir le motif d'absence au lieu de cycler le pointage (Dom 2026-08-29).
// `absencePrevenue` : absence signalée À L'AVANCE (cf. services/booking-absence) et
// séance pas encore pointée → macaron « A » ORANGE (.indic_ap) ; une fois pointée,
// c'est le pointage (P vert / A rouge) qui s'affiche.
export function PointagePill({
  pointage,
  absencePrevenue = false,
  onClick,
  clickLabel,
}: {
  pointage: Pointage;
  absencePrevenue?: boolean;
  onClick?: () => void;
  clickLabel?: string;
}) {
  if (!pointage && !absencePrevenue) return null;
  const cls = pointage === "present" ? "indic_p" : pointage === "absent" ? "indic_a" : "indic_ap";
  const letter = pointage === "present" ? "P" : "A";
  const title = pointage ? undefined : "Absence prévenue";
  // Absence prévenue (non pointée) : en haut à GAUCHE, comme le macaron du badge
  // usager (slot-btn-absence) — le pointage P/A garde le haut droit (Dom 2026-09-04).
  const absenceOnly = !pointage;
  return (
    <span
      style={{
        position: "absolute",
        ...(absenceOnly ? { left: 3 } : { right: 3 }),
        top: 3,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        alignItems: "center",
        zIndex: 1,
      }}
    >
      {onClick ? (
        <button
          type="button"
          className={cls}
          aria-label={clickLabel}
          title={title}
          style={{ border: "none", cursor: "pointer" }}
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
        >
          {letter}
        </button>
      ) : (
        <span className={cls} title={title}>
          {letter}
        </span>
      )}
    </span>
  );
}

/**
 * Overlay de modale : clic sur le fond ou touche Échap = fermeture. Encapsule les
 * handlers clavier/souris pour rester accessible (et éviter de dupliquer les ignores).
 */
export function ModalOverlay({
  onClose,
  children,
  // Surcharge de style de la boîte (ex. caler max-width sur un contenu plus étroit que les
  // 620px par défaut de .modal-box, pour que la boîte épouse le contenu).
  boxStyle,
  // `false` pour les modales de FORMULAIRE qui ne doivent PAS se fermer au clic sur le fond
  // ni à Échap (protège une saisie non enregistrée) ; elles gardent leur propre bouton fermer.
  dismissOnBackdrop = true,
  // id du titre de la boîte, exposé en `aria-labelledby` sur le <dialog>.
  labelledBy,
}: {
  onClose: () => void;
  children: React.ReactNode;
  boxStyle?: React.CSSProperties;
  dismissOnBackdrop?: boolean;
  labelledBy?: string;
}) {
  // Fermeture à Échap au niveau document (sauf modales de formulaire). Un handler sur
  // l'overlay ne suffit PAS : le <dialog open> ne reçoit pas le focus et n'a pas de
  // gestion Échap native, donc la touche part de document.body ou du bouton déclencheur
  // (hors du sous-arbre de l'overlay) et n'atteindrait jamais un onKeyDown local.
  useEffect(() => {
    if (!dismissOnBackdrop) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dismissOnBackdrop, onClose]);

  return (
    <div
      className="modal-overlay open"
      role="presentation"
      onClick={dismissOnBackdrop ? onClose : undefined}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: onClick isole seulement le clic
          intérieur du fond ; PAS de onKeyDown (un stopPropagation y bloquerait l'Échap
          capté au niveau document, cf. useEffect ci-dessus). */}
      <dialog
        open
        className="modal-box"
        aria-modal="true"
        aria-labelledby={labelledBy}
        style={boxStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </dialog>
    </div>
  );
}

/** Bouton d'impression (icône imprimante) des deux grilles — style et SVG
 * strictement identiques des deux côtés avant l'extraction (audit 2026-07-17). */
/**
 * Pictogramme « Liste d'attente » : trois lignes (Feather « menu », sans puces) + petit
 * sablier Lucide en bas à droite — même famille que l'imprimante et le crayon de la
 * barre d'options (contour 24 px, trait 2, currentColor). Source : public/liste_attente.svg,
 * inliné ici pour hériter de la couleur du bouton (thème sombre compris).
 */
export function WaitingListGlyph({ size = 24 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="3" y1="5" x2="21" y2="5" />
      <line x1="3" y1="11" x2="21" y2="11" />
      <line x1="3" y1="17" x2="11" y2="17" />
      <g transform="translate(12 12) scale(0.5)" strokeWidth="3.5">
        <path d="M5 22h14" />
        <path d="M5 2h14" />
        <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
        <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
      </g>
    </svg>
  );
}

/**
 * Pictogramme « Prévenir d'une absence » = Lucide « calendar-x-2 » (calendrier, croix
 * en coin — même composition que WaitingListGlyph), choisi par Dom le 2026-09-05.
 * Inliné pour hériter de la couleur du bouton (`currentColor`), ce qu'un <img> sur
 * public/absence.svg ne permet pas ; ce fichier reste la source du dessin (docs).
 */
export function AbsenceGlyph({ size = 24 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <path d="M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8" />
      <path d="M3 10h18" />
      <path d="m17 22 5-5" />
      <path d="m17 17 5 5" />
    </svg>
  );
}

/**
 * Bouton « Liste d'attente » (agenda gestionnaire ET agenda usager, Dom 2026-09-05) :
 * même chrome que le bouton Imprimer (cadre fin, pictogramme 15 px gris) + pastille
 * optionnelle en coin haut-droit ; rien si `badge` est vide. Couleur : ORANGE par
 * défaut (compteur d'inscrits côté gestionnaire = attention), VERT côté usager inscrit
 * (« ✓ » = état acquis, comme la coche « Réservation validée » de la légende).
 */
export function WaitingListButton({
  tip,
  ariaLabel,
  badge,
  badgeColor = "var(--warn)",
  onClick,
}: {
  tip: string;
  ariaLabel?: string;
  badge?: string | number | null;
  badgeColor?: string;
  onClick: () => void;
}) {
  const show = badge != null && badge !== "" && badge !== 0;
  return (
    <button
      type="button"
      data-tip={tip}
      aria-label={ariaLabel ?? tip}
      style={{
        position: "relative",
        background: "none",
        border: "1px solid var(--border)",
        borderRadius: "var(--rad-sm)",
        padding: ".28rem .38rem",
        cursor: "pointer",
        color: "var(--muted)",
        display: "flex",
        alignItems: "center",
        lineHeight: 1,
      }}
      onClick={onClick}
    >
      <WaitingListGlyph size={15} />
      {show && (
        <span
          style={{
            position: "absolute",
            top: -5,
            right: -5,
            minWidth: 13,
            height: 13,
            padding: "0 3px",
            boxSizing: "border-box",
            borderRadius: 999,
            background: badgeColor,
            color: "#fff",
            fontSize: ".55rem",
            fontWeight: 700,
            lineHeight: "13px",
            textAlign: "center",
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

export function PrintIconButton({ onClick, tip }: { onClick: () => void; tip: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-tip={tip}
      aria-label={tip}
      style={{
        background: "none",
        border: "1px solid var(--border)",
        borderRadius: "var(--rad-sm)",
        padding: ".28rem .38rem",
        cursor: "pointer",
        color: "var(--muted)",
        display: "flex",
        alignItems: "center",
        lineHeight: 1,
      }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="6 9 6 2 18 2 18 9" />
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
        <rect x="6" y="14" width="12" height="8" />
      </svg>
    </button>
  );
}

/** État vide de la grille (aucune colonne de jour à afficher) : cadre pointillé
 * centré, message fourni par la grille (semaine hors période / exercice sans jour
 * d'ouverture). */
export function AgendaEmptyWeekNotice({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "2.5rem 1rem",
        textAlign: "center",
        fontSize: ".8rem",
        color: "var(--muted)",
        background: "var(--surface1)",
        border: "1px dashed var(--border)",
        borderRadius: "var(--radius)",
      }}
    >
      {children}
    </div>
  );
}

/**
 * Bouton à icône de la ligne des onglets de période (« Prévenir d'une absence »,
 * « Liste d'attente ») : par défaut l'icône SEULE, sans cadre ni texte, le libellé
 * restant en aria-label et en infobulle — même rendu sur bureau et mobile (Dom
 * 2026-09-05). `withLabel` : variante cadrée texte à GAUCHE + icône 24 px à droite.
 */
export function ToolbarIconButton({
  label,
  icon,
  withLabel = false,
  framed = false,
  onClick,
}: {
  label: string;
  // Chemin d'un SVG de public/ (rendu en <img>) OU pictogramme inliné (nœud React).
  icon: string | React.ReactNode;
  withLabel?: boolean;
  // Icône seule : même chrome que les boutons Imprimer / Liste d'attente (cadre fin,
  // pictogramme gris) — pour un pictogramme en trait à `currentColor`.
  framed?: boolean;
  onClick?: () => void;
}) {
  const glyph =
    typeof icon === "string" ? (
      <img src={icon} width={24} height={24} alt="" aria-hidden="true" />
    ) : (
      icon
    );
  if (!withLabel) {
    return (
      <button
        type="button"
        data-tip={label}
        aria-label={label}
        style={
          framed
            ? {
                background: "none",
                border: "1px solid var(--border)",
                borderRadius: "var(--rad-sm)",
                padding: ".28rem .38rem",
                cursor: "pointer",
                color: "var(--muted)",
                display: "flex",
                alignItems: "center",
                lineHeight: 1,
              }
            : {
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                lineHeight: 0,
              }
        }
        onClick={onClick}
      >
        {glyph}
      </button>
    );
  }
  return (
    <button
      type="button"
      className="btn btn-ghost"
      style={{
        padding: ".15rem .4rem .15rem .6rem",
        fontSize: ".66rem",
        whiteSpace: "nowrap",
        display: "inline-flex",
        alignItems: "center",
        gap: ".4rem",
      }}
      onClick={onClick}
    >
      {/* Centrage OPTIQUE sur l'icône : la masse des lettres est au-dessus du centre
          géométrique → texte descendu de 1px. */}
      <span style={{ position: "relative", top: 1 }}>{label}</span>
      {glyph}
    </button>
  );
}
