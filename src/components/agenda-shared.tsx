"use client";

// Composants PARTAGÉS des deux grilles agenda (admin / usager), extraits à
// l'identique des deux copies locales (audit duplication 2026-06).

import { DAY_NAMES, type Pointage } from "@/lib/agenda-core";

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
}: {
  days: string[];
  abMode: boolean;
  effectiveWeek: string | null;
  realweek: boolean;
  weekDateByDay: Record<string, string>;
  outOfPeriodCls: (d: string) => string;
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
        <div key={d} className={`agenda-header-cell${outOfPeriodCls(d)}`}>
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
  const minLabel = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
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
        <div className="agenda-lunch-band" style={{ top: ltop, height: lh }} />
      )}
    </>
  );
}

// Pastille de pointage P (présent, vert) / A (absent, rouge) affichée en haut à
// droite du badge, reprise du legacy `_badgeIndicators` (classes .indic_p /
// .indic_a). Le pointage n'existe que sur les réservations ponctuelles datées,
// donc cette pastille n'apparaît qu'en « Semaine réelle ». Le badge parent doit
// être `position: relative` pour l'ancrer.
export function PointagePill({ pointage }: { pointage: Pointage }) {
  if (!pointage) return null;
  return (
    <span
      style={{
        position: "absolute",
        right: 3,
        top: 3,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        alignItems: "center",
        zIndex: 1,
      }}
    >
      <span className={pointage === "present" ? "indic_p" : "indic_a"}>
        {pointage === "present" ? "P" : "A"}
      </span>
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
}: {
  onClose: () => void;
  children: React.ReactNode;
  boxStyle?: React.CSSProperties;
}) {
  return (
    <div
      className="modal-overlay open"
      role="presentation"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <dialog
        open
        className="modal-box"
        aria-modal="true"
        style={boxStyle}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {children}
      </dialog>
    </div>
  );
}
