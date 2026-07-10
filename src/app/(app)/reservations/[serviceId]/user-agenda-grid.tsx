"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  AgendaDayBackground,
  AgendaTimeColumn,
  AgendaWeekHeader,
} from "@/components/agenda-shared";
import { AgendaTooltip, useAgendaTooltip } from "@/components/agenda-tooltip";
import {
  type AgendaBlockBase,
  addDays,
  CLOSED_OPENING,
  coveringForYmd,
  DAY_NAMES,
  DAY_OFFSET,
  dayCap,
  dayKeyFromYmd,
  type ExerciceOpening,
  gridGeometry,
  type LayoutItem,
  layoutOverlaps,
  mondayOf,
  type Pointage,
  parseWeeks,
  ROW_H,
  type Slot,
  shortDateFmt,
  slotWeekTag,
  toMinutes,
  type UniqueSlot,
  ymd,
} from "@/lib/agenda-core";
import { earliestBookableISO } from "@/lib/booking-delay";
import { isFrenchHoliday } from "@/lib/french-holidays";
import { gaugeUnits } from "@/lib/gauge";
import { printHtmlDocument } from "@/lib/print-html";
import { isInSchoolHolidayRange as inSchoolHolidayRange } from "@/lib/school-holidays";
import { usePointerDrag } from "@/lib/use-pointer-drag";
import type { ServiceModes } from "@/server/services/service-modes";
import { commitDraft } from "./actions";

// (Les réglages d'ouverture — plages, jours actifs, fériés, vacances — sont portés
// par CHAQUE EXERCICE, cf. type Exercice.opening ; hors exercice = fermé.)
type Service = {
  id: string;
  label: string;
  bookingDelay: number;
  capacity: number;
  semaineAb: boolean;
  themesMode: "libre" | "liste";
  maxReservations: number;
  maxReservationsPeriod: number;
  gaugeAccompagnants: boolean;
  validationBloquante: boolean;
};
type Period = {
  id: number;
  label: string;
  color: string;
  dateStart: string;
  dateEnd: string;
  // Ouverture des réservations usager ("YYYY-MM-DD" ou "" = toujours ouvert).
  disponibilite: string;
  exerciceId: number | null;
};
type Exercice = {
  id: number;
  label: string;
  dateStart: string; // "YYYY-MM-DD" ou ""
  dateEnd: string;
  // Réglages d'ouverture RÉSOLUS de l'exercice (surcharge ?? service, côté serveur).
  opening: ExerciceOpening;
};

// Échelle proportionnelle BORNÉE des badges « ma réservation ». 1 unité = `--bu`, défini
// en CSS sur .user-agenda-mine-badge comme `clamp(0.3px, 1cqmin, 0.8px)` : proportionnel
// au plus petit côté de la cellule créneau (conteneur `container-type: size`), borné par un
// plancher (0.3px, créneaux courts) et un plafond (0.8px, non mordant car la cellule est
// plafonnée à 50px → 1cqmin ≤ 0.5px). Tous les éléments du badge (police, boutons ±, icônes,
// thème, espacements) valent un multiple de cette unité → leur taille suit la hauteur/largeur
// du créneau. `--bu` est hérité par tous les descendants ; il se résout toujours contre la
// cellule créneau. (Coefficients calibrés pour ~retrouver les tailles d'origine quand le
// plus petit côté du créneau ≈ 50 px : N ≈ pixels × 2.)
const bu = (n: number) => `calc(var(--bu) * ${n})`;

// Bouton − / + d'un compteur de jauge (sans cercle, remplace les anciennes flèches ▲▼).
// Clic-maintenu : 1er pas immédiat, puis répétition (90 ms) après un délai de 400 ms
// tant que le bouton reste enfoncé. La répétition appelle TOUJOURS le `onClick` courant
// (via une ref) → borne `remaining` et compteurs à jour à chaque tick.
function StepBtn({
  sign,
  color,
  onClick,
  isMobile,
}: {
  sign: "+" | "−";
  color: string;
  onClick: () => void;
  // Smartphone : bordure pointillée ; desktop : pas de bordure.
  isMobile: boolean;
}) {
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stop() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);
    timeoutRef.current = null;
    intervalRef.current = null;
  }

  function start() {
    stop();
    onClickRef.current(); // 1er pas immédiat
    timeoutRef.current = setTimeout(() => {
      intervalRef.current = setInterval(() => onClickRef.current(), 90);
    }, 400);
  }

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return (
    <button
      type="button"
      aria-label={sign === "+" ? "Augmenter" : "Diminuer"}
      onMouseDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        start();
      }}
      onMouseUp={stop}
      onMouseLeave={stop}
      style={{
        // Glyphe centré, taille proportionnelle au créneau (cqmin). Le glyphe « − » / « + »
        // ne fait que ~7,7px de large pour une boîte de bu(44) : en DESKTOP (pas de bordure ni
        // fond → boîte invisible) on resserre la largeur à bu(22) pour gagner ~40px sur la
        // jauge (anti-troncature) SANS toucher au glyphe (font-size inchangée). Mobile : on
        // garde le cercle bu(44) (cible tactile, vue 1 jour pleine largeur, pas de troncature).
        width: bu(isMobile ? 44 : 22),
        height: bu(44),
        boxSizing: "border-box",
        // Smartphone : bordure pointillée ; desktop : aucune bordure.
        border: isMobile ? `${bu(2)} dotted ${color}` : "none",
        borderRadius: "50%",
        background: "transparent",
        color,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: bu(32),
        fontWeight: 700,
        lineHeight: 1,
        padding: 0,
        flexShrink: 0,
      }}
    >
      {sign}
    </button>
  );
}

// Champ thème du badge « ma réservation », repris du legacy (_createUserThemeInput).
// Mode « liste » : picker custom (label tronqué + ▾) ouvrant un menu en portail
// (échappe à l'overflow:hidden du badge, comme le menu fixed du legacy).
// Mode « libre » : textarea auto-redimensionné. Couleur accent (validé) / orange.
function ThemeField({
  value,
  validated,
  themesMode,
  themes,
  onChange,
  big = false,
  multiline = false,
}: {
  value: string;
  validated: boolean;
  themesMode: "libre" | "liste";
  themes: string[];
  onChange: (v: string) => void;
  // Mobile : champ thème 2× plus gros.
  big?: boolean;
  // Le thème s'affiche sur plusieurs lignes (retour à la ligne au lieu de tronquer) — utilisé
  // quand le thème prend la place centrale du slot-icon sur un créneau court (cf. themeInMiddle).
  multiline?: boolean;
}) {
  const themeColor = validated ? "#3e7e2f" : "#b2a478";
  // Taille de police du champ thème : proportionnelle au créneau (cqmin, `bu(22)`), comme le
  // reste du badge — y compris sur les créneaux courts (taille calculée). Le menu déroulant
  // (rendu en PORTAIL hors du badge) reste fixe (pas de conteneur de requête → cqmin = viewport).
  const themeFont = bu(22);
  const menuFont = ".72rem";
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);

  // Auto-resize du textarea (mode libre), comme autoResizeTextarea du legacy.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-mesure à chaque valeur
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [value]);

  // Fermeture du menu (clic extérieur / Échap / scroll / resize).
  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent) {
      const target = e.target as Node;
      // Le menu est en portail (hors wrapRef) : ne pas le considérer comme « extérieur »,
      // sinon le mousedown sur un item fermerait le menu avant que son onClick (→ onChange)
      // ne se déclenche, et la sélection serait perdue.
      if (menuRef.current?.contains(target)) return;
      if (wrapRef.current && !wrapRef.current.contains(target)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onScrollResize() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScrollResize, true);
    window.addEventListener("resize", onScrollResize);
    return () => {
      document.removeEventListener("mousedown", onDocDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScrollResize, true);
      window.removeEventListener("resize", onScrollResize);
    };
  }, [open]);

  if (themesMode === "liste") {
    const list = themes.slice();
    if (value && !list.includes(value)) list.push(value);
    const items = ["", ...list];
    const hoverBg = validated
      ? "color-mix(in srgb, var(--accent) 18%, transparent)"
      : "rgba(232,164,90,.18)";
    return (
      <>
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: picker custom (Échap géré globalement) */}
        <div
          ref={wrapRef}
          className={`slot-spots ${validated ? "theme-validated" : "theme-pending"}`}
          // Mobile : data-tip="" masque l'info-bulle du badge au tap/survol du picker thème.
          data-tip={big ? "" : undefined}
          style={{
            position: "relative",
            fontSize: themeFont,
            color: themeColor,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            maxWidth: "100%",
            // multiline : interligne aéré pour le retour à la ligne ; sinon line-height 1 =
            // celui RÉELLEMENT rendu par le textarea du mode libre (mesuré ~1,0, pas le 1.3
            // de .slot-spots), y compris en mode « big » (mobile) → hauteur IDENTIQUE aux deux
            // modes : bu(22) + 2px de padding.
            lineHeight: multiline ? 1.1 : 1,
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: bu(4),
            // Padding vertical 1px = celui de textarea.slot-spots → même hauteur que le mode
            // libre (1.3 × themeFont + 2px). Le champ s'ajuste sinon à son contenu.
            padding: `1px ${bu(4)} 1px ${bu(8)}`,
            userSelect: "none",
            overflow: "hidden",
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (!open) {
              const r = wrapRef.current?.getBoundingClientRect();
              if (r) setCoords({ top: r.bottom + 2, left: r.left, width: r.width });
            }
            setOpen((o) => !o);
          }}
        >
          <span
            style={{
              overflow: "hidden",
              // multiline : retour à la ligne (plusieurs lignes) au lieu de tronquer avec « … ».
              textOverflow: multiline ? "clip" : "ellipsis",
              whiteSpace: multiline ? "normal" : "nowrap",
              flex: 1,
              fontWeight: 700,
            }}
          >
            {value || "— Thème —"}
          </span>
          <span
            style={{
              flexShrink: 0,
              // Chevron calé sur la police du texte (≤ themeFont) : il ne dicte plus la
              // hauteur de la ligne → c'est le texte (1.3) qui pilote, comme le textarea.
              fontSize: bu(22),
              color: themeColor,
              lineHeight: 1,
            }}
          >
            ▾
          </span>
        </div>
        {open &&
          coords &&
          createPortal(
            <div
              ref={menuRef}
              className="user-theme-picker-menu"
              style={{
                position: "fixed",
                top: coords.top,
                left: coords.left,
                minWidth: Math.max(coords.width, 80),
                background: "var(--surface)",
                border: `1px solid ${themeColor}`,
                borderRadius: 3,
                fontSize: menuFont,
                color: "var(--text)",
                zIndex: 10000,
                maxHeight: 200,
                overflowY: "auto",
                boxShadow: "0 4px 12px rgba(0,0,0,.3)",
                padding: "1px 0",
              }}
            >
              {items.map((label) => (
                // biome-ignore lint/a11y/useKeyWithClickEvents: item de menu (Échap ferme)
                <div
                  key={label || "__none__"}
                  style={{
                    padding: "1px 6px",
                    lineHeight: 1.1,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    background: label === value ? "rgba(255,255,255,.06)" : undefined,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = hoverBg;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background =
                      label === value ? "rgba(255,255,255,.06)" : "";
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(label);
                    setOpen(false);
                  }}
                >
                  {label || "— Thème —"}
                </div>
              ))}
            </div>,
            document.body,
          )}
      </>
    );
  }

  // Mode libre — textarea auto-redimensionné (comportement historique legacy).
  return (
    <textarea
      ref={taRef}
      className={`slot-spots ${validated ? "theme-validated" : "theme-pending"}`}
      // Mobile : data-tip="" masque l'info-bulle du badge au tap/survol du champ thème.
      data-tip={big ? "" : undefined}
      placeholder="Saisissez un thème"
      value={value}
      rows={1}
      style={{
        color: themeColor,
        WebkitTextFillColor: themeColor,
        fontSize: themeFont,
        fontWeight: 700,
        // multiline : autorise le retour à la ligne (écrase le `white-space:nowrap` de la
        // règle .user-agenda-mine-badge .slot-spots) ; l'auto-resize suit la hauteur du texte.
        ...(multiline ? { whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.1 } : null),
      }}
      onMouseDown={(e) => e.stopPropagation()}
      // Sans ça, le clic remonterait au créneau parent (.agenda-block → création de résa).
      // stopPropagation → le clic ne fait que focus le champ thème.
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
      onKeyUp={(e) => e.stopPropagation()}
      onChange={(e) => {
        e.stopPropagation();
        onChange(e.target.value);
      }}
    />
  );
}

// Badge « ma réservation » / sélection en brouillon — RENDU UNIQUE partagé par les
// réservations existantes de l'usager ET les sélections en attente (pending add).
// Les deux sont LE MÊME badge : seules la source des compteurs/thème et les callbacks
// diffèrent (réservation enregistrée ↔ brouillon). Vert si validé, orange sinon.
function MineBadge({
  validated,
  markedRemoval,
  moving = false,
  mobile = false,
  gaugeOn,
  themeMode,
  themesMode,
  themes,
  enfants,
  accompagnants,
  theme,
  remaining,
  stateLabel,
  closeIcon,
  onClose,
  onBump,
  onSetCount,
  onSetTheme,
  title,
  locked = false,
  draggable = false,
  dragging = false,
  onDragPointerDown,
  dragFullSurface = false,
  shortSlot = false,
  veryShortSlot = false,
}: {
  validated: boolean;
  markedRemoval: boolean;
  // Déplacement en attente (pendingMove) : badge atténué + libellé « Déplacement en cours… ».
  moving?: boolean;
  // Mobile : éléments de jauge (− chiffre +) et thème 2× plus gros.
  mobile?: boolean;
  gaugeOn: boolean;
  themeMode: boolean;
  themesMode: "libre" | "liste";
  themes: string[];
  enfants: number;
  accompagnants: number;
  theme: string;
  remaining: number;
  stateLabel: string;
  closeIcon: string;
  onClose: () => void;
  onBump: (field: "enfants" | "accompagnants", delta: 1 | -1) => void;
  onSetCount: (field: "enfants" | "accompagnants", value: number) => void;
  onSetTheme: (v: string) => void;
  // Infobulle au survol : horaire + état + participants + semaine.
  title?: string;
  // Validation bloquante : résa validée verrouillée → pas de croix de suppression
  // (port legacy `_blockedDelete` / `noCloseBtn`).
  locked?: boolean;
  // Glisser-déplacer : le badge devient draggable (brouillon / résa « en attente »).
  draggable?: boolean;
  dragging?: boolean;
  // Pointerdown sur une zone de préhension (poignée, ou tout le badge sur mobile) → amorce
  // le drag « pointer events » (souris + tactile), cf. usePointerDrag côté parent.
  onDragPointerDown?: (e: React.PointerEvent) => void;
  // Mobile : tout le badge est déplaçable (pas seulement la poignée).
  dragFullSurface?: boolean;
  // Créneau court (≤ 30 min) : sort l'icône d'état du flux (position absolue en haut) pour
  // libérer la hauteur du badge ras au profit du thème.
  shortSlot?: boolean;
  // Créneau très court (≤ 15 min) : décale les compteurs (nombre d'enfants/adultes) de 2px
  // vers le bas.
  veryShortSlot?: boolean;
}) {
  // Couleur du texte/éléments : vert foncé si validé (lisible sur le fond vert clair
  // du badge), orange sinon (jamais « inherit »).
  const gColor = validated ? "#3e7e2f" : "#b2a478";
  const stateColor = markedRemoval ? "var(--danger)" : moving ? "var(--warn)" : gColor;
  const hasWidgets = gaugeOn || themeMode;
  // En déplacement : on neutralise l'édition (jauge/thème) pour afficher le libellé d'état.
  const editable = gaugeOn && !markedRemoval && !moving;
  const icon = validated ? "✔" : "⏳";
  // Créneau court EN MODE JAUGE : le thème prend la place du slot-icon central (entre les
  // colonnes Enfants/Adultes) et s'affiche sur plusieurs lignes, pour exploiter la largeur
  // du badge au lieu de sa hauteur (trop faible à 30 min). Sinon le thème reste en bas.
  const themeInMiddle = shortSlot && editable && themeMode && !markedRemoval;
  const themeField =
    themeMode && !markedRemoval ? (
      <ThemeField
        value={theme}
        validated={validated}
        themesMode={themesMode}
        themes={themes}
        onChange={onSetTheme}
        big={mobile}
        multiline={themeInMiddle}
      />
    ) : null;
  // Mobile : tout le badge amorce le drag ; desktop : uniquement via la poignée.
  const bodyDraggable = draggable && dragFullSurface;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: badge (onClick = stopPropagation seul)
    <div
      className={`user-agenda-mine-badge${hasWidgets ? " has-widgets" : ""} ${
        validated ? "is-validated" : "is-pending"
      }`}
      data-tip={title}
      // Mobile (dragFullSurface) : tout le badge amorce le drag (pointer events), pas
      // seulement la poignée. touch-action:none → le geste ne scrolle pas la page.
      onPointerDown={bodyDraggable ? onDragPointerDown : undefined}
      style={{
        position: "relative",
        top: "auto",
        left: "auto",
        transform: "none",
        // Le badge REMPLIT la cellule créneau : sa taille = celle du créneau, et tous ses
        // éléments (exprimés en cqmin via `bu`) s'y dimensionnent proportionnellement.
        // minHeight:0 indispensable : neutralise à la fois le `min-height:38px` de la classe
        // .has-widgets ET le `min-height:auto` par défaut d'un item flex — sinon le badge ne
        // peut pas descendre sous ~38px et DÉPASSE un créneau court (ex. 30 min ≈ 24px).
        width: "100%",
        height: "100%",
        minHeight: 0,
        maxWidth: "100%",
        maxHeight: "none",
        boxShadow: "2px 2px 4px rgba(0, 0, 0, .28)",
        // Curseur : `grab` quand tout le corps est déplaçable (mobile), sinon `default`
        // (sur desktop le drag passe par la poignée ; la croix × garde son pointer).
        cursor: bodyDraggable ? "grab" : "default",
        touchAction: bodyDraggable ? "none" : undefined,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        // Jauge : interligne du badge (entre compteurs / thème / état), proportionnel au
        // créneau. En mode jauge les éléments se suffisent → pas de gap supplémentaire.
        gap: editable ? 0 : bu(4),
        textAlign: "center",
        // Créneau court (≤ 30 min) : padding horizontal 1rem (border-box → la largeur reste
        // celle de la cellule, le contenu est juste resserré).
        boxSizing: "border-box",
        padding: shortSlot ? "0 1rem" : undefined,
        opacity: dragging ? 0.4 : markedRemoval || moving ? 0.55 : 1,
      }}
      // Clic sur le CORPS : aucune action. On stoppe seulement la propagation pour ne pas
      // déclencher la création de réservation du créneau parent (.agenda-block). Les seules
      // actions du badge sont la croix × (supprimer) et la poignée (déplacer).
      onClick={(e) => e.stopPropagation()}
    >
      {/* × : supprime la réservation (ou le brouillon) — caché, affiché au survol via CSS.
          Masqué si la résa est verrouillée (validation bloquante) ou déjà en cours de
          suppression (plus de bouton « Rétablir » : on annule via « Annuler »). */}
      {!locked && !markedRemoval && (
        <button
          type="button"
          className="slot-btn-close"
          data-tip="Supprimer"
          aria-label="Supprimer"
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          // Pas de `font: inherit` ni de fontSize inline ici : ils écrasaient la taille
          // voulue par .slot-btn-close (1.15rem) en la rabattant sur la police héritée du
          // bloc agenda (.68rem), d'où une croix minuscule. On laisse la CSS décider.
          style={{ border: "none", padding: 0 }}
        >
          {closeIcon}
        </button>
      )}
      {/* Poignée de glissement : prise dédiée pour amorcer le drag sur desktop (le corps
          n'y est pas draggable). Sur mobile, tout le corps est aussi déplaçable (cf.
          dragFullSurface). Affichée au survol, en haut au centre. Le CLIC est neutralisé
          pour éviter l'action rapide du corps si l'usager relâche sans déplacer. */}
      {draggable && (
        <span
          className="slot-drag-handle"
          data-tip="Glisser pour déplacer"
          aria-hidden
          // Grip remonté (on garde le translateX(-50%) de la CSS) : −3px sur créneau très
          // court (≤ 15 min, + padding resserré), −2px sur créneau court (≤ 30 min).
          style={
            veryShortSlot
              ? { transform: "translateX(-50%) translateY(-3px)", padding: `${bu(3.7)} ${bu(8)}` }
              : shortSlot
                ? { transform: "translateX(-50%) translateY(-2px)" }
                : undefined
          }
          // Drag « pointer events » : stopPropagation pour ne pas ré-armer via le corps.
          onPointerDown={(e) => {
            e.stopPropagation();
            onDragPointerDown?.(e);
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Grip en cercles vectoriels (ronds à toute taille). Créneau très court (≤ 15 min) :
              7 points sur UNE seule ligne (viewBox plus bas) ; sinon 14 points (2 lignes × 7). */}
          <svg
            className="slot-drag-grid"
            viewBox={veryShortSlot ? "0 0 34 4" : "0 0 34 9"}
            aria-hidden="true"
          >
            {(veryShortSlot ? [2] : [2, 7]).map((cy) =>
              [2, 7, 12, 17, 22, 27, 32].map((cx) => (
                <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.6" />
              )),
            )}
          </svg>
        </span>
      )}
      {editable ? (
        // Graphique jauge (legacy _createGaugeBadge) : deux colonnes Enfants | icône |
        // Adultes ; chaque compteur = bouton rond − à gauche, nombre, bouton rond + à
        // droite (clic-maintenu), + libellé en dessous.
        <div
          className="gauge-badge"
          // Mobile : data-tip="" masque l'info-bulle du badge au tap/survol des compteurs
          // (le délégué `onAgendaTip` résout via closest[data-tip] → chaîne vide = pas de bulle).
          data-tip={mobile ? "" : undefined}
          style={{
            display: "flex",
            alignItems: "center",
            // Ligne unique « − chiffre + ⏳ − chiffre + » : space-evenly répartit le même
            // espace partout → tous les espacements se resserrent au même rythme avec la
            // largeur. (Thème central : on garde center, le thème prend la place restante.)
            justifyContent: themeInMiddle ? "center" : "space-evenly",
            gap: 0,
            width: "100%",
            cursor: "default",
            paddingTop: 0,
            color: gColor,
          }}
        >
          {/* Jauge GROUPÉE : 3 unités (groupe Enfants | icône | groupe Adultes). Chaque groupe
              = [− chiffre +] à espacement interne NUL → les boutons collent à leur chiffre, même
              quand le badge est large ; space-evenly ne distribue l'espace qu'ENTRE les groupes. */}
          <div
            style={{
              // Desktop : groupe flex (gap 0 → boutons collés au chiffre). Mobile :
              // display:contents → le wrapper s'efface, les 7 éléments redeviennent directs et
              // space-evenly les espace uniformément (comportement d'avant le regroupement).
              display: dragFullSurface ? "contents" : "flex",
              alignItems: "center",
              gap: 0,
              minWidth: 0,
            }}
          >
            <StepBtn
              sign="−"
              color={gColor}
              onClick={() => onBump("enfants", -1)}
              isMobile={dragFullSurface}
            />
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                // Largeur = celle du chiffre : le libellé (en flux, dessous) déborde
                // symétriquement (text-align center) sans élargir l'élément, et compte dans la
                // hauteur → centrage vertical. minWidth = plancher de lisibilité du chiffre.
                width: bu(40),
                minWidth: bu(30),
              }}
            >
              <input
                type="number"
                // Valeur modifiable UNIQUEMENT via les boutons − / + : pas de saisie directe.
                readOnly
                tabIndex={-1}
                inputMode="none"
                min={1}
                max={remaining}
                value={enfants}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onChange={(e) => onSetCount("enfants", Number.parseInt(e.target.value, 10))}
                style={{
                  width: bu(40),
                  maxWidth: "100%",
                  height: bu(36),
                  boxSizing: "border-box",
                  textAlign: "center",
                  fontSize: bu(38),
                  background: "transparent",
                  border: "none",
                  color: gColor,
                  fontWeight: 600,
                  padding: 0,
                  cursor: "default",
                  transform: veryShortSlot ? "translateY(3px)" : undefined,
                }}
              />
              <span
                className="gauge-txt"
                style={{
                  // Boîte = largeur du TEXTE (max-content) → align-items:center du wrapper la
                  // centre sur le chiffre, débordement symétrique sans élargir le wrapper.
                  width: "max-content",
                  color: gColor,
                  fontSize: bu(20),
                  lineHeight: 1,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  transform: veryShortSlot ? "translateY(3px)" : undefined,
                }}
              >
                {enfants > 1 ? "Enfants" : "Enfant"}
              </span>
            </div>
            <StepBtn
              sign="+"
              color={gColor}
              onClick={() => onBump("enfants", 1)}
              isMobile={dragFullSurface}
            />
          </div>
          {/* Centre : icône d'état ✔/⏳ — OU, sur créneau court, le thème (themeInMiddle). */}
          {themeInMiddle ? (
            <div
              style={{
                flex: 1,
                minWidth: 0,
                alignSelf: "flex-end",
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "center",
                transform: veryShortSlot ? "translateY(-3px)" : undefined,
              }}
            >
              {themeField}
            </div>
          ) : (
            <span
              className="slot-icon"
              style={{
                flexShrink: 0,
                display: "flex",
                justifyContent: "center",
                alignSelf: "flex-start",
                fontSize: bu(35),
              }}
            >
              {icon}
            </span>
          )}
          <div
            style={{
              // Desktop : groupe flex (gap 0 → boutons collés au chiffre). Mobile :
              // display:contents → le wrapper s'efface, les 7 éléments redeviennent directs et
              // space-evenly les espace uniformément (comportement d'avant le regroupement).
              display: dragFullSurface ? "contents" : "flex",
              alignItems: "center",
              gap: 0,
              minWidth: 0,
            }}
          >
            <StepBtn
              sign="−"
              color={gColor}
              onClick={() => onBump("accompagnants", -1)}
              isMobile={dragFullSurface}
            />
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                // Largeur = celle du chiffre : le libellé (en flux, dessous) déborde
                // symétriquement (text-align center) sans élargir l'élément, et compte dans la
                // hauteur → centrage vertical. minWidth = plancher de lisibilité du chiffre.
                width: bu(40),
                minWidth: bu(30),
              }}
            >
              <input
                type="number"
                // Valeur modifiable UNIQUEMENT via les boutons − / + : pas de saisie directe.
                readOnly
                tabIndex={-1}
                inputMode="none"
                min={1}
                max={remaining}
                value={accompagnants}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onChange={(e) => onSetCount("accompagnants", Number.parseInt(e.target.value, 10))}
                style={{
                  width: bu(40),
                  maxWidth: "100%",
                  height: bu(36),
                  boxSizing: "border-box",
                  textAlign: "center",
                  fontSize: bu(38),
                  background: "transparent",
                  border: "none",
                  color: gColor,
                  fontWeight: 600,
                  padding: 0,
                  cursor: "default",
                  transform: veryShortSlot ? "translateY(3px)" : undefined,
                }}
              />
              <span
                className="gauge-txt"
                style={{
                  // Boîte = largeur du TEXTE (max-content), pas celle du wrapper : ainsi
                  // align-items:center du wrapper la centre sur le chiffre, et elle déborde
                  // symétriquement sans élargir le wrapper (espacements uniformes préservés).
                  // (.gauge-txt est display:block → sans ceci le texte débordait à droite.)
                  width: "max-content",
                  color: gColor,
                  fontSize: bu(20),
                  lineHeight: 1,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  transform: veryShortSlot ? "translateY(3px)" : undefined,
                }}
              >
                {accompagnants > 1 ? "Adultes" : "Adulte"}
              </span>
            </div>
            <StepBtn
              sign="+"
              color={gColor}
              onClick={() => onBump("accompagnants", 1)}
              isMobile={dragFullSurface}
            />
          </div>
        </div>
      ) : (
        <span
          className="slot-icon"
          style={{
            // Icône d'état des badges non-éditables (validé / en attente / à annuler).
            fontSize: bu(35),
            lineHeight: 1,
            width: bu(36),
            height: bu(36),
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            // Même couleur de texte que le mode jauge (vert si validé, orange sinon ;
            // rouge si retrait en attente), pour que la coche s'harmonise avec le reste.
            color: stateColor,
            // Créneau court (≤ 30 min, ~24px) : on décale l'icône d'état tout en haut, HORS
            // DU FLUX (position absolue), pour libérer la hauteur du badge. Le thème devient
            // alors le seul élément du flux → centré et visible au lieu d'être rogné en bas.
            ...(shortSlot
              ? { position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)" }
              : null),
          }}
        >
          {icon}
        </span>
      )}
      {/* Libellé d'état (hors mode jauge éditable). */}
      {!editable && stateLabel && (
        <span
          className="slot-spots"
          style={{
            fontSize: bu(20),
            fontWeight: 600,
            lineHeight: 1.3,
            background: "none",
            color: stateColor,
          }}
        >
          {stateLabel}
        </span>
      )}
      {/* Thème en bas — SAUF s'il a déjà été placé au centre (créneau court en mode jauge). */}
      {!themeInMiddle && themeField}
    </div>
  );
}

// Ligne « N enfant(s) M adulte(s) » de l'info-bulle au survol (port legacy _badgeTitle).
function participantsLabel(enfants: number, accompagnants: number): string {
  return `${enfants} enfant${enfants > 1 ? "s" : ""} ${accompagnants} adulte${
    accompagnants > 1 ? "s" : ""
  }`;
}

type Booking = {
  id: number;
  slotId: string;
  periodId: number;
  dayKey: string;
  week: string;
  bookingType: string;
  parentBookingId: number | null;
  enfants: number;
  accompagnants: number;
  theme: string;
  validated: boolean;
  pointage: Pointage;
  name: string;
  demandeur: string;
  structure: string;
  // Réservation de l'usager courant (agenda usager) → badge ✅/⏳ + annulation.
  mine: boolean;
  // Occurrence SYNTHÉTIQUE d'une récurrente détenue par l'usager, non matérialisée
  // pour la date affichée (semaine passée / hors délai) : badge « ma réservation »
  // en LECTURE SEULE (ni annulation ni édition — l'action passe par une occurrence
  // matérialisée). N'existe pas en base. Cf. blocsByDay (semaine réelle).
  synthetic?: boolean;
};
// badgeStyle : partagé via lib/agenda-core (fond « en attente » harmonisé sur
// #ffe6a7, aligné sur la grille admin — décision 2026-06).

// Bloc = UN créneau un jour donné (modèle partagé, cf. lib/agenda-core).
type Block = AgendaBlockBase<Booking>;

// Modèle « brouillon » de l'agenda usager (legacy pendingSelection/pendingCancellations) :
// on accumule des AJOUTS (créneaux à réserver) et des SUPPRESSIONS (mes résas à
// annuler) jusqu'au clic « Enregistrer → » qui valide tout via la modale récap.
type PendingAdd = {
  key: string;
  slotId: string;
  dayKey: string;
  periodId: number;
  week: string;
  ponctuel: boolean;
  label: string;
  theme: string;
  // Compteurs éditables en mode jauge (legacy _createGaugeBadge).
  enfants: number;
  accompagnants: number;
};
type PendingRemoval = { bookingId: number; label: string };
// Déplacement en attente d'une réservation existante vers un autre créneau (même type),
// committé via moveMyBookingAction. Clé = id de la réservation déplacée.
type PendingMove = {
  slotId: string;
  dayKey: string;
  periodId: number;
  week: string;
  ponctuel: boolean;
  label: string;
};
// Élément en cours de glisser-déplacer : un brouillon (pendingAdd) ou une réservation
// existante « en attente ». `ponctuel` borne les cibles valides au même type de créneau.
type DragItem =
  | { kind: "draft"; key: string; ponctuel: boolean }
  | { kind: "booking"; bookingId: number; ponctuel: boolean };

export function UserAgendaGrid({
  service,
  periods,
  slots,
  uniqueSlots,
  bookings: bookingsRaw,
  themes,
  modes,
  exercices,
  demandeurLabel,
  demandeurOpenOnSchoolHolidays,
  schoolHolidays,
  userInfo,
  autoRefreshSeconds,
  debugMode,
}: {
  service: Service;
  periods: Period[];
  slots: Slot[];
  uniqueSlots: UniqueSlot[];
  // Le serveur ne stocke plus dayKey : il est dérivé du slot (slotDay / date).
  bookings: Omit<Booking, "dayKey">[];
  themes: string[];
  modes: ServiceModes;
  exercices: Exercice[];
  demandeurLabel: string | null;
  // Vacances scolaires — part DEMANDEUR EFFECTIF : combinée (∧) avec la politique
  // de l'exercice couvrant chaque date (hors exercice = fermé).
  demandeurOpenOnSchoolHolidays: boolean;
  // Plages de vacances scolaires (YYYY-MM-DD) de la zone configurée.
  schoolHolidays: { dateStart: string; dateEnd: string }[];
  userInfo: {
    nom: string;
    prenom: string;
    email: string;
    niveau: string;
    enfants: number;
    accompagnants: number;
  };
  // Intervalle d'auto-rafraîchissement de la disponibilité, en secondes (0 = désactivé).
  autoRefreshSeconds: number;
  // Mode debug (app_config `debug.mode`, lu côté serveur) : affiche le bandeau dem-info.
  debugMode: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // Le jour (dayKey) d'une réservation se déduit désormais de son créneau : slotDay
  // pour un récurrent, jour de la date pour un ponctuel. (Le champ booking.dayKey a
  // été supprimé en base avec le passage au modèle « un slot = un jour ».)
  const bookings = useMemo<Booking[]>(() => {
    const recurDay = new Map(slots.map((s) => [s.id, s.slotDay ?? ""]));
    const uniqDay = new Map(uniqueSlots.map((s) => [s.id, dayKeyFromYmd(s.slotDate)]));
    return bookingsRaw.map((b) => ({
      ...b,
      dayKey: recurDay.get(b.slotId) ?? uniqDay.get(b.slotId) ?? "",
    }));
  }, [bookingsRaw, slots, uniqueSlots]);
  // Mode debug : SOURCE DE VÉRITÉ SERVEUR (app_config `debug.mode`, passée en prop et
  // lue à chaque requête). Plus aucun état client « collé » (localStorage / body class).
  const debug = debugMode;
  // Exercice courant : par défaut le plus récent (dernier après tri par libellé).
  const [currentExerciceId, setCurrentExerciceId] = useState<number | null>(
    exercices.length ? exercices[exercices.length - 1].id : null,
  );
  const [periodIdx, setPeriodIdx] = useState(0);
  // Vue verrouillée sur le type du demandeur de l'usager : récurrent → « Modèle de
  // période » ; non-récurrent (ponctuel) → « Semaine réelle » (dates). Figée à
  // l'initialisation (pas de bascule côté usager).
  const [mode] = useState<"model" | "realweek">(modes.recurringMode ? "model" : "realweek");
  const [anchorMonday, setAnchorMonday] = useState<string | null>(null);
  // Mode "Semaine réelle" : période active verrouillée. Sans ce verrou, on
  // re-dérive la période depuis la semaine à chaque ◀/▶ — et quand une semaine
  // chevauche la frontière de deux périodes contiguës, elle bascule sur la
  // voisine (dont les bornes laissent sortir). Cf. legacy _agendaPeriodUserPicked.
  const [rwPeriodId, setRwPeriodId] = useState<number | null>(null);
  const [weekAB, setWeekAB] = useState<"A" | "B">("A");
  // « Masquer les horaires sans créneau » : compacte les heures qui ne portent AUCUN
  // créneau. Préférence utilisateur (coché par défaut). Sur mobile, toujours forcée à
  // true (case masquée) — voir la valeur effective `hideNoSlot` dérivée plus bas.
  const [hideNoSlotPref, setHideNoSlotPref] = useState(true);
  // Modale "pile" : liste des réservations d'un créneau (clé slot+jour, recalculée
  // en direct depuis blocksByDay pour rester à jour après un refresh).
  // Glisser-déplacer (pointer events, cf. usePointerDrag) : élément en cours de drag + clé
  // "dayKey|slotId" du créneau survolé (drop target en surbrillance) + position du curseur
  // pour l'aperçu flottant (ghost). Remplace l'ancien drag HTML5 (inopérant au doigt).
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  // Aperçu de drag (ghost) = clone HTML du badge source, capturé au pointerdown, pour
  // retrouver l'ancien rendu « badge entier qui suit le pointeur » (et non un libellé texte).
  const dragGhostRef = useRef<{ html: string; width: number; height: number } | null>(null);
  // Brouillon de réservations (ajouts), d'annulations, de modifications de compteurs/thème,
  // et de déplacements sur mes réservations existantes (legacy : tout est éditable).
  const [pendingAdds, setPendingAdds] = useState<PendingAdd[]>([]);
  const [pendingRemovals, setPendingRemovals] = useState<PendingRemoval[]>([]);
  const [pendingUpdates, setPendingUpdates] = useState<
    Record<number, { enfants: number; accompagnants: number; theme: string }>
  >({});
  const [pendingMoves, setPendingMoves] = useState<Record<number, PendingMove>>({});
  const [committing, setCommitting] = useState(false);
  const [_commitError, setCommitError] = useState<string | null>(null);
  // Toast (variantes --success vert / --danger rouge), repris de la grille admin : centré
  // sur .app-main, bas de page, auto-dismiss ~4 s. Sert au verrou « une seule action »
  // (rouge) et au résultat de l'enregistrement du brouillon (vert création/modif/déplacement,
  // rouge suppression ou erreur).
  const [toast, setToast] = useState<{
    id: number;
    content: string;
    variant: "success" | "danger";
  } | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastCenterX, setToastCenterX] = useState<number | null>(null);
  const toastIdRef = useRef(0);
  function showToast(content: string, variant: "success" | "danger") {
    toastIdRef.current += 1;
    setToast({ id: toastIdRef.current, content, variant });
  }
  // Info-bulle flottante unique (texte data-tip / « Journées concernées »), factorisée
  // dans un hook partagé. Suspendue pendant la saisie d'un thème.
  const { tip, tipRef, onAgendaTip, clearTip } = useAgendaTooltip({
    getDates: (slotId, dayKey) => concernedDatesForBlock(slotId, dayKey),
    suppressed: () => isThemeBeingEdited(),
  });

  // Affichage/dissipation du toast : mesure le centre de .app-main (et non du viewport),
  // anime l'apparition, puis masque à ~4 s et retire à ~4,3 s. Relancé à chaque nouveau
  // toast via son id (cf. grille admin).
  // biome-ignore lint/correctness/useExhaustiveDependencies: relancé à chaque nouveau toast via son id
  useEffect(() => {
    if (!toast) return;
    const measure = () => {
      const main = document.querySelector(".app-main");
      if (main) {
        const r = main.getBoundingClientRect();
        setToastCenterX(r.left + r.width / 2);
      }
    };
    measure();
    window.addEventListener("resize", measure);
    setToastVisible(false);
    const raf = requestAnimationFrame(() => setToastVisible(true));
    const hide = window.setTimeout(() => setToastVisible(false), 4000);
    const clear = window.setTimeout(() => setToast(null), 4300);
    return () => {
      window.removeEventListener("resize", measure);
      cancelAnimationFrame(raf);
      window.clearTimeout(hide);
      window.clearTimeout(clear);
    };
  }, [toast?.id]);

  // ── Réglages d'ouverture PAR EXERCICE ──────────────────────────────────────
  // Une date hors de tout exercice est FERMÉE (CLOSED_OPENING — le service ne
  // porte plus de réglages). Ouverture effective d'une DATE : réglages de
  // l'exercice qui la couvre (politique vacances combinée ∧ demandeur), sinon
  // fermé. Décision produit : « la grille suit l'exercice couvrant chaque jour ».
  const openingForYmd = useCallback(
    (d: string): ExerciceOpening => {
      const ex = coveringForYmd(exercices, d);
      if (!ex) return CLOSED_OPENING;
      return {
        ...ex.opening,
        openOnSchoolHolidays: ex.opening.openOnSchoolHolidays && demandeurOpenOnSchoolHolidays,
      };
    },
    [exercices, demandeurOpenOnSchoolHolidays],
  );

  // Ouvertures « de contexte » pour les colonnes, les bornes de grille et la pause :
  // Modèle de période → l'exercice affiché ; Semaine réelle → chaque jour de la
  // semaine (dédupliqué) — une semaine à cheval sur deux exercices agrège les deux.
  const contextOpenings = useMemo(() => {
    if (mode === "model") {
      const ex = exercices.find((e) => e.id === currentExerciceId);
      return [ex ? openingForYmd(ex.dateStart || "") : CLOSED_OPENING];
    }
    if (!anchorMonday) return [CLOSED_OPENING];
    const uniq = new Map<string, ExerciceOpening>();
    for (let i = 0; i < 7; i++) {
      const o = openingForYmd(ymd(addDays(anchorMonday, i)));
      uniq.set(
        `${o.activeDays}|${o.morningStart}|${o.morningEnd}|${o.afternoonStart}|${o.afternoonEnd}`,
        o,
      );
    }
    return [...uniq.values()];
  }, [mode, exercices, currentExerciceId, anchorMonday, openingForYmd]);

  // Colonnes de la grille : jours actifs du contexte. En Modèle = ceux de l'exercice
  // affiché ; en Semaine réelle = UNION des exercices de la semaine (le grisage par
  // date via isDayDisabled ferme les dates des exercices où un jour est inactif).
  const days = useMemo(() => {
    const set = new Set<string>();
    for (const o of contextOpenings) {
      for (const d of o.activeDays.split(",")) {
        const t = d.trim();
        if (t) set.add(t);
      }
    }
    return ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"].filter((d) => set.has(d));
  }, [contextOpenings]);

  // ── Mobile : vue « un jour à la fois » ──────────────────────────────────────
  // Sur smartphone, la grille hebdo (5-7 colonnes) est illisible : on n'affiche
  // qu'UN jour, avec une navigation ◀ jour ▶. La logique par jour est inchangée.
  const [isMobile, setIsMobile] = useState(false);
  const [mobileDayIdx, setMobileDayIdx] = useState(0);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  const mobileDay = days.length ? (days[Math.min(mobileDayIdx, days.length - 1)] ?? null) : null;
  // Liste de jours réellement rendue : un seul jour sur mobile, toute la semaine sinon.
  const displayDays = useMemo(
    () => (isMobile && mobileDay ? [mobileDay] : days),
    [isMobile, mobileDay, days],
  );
  // Compactage « sans créneau » : valeur effective. Sur mobile, toujours désactivé (la
  // case est masquée et n'est donc pas modifiable) → on affiche toute la plage horaire.
  const hideNoSlot = isMobile ? false : hideNoSlotPref;

  // Bornes de la grille = amplitude des plages d'ouverture RÉELLEMENT ouvertes
  // (union sur les ouvertures de contexte). Une plage « fermée » (fin ≤ début,
  // p.ex. 00:00–00:00) est ignorée — sinon afternoonEnd=00:00 ramenait la fin de
  // grille à minuit et masquait toute la grille.
  const openRanges = useMemo(() => {
    const ranges: [number, number][] = [];
    for (const o of contextOpenings) {
      for (const [s, e] of [
        [toMinutes(o.morningStart, 9 * 60), toMinutes(o.morningEnd, 12 * 60)],
        [toMinutes(o.afternoonStart, 14 * 60), toMinutes(o.afternoonEnd, 18 * 60)],
      ] as const) {
        if (e > s) ranges.push([s, e]);
      }
    }
    return ranges;
  }, [contextOpenings]);
  const startMin = openRanges.length ? Math.min(...openRanges.map((r) => r[0])) : 9 * 60;
  const endMin = openRanges.length ? Math.max(...openRanges.map((r) => r[1])) : 18 * 60;
  const baseFirst = Math.floor(startMin / 60);
  const baseLast = Math.ceil(endMin / 60);

  // Périodes visibles = celles de l'exercice courant (toutes si aucun exercice).
  const visiblePeriods =
    currentExerciceId == null ? periods : periods.filter((p) => p.exerciceId === currentExerciceId);
  const selectedPeriodId = visiblePeriods[periodIdx]?.id ?? null;

  // « Aujourd'hui » n'a de sens que si la date du jour tombe dans une période de l'exercice
  // affiché (sinon le bouton renverrait hors de la plage visible) → on masque le bouton sinon.
  const todayYmd = ymd(new Date());
  const todayInVisiblePeriods = visiblePeriods.some(
    (p) => p.dateStart && p.dateEnd && p.dateStart <= todayYmd && p.dateEnd >= todayYmd,
  );

  // ── Mode "Semaine réelle" : semaine datée + période couvrant cette semaine ──
  const mondayStr = anchorMonday;
  const sundayStr = mondayStr ? ymd(addDays(mondayStr, 6)) : null;
  // Une période "couvre" une date si celle-ci est dans [dateStart, dateEnd].
  const periodCoveringDate = (d: string) =>
    periods.find((p) => p.dateStart && p.dateEnd && p.dateStart <= d && p.dateEnd >= d) ?? null;
  // Période active : priorité à celle verrouillée (rwPeriodId) tant qu'elle
  // intersecte la semaine — sinon on dérive depuis l'ancre (lundi puis mercredi,
  // pour les périodes commençant en milieu de semaine). Cf. legacy l.6469-6480.
  const lockedPeriod =
    rwPeriodId != null
      ? (periods.find(
          (p) =>
            p.id === rwPeriodId &&
            mondayStr != null &&
            sundayStr != null &&
            p.dateStart != null &&
            p.dateEnd != null &&
            p.dateStart <= sundayStr &&
            p.dateEnd >= mondayStr,
        ) ?? null)
      : null;
  const coveringPeriod =
    mondayStr && sundayStr
      ? (lockedPeriod ??
        periodCoveringDate(mondayStr) ??
        periodCoveringDate(ymd(addDays(mondayStr, 3))))
      : null;
  // En semaine réelle sans période couvrante, -1 ne matche rien → aucun bloc.
  const effectivePeriodId = mode === "realweek" ? (coveringPeriod?.id ?? -1) : selectedPeriodId;

  // Dates (YYYY-MM-DD) des créneaux ponctuels AUTONOMES (datés) réservables — sert au
  // mode « Masquer les horaires sans créneau » pour sauter aux semaines portant au moins
  // un créneau et (dés)activer ◀/▶. Trié croissant. Mémoïsé : recalculé sinon à chaque
  // rendu (survol/drag), hideNoSlot étant actif par défaut (audit perf).
  const uniqSlotDates = useMemo(
    () =>
      uniqueSlots
        .filter((s) => !s.parentSlotId && s.slotDate && (s.capacity ?? service.capacity) > 0)
        .map((s) => s.slotDate as string)
        .sort(),
    [uniqueSlots, service.capacity],
  );
  // Parités A/B couvertes par les créneaux RÉCURRENTS de chaque période (un créneau
  // « A,B » couvre les deux). Les récurrents se répètent chaque semaine de la période →
  // une semaine porte un créneau si sa parité y figure (ou hors mode A/B).
  const recurSlotAbByPeriod = useMemo(() => {
    const map = new Map<number, Set<"A" | "B">>();
    for (const s of slots) {
      if (s.periodId == null || s.periodId <= 0) continue;
      if ((s.capacity ?? service.capacity) <= 0) continue;
      const set = map.get(s.periodId) ?? new Set<"A" | "B">();
      for (const w of parseWeeks(s.weeks)) set.add(w);
      map.set(s.periodId, set);
    }
    return map;
  }, [slots, service.capacity]);

  // Une semaine (lundi → dimanche) contient-elle au moins un créneau visible ?
  // - créneau ponctuel daté dans la semaine, OU
  // - créneau récurrent de la période couvrant la semaine, de parité A/B compatible.
  const weekHasSlot = (monday: string): boolean => {
    const sunday = ymd(addDays(monday, 6));
    if (uniqSlotDates.some((d) => d >= monday && d <= sunday)) return true;
    const p = periodCoveringDate(monday) ?? periodCoveringDate(ymd(addDays(monday, 3)));
    if (p == null) return false;
    const ab = recurSlotAbByPeriod.get(p.id);
    if (!ab || ab.size === 0) return false;
    if (!modes.abMode) return true; // pas de distinction A/B → tout récurrent compte
    return ab.has(slotWeekTag(monday));
  };
  // Existe-t-il une semaine AVEC créneau au-delà de `monday` dans la direction donnée,
  // sans sortir de la période active ? (pour activer/désactiver ◀/▶ en hideNoSlot)
  const hasSlotWeekBeyond = (monday: string, dir: 1 | -1): boolean => {
    const startB = coveringPeriod?.dateStart;
    const endB = coveringPeriod?.dateEnd;
    let cur = ymd(addDays(monday, dir * 7));
    for (let i = 0; i < 260; i++) {
      const sunday = ymd(addDays(cur, 6));
      if (endB && cur > endB) break;
      if (startB && sunday < startB) break;
      if (weekHasSlot(cur)) return true;
      cur = ymd(addDays(cur, dir * 7));
    }
    return false;
  };

  // Bornes de navigation hebdo : on reste dans la période sélectionnée (celle qui
  // couvre la semaine courante) et on ne navigue pas au-delà de ses dates.
  // En mode hideNoSlot, on désactive aussi ◀/▶ s'il n'existe plus aucune semaine
  // AVEC créneau dans la direction (port legacy).
  // Mémoïsé : hasSlotWeekBeyond balaie jusqu'à 260 semaines — à ne recalculer que
  // quand les données ou la semaine changent, pas à chaque survol/drag (audit perf).
  // biome-ignore lint/correctness/useExhaustiveDependencies: hasSlotWeekBeyond est une closure recréée à chaque rendu ; ses entrées réelles sont listées (uniqSlotDates, recurSlotAbByPeriod, coveringPeriod, periods, modes.abMode).
  const { canWeekPrev, canWeekNext } = useMemo(
    () => ({
      canWeekPrev: mondayStr
        ? (coveringPeriod?.dateStart
            ? ymd(addDays(mondayStr, -1)) >= coveringPeriod.dateStart
            : true) &&
          (!hideNoSlot || hasSlotWeekBeyond(mondayStr, -1))
        : false,
      canWeekNext: mondayStr
        ? (coveringPeriod?.dateEnd ? ymd(addDays(mondayStr, 7)) <= coveringPeriod.dateEnd : true) &&
          (!hideNoSlot || hasSlotWeekBeyond(mondayStr, 1))
        : false,
    }),
    [
      mondayStr,
      hideNoSlot,
      coveringPeriod,
      uniqSlotDates,
      recurSlotAbByPeriod,
      periods,
      modes.abMode,
    ],
  );

  // Navigation hebdo (◀/▶) : en mode hideNoSlot, on saute aux semaines AYANT au moins
  // un créneau (ponctuel OU récurrent — port legacy shiftUserAgendaWeek), bornée à la
  // période active.
  function shiftWeek(deltaWeeks: number) {
    if (!mondayStr) return;
    let newAnchor = ymd(addDays(mondayStr, deltaWeeks * 7));
    if (hideNoSlot && deltaWeeks !== 0) {
      const step = deltaWeeks > 0 ? 7 : -7;
      const MAX_ITER = 260;
      let iter = 0;
      while (iter++ < MAX_ITER) {
        if (weekHasSlot(newAnchor)) break;
        if (!hasSlotWeekBeyond(newAnchor, deltaWeeks > 0 ? 1 : -1)) break;
        newAnchor = ymd(addDays(newAnchor, step));
      }
    }
    // Clamp à la période active : si le saut sort de la période, on annule.
    if (coveringPeriod?.dateStart && coveringPeriod.dateEnd) {
      const newSunday = ymd(addDays(newAnchor, 6));
      if (newAnchor > coveringPeriod.dateEnd || newSunday < coveringPeriod.dateStart) return;
    }
    setAnchorMonday(newAnchor);
  }

  // ── Navigation jour (mobile) ────────────────────────────────────────────────
  // Modèle de période (récurrent) : CYCLIQUE sur les jours de la semaine type.
  // Semaine réelle (ponctuel) : NON cyclique, à travers TOUTE la période (change de
  // semaine en franchissant les bords), bornée par les dates de la période.
  // Renvoie la cible { monday, idx } ou null si le déplacement est bloqué (bord de période).
  function mobileDayTarget(dir: 1 | -1): { monday: string | null; idx: number } | null {
    if (!days.length) return null;
    const idx = Math.min(mobileDayIdx, days.length - 1);
    if (mode === "model") {
      if (days.length <= 1) return null;
      return { monday: anchorMonday, idx: (idx + dir + days.length) % days.length };
    }
    if (!mondayStr) return null;
    let tIdx = idx + dir;
    let tMon = mondayStr;
    if (tIdx < 0) {
      tMon = ymd(addDays(mondayStr, -7));
      tIdx = days.length - 1;
    } else if (tIdx > days.length - 1) {
      tMon = ymd(addDays(mondayStr, 7));
      tIdx = 0;
    }
    const tDate = ymd(addDays(tMon, DAY_OFFSET[days[tIdx]] ?? 0));
    if (coveringPeriod?.dateStart && tDate < coveringPeriod.dateStart) return null;
    if (coveringPeriod?.dateEnd && tDate > coveringPeriod.dateEnd) return null;
    return { monday: tMon, idx: tIdx };
  }
  function mobileGoDay(dir: 1 | -1) {
    const t = mobileDayTarget(dir);
    if (!t) return;
    if (mode === "realweek" && t.monday && t.monday !== mondayStr) setAnchorMonday(t.monday);
    setMobileDayIdx(t.idx);
  }

  // Libellé daté de chaque jour de la semaine réelle, par dayKey.
  const weekDateByDay = useMemo(() => {
    const out: Record<string, string> = {};
    if (mondayStr) {
      for (const d of days) out[d] = shortDateFmt.format(addDays(mondayStr, DAY_OFFSET[d] ?? 0));
    }
    return out;
  }, [mondayStr, days]);
  // Jour fermé : uniquement en semaine réelle, pour un jour hors de la période
  // active, OU férié quand le service ferme les fériés, OU en vacances scolaires
  // quand le demandeur de l'usager ferme pendant les vacances. Contrairement au
  // legacy (grisage purement visuel), on bloque ici aussi toutes les interactions
  // → l'usager ne peut pas réserver ce jour-là (créneau miroir inclus).
  // useCallback : référence stable requise pour mémoïser `occupiedQ` (sinon recalcul à
  // chaque rendu, donc à chaque survol/drag). coveringPeriod est une réf stable (élément
  // du tableau `periods` via find), les helpers (ymd/isFrenchHoliday/…) sont module-level.
  const isDayDisabled = useCallback(
    (dayKey: string): boolean => {
      if (mode !== "realweek" || !mondayStr) return false;
      const dayYmd = ymd(addDays(mondayStr, DAY_OFFSET[dayKey] ?? 0));
      // Réglages de l'exercice couvrant CE jour (les colonnes étant l'union des
      // jours actifs, un jour inactif pour cet exercice est fermé ici).
      const o = openingForYmd(dayYmd);
      if (
        !o.activeDays
          .split(",")
          .map((s) => s.trim())
          .includes(dayKey)
      ) {
        return true;
      }
      if (
        coveringPeriod?.dateStart &&
        coveringPeriod.dateEnd &&
        (dayYmd < coveringPeriod.dateStart || dayYmd > coveringPeriod.dateEnd)
      ) {
        return true;
      }
      if (!o.openOnHolidays && isFrenchHoliday(dayYmd)) return true;
      // Vacances scolaires : fermé si l'exercice (∧ demandeur) ferme pendant les vacances.
      return !o.openOnSchoolHolidays && inSchoolHolidayRange(dayYmd, schoolHolidays ?? []);
    },
    [mode, mondayStr, coveringPeriod, openingForYmd, schoolHolidays],
  );
  // Jour férié français (exercice fermé les fériés), en semaine réelle.
  const isHolidayDay = (dayKey: string): boolean => {
    if (mode !== "realweek" || !mondayStr) return false;
    const dayYmd = ymd(addDays(mondayStr, DAY_OFFSET[dayKey] ?? 0));
    if (openingForYmd(dayYmd).openOnHolidays) return false;
    return isFrenchHoliday(dayYmd);
  };
  // Classe de grisage : jour férié → hachis de la pause méridienne (is-holiday) ;
  // hors période / vacances scolaires → hachis dédié (is-out-of-period).
  const outOfPeriodCls = (dayKey: string): string => {
    if (!isDayDisabled(dayKey)) return "";
    return isHolidayDay(dayKey) ? " is-holiday" : " is-out-of-period";
  };

  // ── Semaines A/B ── (dérivé de la matrice demandeurs, pas de la colonne service)
  const abMode = modes.abMode;
  const realWeekParity: "A" | "B" | null = mondayStr ? slotWeekTag(mondayStr) : null;
  // Semaine effective filtrée : en modèle = choix A/B ; en réel = parité de la date.
  const effectiveWeek: "A" | "B" | null = abMode
    ? mode === "model"
      ? weekAB
      : realWeekParity
    : null;

  // La plage horaire affichée reste fixe (matin → après-midi). « Masquer les
  // horaires sans créneau » ne resserre pas la plage : il COMPACTE les quarts
  // d'heure sans créneau (cf. legacy renderAgendaWeekly), géré plus bas via `quarters`.
  const firstHour = baseFirst;
  const lastHour = baseLast;

  const gridStartMin = firstHour * 60;
  const gridEndMin = lastHour * 60;
  const _QUARTER_H = ROW_H / 4; // px par tranche de 15 min

  // Ids des créneaux ponctuels AUTONOMES (non miroirs) : affichés en vert et en
  // lecture seule (on neutralise la création/déplacement de résa récurrente dessus ;
  // la réservation ponctuelle relève d'un autre flux).
  const uniqueIdSet = useMemo(
    () => new Set(uniqueSlots.filter((s) => !s.parentSlotId).map((s) => s.id)),
    [uniqueSlots],
  );
  // Index slot ponctuel → slot (lookup O(1)), au lieu d'un .find() linéaire répété par bloc.
  const uniqSlotById = useMemo(() => new Map(uniqueSlots.map((s) => [s.id, s])), [uniqueSlots]);
  // Idem pour les créneaux récurrents.
  const recurSlotById = useMemo(() => new Map(slots.map((s) => [s.id, s])), [slots]);
  // Slots miroirs → parent + date : rattache les réservations-enfants à la cellule du
  // slot parent en « Semaine réelle » (elles y portent le pointage, en lecture seule
  // côté usager).
  const mirrorMap = useMemo(
    () =>
      new Map(
        uniqueSlots
          .filter((s) => s.parentSlotId)
          .map((s) => [s.id, { parentSlotId: s.parentSlotId as string, slotDate: s.slotDate }]),
      ),
    [uniqueSlots],
  );

  // ── Pause méridienne (port legacy renderAgendaWeekly) ───────────────────────
  // Zone entre morningEnd et afternoonStart. Si > 30 min, on COMPACTE : on ne garde
  // que 2 quarts visuels (30 min) — les quarts au-delà de lunchStart+30 sont sautés.
  // Le reste de la grille (lignes, heures, blocs, clics) suit un mapping par quarts
  // d'heure VISIBLES (mapMinToY), au lieu d'un mapping linéaire heure/heure.
  // Bornes de pause de l'ouverture de contexte principale (exercice affiché en
  // Modèle ; premier exercice de la semaine en Semaine réelle).
  const lunchStart = toMinutes(contextOpenings[0]?.morningEnd ?? "", Number.NaN);
  const lunchEnd = toMinutes(contextOpenings[0]?.afternoonStart ?? "", Number.NaN);
  const hasLunch =
    Number.isFinite(lunchStart) &&
    Number.isFinite(lunchEnd) &&
    lunchEnd > lunchStart &&
    lunchStart >= gridStartMin &&
    lunchEnd <= gridEndMin;
  const lunchSkipFrom = hasLunch && lunchEnd - lunchStart > 30 ? lunchStart + 30 : null;

  // ── « Masquer les horaires sans créneau » (compactage, port legacy) ─────────
  // On ne resserre pas la plage : on construit l'ensemble des quarts d'heure portant
  // un CRÉNEAU (granularité HEURE : dès qu'un créneau — réservé OU vide réservable —
  // touche une heure, ses 4 quarts sont conservés pour garder le repère "heure").
  // Les quarts sans créneau sont ensuite sautés dans `quarters`.
  // Mémoïsé : double boucle slots × uniqueSlots construisant un Set — sinon recalculé à
  // CHAQUE rendu (donc à chaque survol/drag, via onMouseMove/setDragPos). Cf. P2 audit.
  const occupiedQ = useMemo(() => {
    const set = new Set<number>();
    if (!hideNoSlot) return set;
    const occupiedHours = new Set<number>();
    const addHours = (sMin: number, eMin: number) => {
      const s = Math.max(sMin, gridStartMin);
      const e = Math.min(eMin, gridEndMin);
      if (e <= s) return;
      for (let m = Math.floor(s / 60) * 60; m < e; m += 60) occupiedHours.add(m);
    };
    // Créneaux RÉCURRENTS visibles : période active, semaine A/B, jour ouvert, capacité.
    for (const s of slots) {
      if (effectivePeriodId != null && s.periodId !== effectivePeriodId) continue;
      if (abMode && effectiveWeek != null && !parseWeeks(s.weeks).includes(effectiveWeek)) continue;
      const dk = s.slotDay;
      // `displayDays` = jours réellement rendus (toute la semaine sur desktop, un
      // seul jour sur mobile) → sur mobile, on masque les heures vides DU jour affiché.
      if (!dk || !displayDays.includes(dk) || isDayDisabled(dk)) continue;
      if ((s.capacity ?? service.capacity) <= 0) continue;
      addHours(toMinutes(s.startTime, gridStartMin), toMinutes(s.endTime, gridStartMin + 60));
    }
    // Créneaux PONCTUELS autonomes datés dans la semaine affichée (Semaine réelle).
    if (mode === "realweek" && mondayStr) {
      const sunday = sundayStr ?? mondayStr;
      for (const u of uniqueSlots) {
        if (u.parentSlotId) continue;
        if (!u.slotDate || u.slotDate < mondayStr || u.slotDate > sunday) continue;
        const dk = dayKeyFromYmd(u.slotDate);
        if (!displayDays.includes(dk) || isDayDisabled(dk)) continue;
        if ((u.capacity ?? service.capacity) <= 0) continue;
        addHours(toMinutes(u.startTime, gridStartMin), toMinutes(u.endTime, gridStartMin + 60));
      }
    }
    // Étend chaque heure occupée à ses 4 quarts (dans [gridStartMin, gridEndMin]).
    for (const h of occupiedHours) {
      for (let q = h; q < h + 60; q += 15) {
        if (q >= gridStartMin && q < gridEndMin) set.add(q);
      }
    }
    return set;
  }, [
    hideNoSlot,
    slots,
    effectivePeriodId,
    abMode,
    effectiveWeek,
    displayDays,
    isDayDisabled,
    service.capacity,
    mode,
    mondayStr,
    sundayStr,
    uniqueSlots,
    gridStartMin,
    gridEndMin,
  ]);

  // Géométrie de la grille (quarts visibles + mapping minute↔pixel) mutualisée.
  // Mémoïsée : `mapMinToY` doit rester stable d'un rendu à l'autre pour que la mémo
  // des blocs par jour tienne (sinon recréée à chaque rendu = mémo invalide).
  // `occupiedQ` (compactage hideNoSlot) est construit ci-dessus côté usager.
  const { quarters, qIdx, totalH, mapMinToY, yToMin } = useMemo(
    () =>
      gridGeometry({
        gridStartMin,
        gridEndMin,
        lunchStart,
        lunchEnd,
        occupiedQ: hideNoSlot ? occupiedQ : null,
      }),
    [gridStartMin, gridEndMin, lunchStart, lunchEnd, hideNoSlot, occupiedQ],
  );

  const slotsParsed = useMemo(
    () =>
      slots.map((s) => ({
        ...s,
        startMin: toMinutes(s.startTime, gridStartMin),
        endMin: toMinutes(s.endTime, gridStartMin + 60),
      })),
    [slots, gridStartMin],
  );

  function slotAtClientY(colTop: number, clientY: number) {
    // y → minute via le mapping par quarts (gère le compactage de la pause).
    const minute = yToMin(clientY - colTop);
    return slotsParsed.find((s) => minute >= s.startMin && minute < s.endMin) ?? null;
  }

  const blocksByDay = useMemo(() => {
    // Créneaux ponctuels (datés) → en « Semaine réelle », on les projette sur le
    // jour de la semaine affichée correspondant à leur date, sous forme de slots
    // virtuels mono-jour : toute la logique de blocs/layout/rendu les traite alors
    // comme des créneaux normaux (legacy renderAgendaWeekly, branche realweek).
    const ponctuelSlots: Slot[] = [];
    if (mode === "realweek" && mondayStr) {
      const sunday = sundayStr ?? mondayStr;
      for (const u of uniqueSlots) {
        // Les miroirs (matérialisations de récurrents) sont déjà couverts par les
        // créneaux récurrents affichés directement → on ne projette que les ponctuels
        // autonomes (non miroirs), affichés en vert (cf. legacy).
        if (u.parentSlotId) continue;
        if (!u.slotDate || u.slotDate < mondayStr || u.slotDate > sunday) continue;
        const dk = dayKeyFromYmd(u.slotDate);
        if (!days.includes(dk)) continue;
        ponctuelSlots.push({
          id: u.id,
          startTime: u.startTime,
          endTime: u.endTime,
          capacity: u.capacity ?? service.capacity,
          slotDay: dk,
          // periodId aligné sur la période effective pour passer le filtre de période.
          periodId: effectivePeriodId,
          weeks: null,
          jauge: u.jauge,
          slotDate: u.slotDate,
        });
      }
    }
    const allSlots = ponctuelSlots.length ? [...slots, ...ponctuelSlots] : slots;
    const slotById = new Map(allSlots.map((s) => [s.id, s]));

    // Le créneau tourne-t-il sur la semaine active (filtre A/B) ?
    const slotMatchesWeek = (slot: Slot): boolean => {
      if (!abMode || effectiveWeek == null) return true;
      return parseWeeks(slot.weeks).includes(effectiveWeek);
    };

    // Réservations groupées par dayKey|slotId (filtrées période + semaine, comme avant).
    const groups = new Map<string, Booking[]>();
    const pushGroup = (key: string, b: Booking) => {
      const arr = groups.get(key) ?? [];
      arr.push(b);
      groups.set(key, arr);
    };
    const uniqSunday = sundayStr ?? mondayStr;
    // Lookup par id (l'ancien uniqueSlots.find dans la boucle était O(B×U)).
    const uniqById = new Map(uniqueSlots.map((s) => [s.id, s]));
    for (const b of bookings) {
      // Réservation DÉPLACÉE (brouillon) : rattachée à son créneau CIBLE, plus à son
      // créneau d'origine (used/full suivent automatiquement). Hors période/semaine
      // active (récurrent) ou hors « Semaine réelle » (ponctuel) → masquée.
      const mv = pendingMoves[b.id];
      if (mv) {
        if (mv.ponctuel) {
          if (mode !== "realweek" || !mondayStr) continue;
        } else {
          if (effectivePeriodId != null && mv.periodId !== effectivePeriodId) continue;
          if (effectiveWeek != null && mv.week !== effectiveWeek && mv.week !== "") continue;
        }
        pushGroup(`${mv.dayKey}|${mv.slotId}`, b);
        continue;
      }
      // Réservation-ENFANT (matérialisation d'une récurrente, sur un slot miroir daté) :
      // en « Semaine réelle », rattachée à la cellule du SLOT PARENT du jour affiché.
      // En mode « Modèle », c'est la parente qui s'affiche → enfant non projeté.
      const mir = mirrorMap.get(b.slotId);
      if (mir) {
        if (mode !== "realweek" || !mondayStr) continue;
        if (!mir.slotDate || mir.slotDate < mondayStr || (uniqSunday && mir.slotDate > uniqSunday))
          continue;
        const dk = dayKeyFromYmd(mir.slotDate);
        if (!days.includes(dk)) continue;
        pushGroup(`${dk}|${mir.parentSlotId}`, b);
        continue;
      }
      // Réservation PONCTUELLE autonome : rattachée à son bloc ponctuel projeté (clé jour =
      // jour de la date du créneau), en ignorant période/semaine.
      if (uniqueIdSet.has(b.slotId)) {
        if (mode !== "realweek" || !mondayStr) continue;
        const u = uniqById.get(b.slotId);
        if (!u?.slotDate || u.slotDate < mondayStr || (uniqSunday && u.slotDate > uniqSunday))
          continue;
        const dk = dayKeyFromYmd(u.slotDate);
        if (!days.includes(dk)) continue;
        pushGroup(`${dk}|${b.slotId}`, b);
        continue;
      }
      // Réservation RÉCURRENTE parente : en semaine réelle, ses enfants datés s'affichent
      // (ci-dessus) → on ne projette pas la parente. En mode Modèle, projection normale.
      if (mode === "realweek") continue;
      if (effectivePeriodId != null && b.periodId !== effectivePeriodId) continue;
      // A/B : une résa sans semaine ("") vaut pour les deux semaines.
      if (effectiveWeek != null && b.week !== effectiveWeek && b.week !== "") continue;
      pushGroup(`${b.dayKey}|${b.slotId}`, b);
    }

    // Occurrences de MES récurrentes NON matérialisées pour la date affichée (semaine
    // passée, ou occurrence encore dans le délai de réservation) : on les montre quand
    // même comme « ma réservation » EN LECTURE SEULE, au lieu de laisser la cellule
    // apparaître librement réservable (le serveur refuserait de toute façon une 2ᵉ
    // réservation du même créneau). Les jours fermés (hors période / férié / vacances)
    // sont écartés au rendu par dayBlocks → isDayDisabled, comme les cellules vides.
    if (mode === "realweek" && mondayStr) {
      for (const p of bookings) {
        if (!p.mine || p.bookingType !== "recurring" || p.parentBookingId !== null) continue;
        if (effectivePeriodId != null && p.periodId !== effectivePeriodId) continue;
        if (effectiveWeek != null && p.week !== effectiveWeek && p.week !== "") continue;
        const dk = slotById.get(p.slotId)?.slotDay;
        if (!dk || !days.includes(dk)) continue;
        const key = `${dk}|${p.slotId}`;
        // Occurrence déjà présente (enfant matérialisé de moi) → ne rien synthétiser.
        if (groups.get(key)?.some((x) => x.mine)) continue;
        pushGroup(key, { ...p, dayKey: dk, synthetic: true, pointage: null });
      }
    }

    // === Cellules candidates ===
    // Pour chaque créneau de la période active, sur chaque jour actif du service où
    // une capacité est configurée → cellule candidate (même sans réservation). C'est
    // ce qui fait apparaître les créneaux vides cliquables (port du legacy).
    const candidates = new Map<string, { slotId: string; dayKey: string }>();
    for (const slot of allSlots) {
      if (effectivePeriodId != null && slot.periodId !== effectivePeriodId) continue;
      if (!slotMatchesWeek(slot)) continue;
      // Modèle « un slot = un jour » : le créneau s'affiche sur SON jour (slotDay),
      // avec repli sur service.capacity si la capacité n'est pas fixée. Capacité 0 = fermé.
      const dayKey = slot.slotDay;
      if (!dayKey || !days.includes(dayKey)) continue;
      const c = slot.capacity ?? service.capacity;
      if (c <= 0) continue;
      candidates.set(`${dayKey}|${slot.id}`, { slotId: slot.id, dayKey });
    }
    // Union avec les cellules portant des réservations : aucune résa n'est perdue,
    // même sur un jour sans capacité configurée (donnée de seed incohérente possible).
    for (const key of groups.keys()) {
      if (candidates.has(key)) continue;
      const [dayKey, slotId] = key.split("|");
      candidates.set(key, { slotId, dayKey });
    }

    // Un bloc PAR CRÉNEAU (slot) regroupant toutes ses réservations (modèle legacy
    // renderAgendaWeekly), au lieu d'un bloc par réservation juxtaposé.
    const byDay: Record<string, Block[]> = {};
    for (const { slotId, dayKey } of candidates.values()) {
      const slot = slotById.get(slotId);
      if (!slot) continue;
      const list = groups.get(`${dayKey}|${slotId}`) ?? [];
      // Créneau sans horaire (début ou fin vide) → « journée entière ».
      const allday = !slot.startTime || !slot.endTime;
      const s = toMinutes(slot.startTime, gridStartMin);
      const e = toMinutes(slot.endTime, s + 60);
      const capacity = dayCap(slot, dayKey) ?? slot.capacity ?? service.capacity;
      // Places occupées, conditionnées à la jauge DE CE CRÉNEAU (slots.jauge, même
      // règle que l'agenda admin) : en jauge = enfants + adultes (accompagnants) ;
      // hors jauge = 1 par réservation.
      const used = slot.jauge
        ? list.reduce(
            (sum, b) => sum + gaugeUnits(b.enfants, b.accompagnants, service.gaugeAccompagnants),
            0,
          )
        : list.length;
      // Un bloc vide (used=0) n'est jamais "complet".
      const full = used >= capacity && used > 0;
      // biome-ignore lint/suspicious/noAssignInExpressions: init-or-push concis sur la map par jour
      (byDay[dayKey] ??= []).push({
        slotId,
        dayKey,
        bookings: list,
        startMin: s,
        endMin: e,
        leftPct: 0,
        widthPct: 100,
        used,
        capacity,
        full,
        jauge: slot.jauge,
        isAllDay: allday,
      });
    }
    // Chevauchements horaires : sur chaque colonne-jour, les créneaux qui se
    // recouvrent dans le temps sont répartis sur N colonnes (cf. _agendaLayoutOverlaps).
    // Chaque LayoutItem référence directement son bloc (id stable) → pas d'ambiguïté
    // si deux créneaux partagent les mêmes horaires.
    for (const dayKey of Object.keys(byDay)) {
      // Les blocs « journée entière » ne sont pas positionnés sur la grille horaire :
      // ils gardent leftPct:0/widthPct:100 et sont rendus dans la bande dédiée.
      const blocks = byDay[dayKey].filter((bl) => !bl.isAllDay);
      const items: (LayoutItem & { block: Block })[] = blocks.map((bl) => {
        const slot = slotById.get(bl.slotId);
        return {
          startMin: toMinutes(slot?.startTime ?? "", gridStartMin),
          endMin: toMinutes(slot?.endTime ?? "", gridStartMin + 60),
          col: 0,
          colCount: 1,
          block: bl,
        };
      });
      layoutOverlaps(items);
      for (const it of items) {
        it.block.leftPct = it.col * (100 / it.colCount);
        it.block.widthPct = 100 / it.colCount;
      }
    }
    return byDay;
  }, [
    bookings,
    pendingMoves,
    slots,
    uniqueSlots,
    uniqueIdSet,
    mirrorMap,
    mode,
    mondayStr,
    sundayStr,
    days,
    abMode,
    effectivePeriodId,
    effectiveWeek,
    gridStartMin,
    service.capacity,
    service.gaugeAccompagnants,
  ]);

  // Blocs affichés pour un jour : AUCUN sur un jour fermé (hors période active,
  // vacances scolaires ou férié) — sinon les créneaux/réservations de la période
  // couvrante débordent sur un jour appartenant à une autre période (semaine à
  // cheval), un jour de vacances, ou un férié.
  const dayBlocks = (d: string): Block[] => (isDayDisabled(d) ? [] : (blocksByDay[d] ?? []));

  // Validation bloquante (port legacy `_blockedDelete = validationMode && validated &&
  // validationBloquante`) : une résa VALIDÉE est verrouillée quand le service a
  // `validationBloquante` ET que le demandeur de l'usager est en mode validation.
  function bookingLocked(bk: { validated: boolean }): boolean {
    return service.validationBloquante && modes.validationMode && bk.validated;
  }

  // Impression « liste » (bouton N&B) : au lieu du modèle graphique, une LISTE imprimable
  // des réservations de l'usager pour la période concernée. Une ligne par occurrence datée :
  // ponctuels autonomes + occurrences (miroirs) des récurrentes, avec date, créneau, type,
  // thème, statut et pointage. Fenêtre dédiée (print déclenché par l'ouvreur, pas de script inline).
  function printMyBookings() {
    if (typeof window === "undefined") return;
    const period = mode === "model" ? (visiblePeriods[periodIdx] ?? null) : coveringPeriod;
    const inPeriod = (d: string) =>
      !period ||
      ((!period.dateStart || d >= period.dateStart) && (!period.dateEnd || d <= period.dateEnd));
    const uniqById = new Map(uniqueSlots.map((u) => [u.id, u]));
    const slotById = new Map(slots.map((s) => [s.id, s]));
    const timeOf = (st?: string, en?: string) => (st && en ? `${st} – ${en}` : "Journée entière");
    const dateLabel = (d: string) =>
      new Date(`${d}T00:00:00`).toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    const statutOf = (v: boolean) =>
      v ? "Réservation validée" : "Demande en attente de validation";
    const pointageOf = (p?: string | null) =>
      p === "present" ? "Présent" : p === "absent" ? "Absent" : "—";

    type Row = {
      date: string;
      creneau: string;
      type: string;
      theme: string;
      statut: string;
      pointage: string;
    };
    const rows: Row[] = [];
    for (const b of bookings) {
      if (!b.mine || b.synthetic) continue;
      if (uniqueIdSet.has(b.slotId)) {
        // Ponctuel autonome daté.
        const u = uniqById.get(b.slotId);
        if (!u?.slotDate || !inPeriod(u.slotDate)) continue;
        rows.push({
          date: u.slotDate,
          creneau: timeOf(u.startTime, u.endTime),
          type: "Ponctuelle",
          theme: b.theme || "—",
          statut: statutOf(b.validated),
          pointage: pointageOf(b.pointage),
        });
      } else if (b.parentBookingId == null && b.bookingType === "recurring") {
        // Récurrente → une ligne par occurrence (miroir) de la période, filtrée par la
        // semaine A/B de la résa et les vacances scolaires (si le demandeur ferme alors).
        if (period && b.periodId !== period.id) continue;
        const slot = slotById.get(b.slotId);
        const childByDate = new Map<string, Booking>();
        for (const c of bookings) {
          if (c.parentBookingId !== b.id) continue;
          const d = uniqById.get(c.slotId)?.slotDate;
          if (d) childByDate.set(d, c);
        }
        const occ = uniqueSlots
          .filter((u) => u.parentSlotId === b.slotId && u.slotDate)
          .map((u) => u.slotDate as string)
          .filter((d) => inPeriod(d))
          .filter((d) => (b.week === "A" || b.week === "B" ? slotWeekTag(d) === b.week : true))
          .filter((d) => openingForYmd(d).openOnSchoolHolidays || !isSchoolVacance(d))
          .sort();
        for (const d of occ) {
          const child = childByDate.get(d);
          rows.push({
            date: d,
            creneau: timeOf(slot?.startTime, slot?.endTime),
            type: "Récurrente",
            theme: (child?.theme ?? b.theme) || "—",
            statut: statutOf(child?.validated ?? b.validated),
            pointage: pointageOf(child?.pointage),
          });
        }
      }
    }
    rows.sort((a, z) => a.date.localeCompare(z.date) || a.creneau.localeCompare(z.creneau));

    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const titleStr = [service.label, period?.label].filter(Boolean).join(" — ") || "Réservations";
    const who = `${userInfo.prenom} ${userInfo.nom}`.trim();
    const head = ["Date", "Créneau", "Type", "Thème", "Statut", "Pointage"];
    const body = rows.length
      ? `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows
          .map(
            (r) =>
              `<tr><td>${esc(dateLabel(r.date))}</td><td>${esc(r.creneau)}</td><td>${esc(
                r.type,
              )}</td><td>${esc(r.theme)}</td><td>${esc(r.statut)}</td><td>${esc(
                r.pointage,
              )}</td></tr>`,
          )
          .join("")}</tbody></table>`
      : `<p class="empty">Aucune réservation pour cette période.</p>`;
    const css =
      "*{color:#000;background:#fff}body{font-family:system-ui,Arial,sans-serif;margin:24px;font-size:12px}h1{font-size:16px;margin:0 0 4px}.meta{color:#444;margin:0 0 16px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:4px 8px;text-align:left}th{background:#eee !important;font-size:11px;text-transform:uppercase;letter-spacing:.04em}.empty{color:#444}";
    printHtmlDocument(
      `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>${esc(titleStr)}</title><style>${css}</style></head><body><h1>${esc(titleStr)}</h1><div class="meta">${esc(who)} · ${rows.length} réservation${rows.length > 1 ? "s" : ""}</div>${body}</body></html>`,
    );
  }

  // Restaure la vue (exercice / période / semaine) depuis sessionStorage au montage,
  // pour revenir sur la sélection précédente quand on rouvre la page. À défaut, ancre
  // la semaine réelle sur le lundi courant. (Client uniquement → pas de mismatch SSR.)
  const persistSkip = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: restauration au montage uniquement
  useEffect(() => {
    let anchored = false;
    try {
      const raw = sessionStorage.getItem(`agenda-view:${service.id}`);
      if (raw) {
        const v = JSON.parse(raw) as Partial<{
          exerciceId: number | null;
          periodIdx: number;
          anchorMonday: string;
          weekAB: "A" | "B";
        }>;
        // Ne restaure l'exercice que s'il existe encore ; un `null` mémorisé (vue
        // enregistrée quand le service n'avait pas d'exercice) est ignoré, sinon il
        // désactiverait le filtre d'exercice (périodes de tous les exercices mélangées).
        if (v.exerciceId != null && exercices.some((e) => e.id === v.exerciceId)) {
          setCurrentExerciceId(v.exerciceId);
        }
        if (typeof v.periodIdx === "number" && v.periodIdx >= 0) setPeriodIdx(v.periodIdx);
        if (v.weekAB === "A" || v.weekAB === "B") setWeekAB(v.weekAB);
        if (typeof v.anchorMonday === "string") {
          setAnchorMonday(v.anchorMonday);
          anchored = true;
        }
      }
    } catch {}
    if (!anchored) setAnchorMonday(ymd(mondayOf(new Date())));
  }, []);

  // Persiste la vue à chaque changement. On saute le tout 1er run (montage, AVANT que
  // la restauration ci-dessus n'ait été appliquée) pour ne pas écraser la valeur
  // stockée avec les valeurs par défaut.
  useEffect(() => {
    if (persistSkip.current) {
      persistSkip.current = false;
      return;
    }
    try {
      sessionStorage.setItem(
        `agenda-view:${service.id}`,
        JSON.stringify({ exerciceId: currentExerciceId, periodIdx, anchorMonday, weekAB }),
      );
    } catch {}
  }, [service.id, currentExerciceId, periodIdx, anchorMonday, weekAB]);

  // Verrouille la période active en semaine réelle : dès qu'une période est
  // dérivée pour la semaine courante, on la fige dans rwPeriodId. La nav ◀/▶
  // s'appuie alors sur cette période figée (et non sur une re-dérivation qui
  // basculerait sur la voisine aux frontières). Re-verrouille si l'ancien verrou
  // ne couvre plus la semaine (ex. après « Aujourd'hui »). Cf. legacy l.6481-6490.
  useEffect(() => {
    if (mode !== "realweek") return;
    if (coveringPeriod && coveringPeriod.id !== rwPeriodId) setRwPeriodId(coveringPeriod.id);
    else if (!coveringPeriod && rwPeriodId !== null) setRwPeriodId(null);
  }, [mode, coveringPeriod, rwPeriodId]);

  // ── Brouillon (legacy pendingSelection / pendingCancellations) ──────────
  // ── « Un seul badge à la fois » ──────────────────────────────────────────────────
  // Le brouillon peut accumuler PLUSIEURS actions (créer/déplacer/modifier/supprimer)
  // mais toutes sur le MÊME élément (un seul badge). On dérive l'identité de cet élément :
  // `add:<clé>` pour une création en brouillon, `bk:<id>` pour une réservation existante
  // (déplacement / modification / suppression partagent le même bookingId). Toute action
  // ciblant un AUTRE élément est bloquée (toast). Les actions sur le MÊME élément passent.
  const pendingElementKey: string | null =
    pendingAdds.length > 0
      ? `add:${pendingAdds[0].key}`
      : pendingRemovals.length > 0
        ? `bk:${pendingRemovals[0].bookingId}`
        : Object.keys(pendingMoves).length > 0
          ? `bk:${Object.keys(pendingMoves)[0]}`
          : Object.keys(pendingUpdates).length > 0
            ? `bk:${Object.keys(pendingUpdates)[0]}`
            : null;
  // Autorise une action ciblant l'élément `targetKey` ? OUI si le brouillon est vide, ou si
  // l'action porte sur l'élément déjà en cours (même badge). Sinon NON + toast --danger.
  function guardSingleAction(targetKey: string): boolean {
    if (pendingElementKey == null || pendingElementKey === targetKey) return true;
    showToast(
      "Une seule réservation à la fois : enregistrez ou annulez les modifications en cours avant d'agir sur une autre.",
      "danger",
    );
    return false;
  }

  function pendKey(slotId: string, dayKey: string, ponctuel: boolean) {
    return ponctuel ? `u:${slotId}` : `r:${slotId}|${dayKey}`;
  }
  function slotTime(slotId: string, ponctuel: boolean) {
    const s = ponctuel ? uniqSlotById.get(slotId) : recurSlotById.get(slotId);
    return s ? `${s.startTime}–${s.endTime}` : "";
  }
  function ponctuelDateLabel(slotId: string) {
    const u = uniqSlotById.get(slotId);
    return u?.slotDate
      ? new Date(`${u.slotDate}T00:00:00`).toLocaleDateString("fr-FR", {
          weekday: "long",
          day: "numeric",
          month: "long",
        })
      : "";
  }

  // Coche / décoche un créneau libre pour réservation (sans appel serveur).
  function togglePendingAdd(slotId: string, dayKey: string, ponctuel: boolean) {
    const key = pendKey(slotId, dayKey, ponctuel);
    // Verrou « une seule action » : décocher l'ajout courant reste permis (même clé) ;
    // cocher un AUTRE créneau alors qu'une action est en attente est bloqué.
    if (!guardSingleAction(`add:${key}`)) return;
    setCommitError(null);
    setPendingAdds((prev) => {
      if (prev.some((a) => a.key === key)) return prev.filter((a) => a.key !== key);
      const time = slotTime(slotId, ponctuel);
      const label = ponctuel
        ? `${ponctuelDateLabel(slotId)} · ${time}`
        : `${DAY_NAMES[dayKey] ?? dayKey} · ${time}`;
      return [
        ...prev,
        {
          key,
          slotId,
          dayKey,
          periodId: ponctuel ? 0 : (effectivePeriodId ?? 0),
          week: !ponctuel && abMode ? (effectiveWeek ?? "") : "",
          ponctuel,
          label,
          theme: "",
          // Compteurs initiaux depuis le profil (min 1 en mode jauge, cf. legacy).
          enfants: Math.max(1, userInfo.enfants || 0),
          accompagnants: Math.max(1, userInfo.accompagnants || 0),
        },
      ];
    });
  }

  // Incrémente/décrémente un compteur d'un ajout en attente (mode jauge), borné à
  // [1, places restantes] (somme enfants+adultes ≤ capacité du créneau).
  function bumpAddCount(
    key: string,
    field: "enfants" | "accompagnants",
    delta: 1 | -1,
    remaining: number,
  ) {
    setPendingAdds((prev) =>
      prev.map((a) => {
        if (a.key !== key) return a;
        // Le champ compte-t-il dans la jauge ? (accompagnants : seulement si activé)
        const fieldCounts = field === "enfants" || service.gaugeAccompagnants;
        if (
          delta > 0 &&
          fieldCounts &&
          gaugeUnits(a.enfants, a.accompagnants, service.gaugeAccompagnants) >= remaining
        )
          return a;
        const next = Math.max(1, a[field] + delta);
        return { ...a, [field]: next };
      }),
    );
  }
  // Saisie directe (champ nombre du badge jauge) d'un ajout en attente : valeur ≥ 1,
  // somme enfants + adultes plafonnée à `remaining` (cf. setMyCount pour mes résas).
  function setAddCount(
    key: string,
    field: "enfants" | "accompagnants",
    value: number,
    remaining: number,
  ) {
    setCommitError(null);
    setPendingAdds((prev) =>
      prev.map((a) => {
        if (a.key !== key) return a;
        const fieldCounts = field === "enfants" || service.gaugeAccompagnants;
        // Unités jauge déjà prises par l'AUTRE champ (les accompagnants ne comptent
        // que si activé). Si le champ courant ne compte pas → pas de plafond jauge.
        const otherUnits =
          field === "enfants" ? (service.gaugeAccompagnants ? a.accompagnants : 0) : a.enfants;
        const cap = fieldCounts ? Math.max(1, remaining - otherUnits) : Number.MAX_SAFE_INTEGER;
        const next = Math.max(1, Math.min(value || 1, cap));
        return { ...a, [field]: next };
      }),
    );
  }

  // ── Glisser-déplacer (brouillons + réservations « en attente ») ──────────────
  // Libellé « Jour · HH–HH » d'un créneau cible (pour le récap des déplacements).
  function slotMoveLabel(slotId: string, dayKey: string, ponctuel: boolean) {
    const time = slotTime(slotId, ponctuel);
    return ponctuel
      ? `${ponctuelDateLabel(slotId)} · ${time}`
      : `${DAY_NAMES[dayKey] ?? dayKey} · ${time}`;
  }
  // Un bloc accepte-t-il le dépôt de `item` ? Cible LIBRE et de MÊME type
  // (récurrent↔récurrent, ponctuel↔ponctuel) — cf. décision produit.
  function canDropItem(item: DragItem, b: Block): boolean {
    return !b.full && !isSlotClosed(b) && item.ponctuel === uniqueIdSet.has(b.slotId);
  }
  // Variante liée à l'état courant (pour la surbrillance au rendu).
  function canDropOn(b: Block): boolean {
    return dragItem != null && canDropItem(dragItem, b);
  }
  // Créneau (Block) sous le point écran donné, via les data-slotid/data-daykey des cellules.
  // Sert au hit-test du drag « pointer events » (il n'y a plus d'événement onDrop natif).
  function blockAtPoint(x: number, y: number): Block | null {
    const cell = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-slotid]");
    const slotId = cell?.dataset.slotid;
    if (!slotId) return null;
    const dayKey = cell?.dataset.daykey ?? "";
    return blocksByDay[dayKey]?.find((bl) => bl.slotId === slotId) ?? null;
  }
  // Dépôt sur un créneau : relocalise le brouillon, ou enregistre/annule un déplacement.
  function dropOnBlock(item: DragItem, b: Block) {
    const ponctuel = uniqueIdSet.has(b.slotId);
    if (item.ponctuel !== ponctuel || b.full) return; // sécurité (déjà filtré au dragover)
    const targetPeriodId = ponctuel ? 0 : (effectivePeriodId ?? 0);
    const targetWeek = !ponctuel && abMode ? (effectiveWeek ?? "") : "";
    setCommitError(null);

    if (item.kind === "draft") {
      setPendingAdds((prev) => {
        const cur = prev.find((a) => a.key === item.key);
        if (!cur || (cur.slotId === b.slotId && cur.dayKey === b.dayKey)) return prev;
        const newKey = pendKey(b.slotId, b.dayKey, ponctuel);
        // Retire l'entrée d'origine + un éventuel doublon déjà présent sur la cible.
        const rest = prev.filter((a) => a.key !== item.key && a.key !== newKey);
        return [
          ...rest,
          {
            ...cur,
            key: newKey,
            slotId: b.slotId,
            dayKey: b.dayKey,
            periodId: targetPeriodId,
            week: targetWeek,
            ponctuel,
            label: slotMoveLabel(b.slotId, b.dayKey, ponctuel),
          },
        ];
      });
      return;
    }

    // Déplacement d'une réservation existante.
    const bk = bookings.find((x) => x.id === item.bookingId);
    if (!bk) return;
    // Déposé sur sa position d'origine → annule le déplacement éventuel.
    const isOrigin = ponctuel
      ? bk.slotId === b.slotId
      : bk.slotId === b.slotId &&
        bk.dayKey === b.dayKey &&
        bk.periodId === targetPeriodId &&
        (bk.week || "") === (targetWeek || "");
    if (isOrigin) {
      // Retour à l'origine → annule le déplacement (brouillon vidé) : toujours permis.
      setPendingMoves((prev) => {
        if (!(item.bookingId in prev)) return prev;
        const next = { ...prev };
        delete next[item.bookingId];
        return next;
      });
      return;
    }
    // Démarre/re-cible un déplacement : soumis au verrou « une seule action ». Re-déposer
    // la résa déjà en déplacement reste permis (même clé) ; déplacer une résa alors qu'une
    // autre action est en attente est bloqué.
    if (!guardSingleAction(`bk:${item.bookingId}`)) return;
    setPendingMoves((prev) => ({
      ...prev,
      [item.bookingId]: {
        slotId: b.slotId,
        dayKey: b.dayKey,
        periodId: targetPeriodId,
        week: targetWeek,
        ponctuel,
        label: slotMoveLabel(b.slotId, b.dayKey, ponctuel),
      },
    }));
  }

  // Défilement « au bord » pendant le drag tactile (mobile, vue 1 jour) : maintenir le badge
  // sur le bord gauche/droit de la grille passe au jour précédent/suivant — on peut ainsi
  // déposer sur un autre jour sans relâcher. Le 1er pas est immédiat, puis répétition tant
  // que le pointeur reste sur le bord. Ref toujours frais vers mobileGoDay : sinon
  // l'intervalle capturerait une closure figée sur un mobileDayIdx/anchor périmé.
  const mobileGoDayRef = useRef(mobileGoDay);
  mobileGoDayRef.current = mobileGoDay;
  const edgePageRef = useRef<{ dir: -1 | 1; timer: ReturnType<typeof setInterval> } | null>(null);
  function stopEdgePaging() {
    if (edgePageRef.current) {
      clearInterval(edgePageRef.current.timer);
      edgePageRef.current = null;
    }
  }
  function handleEdgePaging(clientX: number) {
    if (!isMobile) return stopEdgePaging();
    const grid = document.querySelector(".agenda-grid");
    if (!grid) return stopEdgePaging();
    const r = grid.getBoundingClientRect();
    const zone = Math.max(32, r.width * 0.15);
    const dir: -1 | 1 | null = clientX <= r.left + zone ? -1 : clientX >= r.right - zone ? 1 : null;
    if (dir === null) return stopEdgePaging();
    if (edgePageRef.current?.dir === dir) return; // déjà en cours dans ce sens
    stopEdgePaging();
    mobileGoDayRef.current(dir); // 1er pas immédiat
    edgePageRef.current = { dir, timer: setInterval(() => mobileGoDayRef.current(dir), 650) };
  }
  // Sécurité : stoppe la répétition si le composant est démonté en plein drag. (Cleanup
  // autonome — n'utilise que le ref stable — pour ne pas dépendre de stopEdgePaging.)
  useEffect(
    () => () => {
      if (edgePageRef.current) clearInterval(edgePageRef.current.timer);
    },
    [],
  );

  // Drag « pointer events » (souris + tactile) : activation au-delà du seuil → on mémorise
  // l'item ; à chaque déplacement on suit le curseur (ghost), on surligne le créneau cible
  // et on gère le défilement au bord (mobile) ; au relâché on dépose sur le créneau sous le
  // pointeur (sinon annulation).
  const pointerDrag = usePointerDrag<DragItem>({
    onActivate: (item) => setDragItem(item),
    onMove: (item, e) => {
      setDragPos({ x: e.clientX, y: e.clientY });
      handleEdgePaging(e.clientX);
      const b = blockAtPoint(e.clientX, e.clientY);
      setDropKey(b && canDropItem(item, b) ? `${b.dayKey}|${b.slotId}` : null);
    },
    onDrop: (item, e) => {
      stopEdgePaging();
      const b = blockAtPoint(e.clientX, e.clientY);
      if (b && canDropItem(item, b)) dropOnBlock(item, b);
      setDragItem(null);
      setDropKey(null);
      setDragPos(null);
      dragGhostRef.current = null;
    },
    onCancel: () => {
      stopEdgePaging();
      setDragItem(null);
      setDropKey(null);
      setDragPos(null);
      dragGhostRef.current = null;
    },
  });

  // Amorce un drag : capture un clone HTML du badge source (pour le ghost) puis arme le
  // drag « pointer events ». `e.currentTarget` = poignée (desktop) ou badge (mobile) → on
  // remonte au badge via closest.
  function beginDrag(item: DragItem, e: React.PointerEvent) {
    const badge = (e.currentTarget as HTMLElement).closest<HTMLElement>(".user-agenda-mine-badge");
    // Largeur ET hauteur capturées : l'aperçu flottant (ghost) sert lui aussi de conteneur
    // de requête (cqmin) au clone du badge, pour préserver les proportions hors du flux.
    dragGhostRef.current = badge
      ? { html: badge.outerHTML, width: badge.offsetWidth, height: badge.offsetHeight }
      : null;
    pointerDrag.start(item, e);
  }

  // Compteurs/thème courants d'une de MES réservations (brouillon ou valeur d'origine).
  function myCounts(bk: Booking) {
    return (
      pendingUpdates[bk.id] ?? {
        enfants: bk.enfants,
        accompagnants: bk.accompagnants,
        theme: bk.theme,
      }
    );
  }
  function bumpMyCount(
    bk: Booking,
    field: "enfants" | "accompagnants",
    delta: 1 | -1,
    remaining: number,
  ) {
    // Verrou « une seule action » : modifier une résa déjà en cours de modif reste permis ;
    // modifier une AUTRE résa (ou modifier alors qu'une autre action est en attente) bloqué.
    if (!guardSingleAction(`bk:${bk.id}`)) return;
    setCommitError(null);
    const cur = myCounts(bk);
    const fieldCounts = field === "enfants" || service.gaugeAccompagnants;
    if (
      delta > 0 &&
      fieldCounts &&
      gaugeUnits(cur.enfants, cur.accompagnants, service.gaugeAccompagnants) >= remaining
    )
      return;
    setPendingUpdates((prev) => ({
      ...prev,
      [bk.id]: { ...cur, [field]: Math.max(1, cur[field] + delta) },
    }));
  }
  // Saisie directe (champ nombre du badge jauge) : valeur ≥ 1, et la somme
  // enfants + adultes plafonnée à `remaining` (legacy _updateMaxes).
  function setMyCount(
    bk: Booking,
    field: "enfants" | "accompagnants",
    value: number,
    remaining: number,
  ) {
    if (!guardSingleAction(`bk:${bk.id}`)) return;
    setCommitError(null);
    const cur = myCounts(bk);
    const fieldCounts = field === "enfants" || service.gaugeAccompagnants;
    const otherUnits =
      field === "enfants" ? (service.gaugeAccompagnants ? cur.accompagnants : 0) : cur.enfants;
    const cap = fieldCounts ? Math.max(1, remaining - otherUnits) : Number.MAX_SAFE_INTEGER;
    const next = Math.max(1, Math.min(value || 1, cap));
    setPendingUpdates((prev) => ({ ...prev, [bk.id]: { ...cur, [field]: next } }));
  }
  function setMyTheme(bk: Booking, v: string) {
    if (!guardSingleAction(`bk:${bk.id}`)) return;
    setCommitError(null);
    setPendingUpdates((prev) => ({ ...prev, [bk.id]: { ...myCounts(bk), theme: v } }));
  }

  // Marque / démarque une de MES réservations pour annulation (sans appel serveur).
  function togglePendingRemoval(bk: Booking) {
    // Résa verrouillée (validation bloquante) → annulation impossible.
    if (bookingLocked(bk)) return;
    // Démarquer la suppression courante → brouillon vidé de cette suppression (permis).
    if (pendingRemovals.some((r) => r.bookingId === bk.id)) {
      setCommitError(null);
      setPendingRemovals((prev) => prev.filter((r) => r.bookingId !== bk.id));
      return;
    }
    // Supprimer cette résa est permis si le brouillon est vide ou porte déjà sur CE même
    // badge (déplacement/modif du même bookingId) — plusieurs actions sur un même élément.
    // Supprimer une AUTRE résa alors qu'un badge est en cours est bloqué (toast). Au commit,
    // la suppression prime : le déplacement/modif de cette résa est ignoré (cf. commitPending).
    if (!guardSingleAction(`bk:${bk.id}`)) return;
    setCommitError(null);
    const time = slotTime(bk.slotId, uniqueIdSet.has(bk.slotId));
    const label = bk.dayKey ? `${DAY_NAMES[bk.dayKey] ?? bk.dayKey} · ${time}` : time;
    setPendingRemovals((prev) => [...prev, { bookingId: bk.id, label }]);
  }

  function clearPending() {
    setPendingAdds([]);
    setPendingRemovals([]);
    setPendingUpdates({});
    setPendingMoves({});
    setCommitError(null);
  }

  const pendingCount =
    pendingAdds.length +
    pendingRemovals.length +
    Object.keys(pendingUpdates).length +
    Object.keys(pendingMoves).length;
  // La suppression PRIME (au commit comme à l'affichage) : dès qu'une suppression est en
  // attente, le bouton d'enregistrement devient « Supprimer → » en rouge danger — même si
  // un déplacement/modif du même élément coexiste (il sera ignoré au commit).
  const isDeletion = pendingRemovals.length > 0;

  // Rafraîchissement automatique de la disponibilité : intervalle configurable
  // (Administration > Configuration ; 0 = désactivé) + au retour sur l'onglet
  // (visibilitychange). SUSPENDU tant qu'un brouillon est en cours (ajouts/retraits/
  // maj/déplacements) ou pendant l'enregistrement, pour ne jamais écraser les
  // sélections de l'usager. En pause quand l'onglet est masqué.
  const canAutoRefreshRef = useRef(pendingCount === 0 && !committing);
  useEffect(() => {
    canAutoRefreshRef.current = pendingCount === 0 && !committing;
  }, [pendingCount, committing]);
  useEffect(() => {
    if (!autoRefreshSeconds || autoRefreshSeconds <= 0) return;
    const refreshIfIdle = () => {
      if (document.visibilityState === "visible" && canAutoRefreshRef.current) {
        startTransition(() => router.refresh());
      }
    };
    const id = window.setInterval(refreshIfIdle, autoRefreshSeconds * 1000);
    document.addEventListener("visibilitychange", refreshIfIdle);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", refreshIfIdle);
    };
  }, [router, autoRefreshSeconds]);

  // « Enregistrer → » : valide le brouillon (crée les ajouts, annule les retraits).
  // Chaque opération RÉUSSIE est retirée du brouillon au fil de l'eau : en cas
  // d'échec au milieu du lot, le panier restant ne contient que ce qui n'a PAS été
  // appliqué — re-cliquer « Enregistrer » ne rejoue plus les annulations déjà
  // faites (« Réservation introuvable ») et le brouillon reste récupérable.
  function commitPending() {
    // Type de l'action en cours (le brouillon ne contient qu'UN élément, cf. verrou) →
    // détermine le toast de résultat : rouge pour une suppression, vert sinon.
    const summary =
      pendingRemovals.length > 0
        ? { text: "Réservation supprimée.", variant: "danger" as const }
        : pendingAdds.length > 0
          ? { text: "Réservation enregistrée.", variant: "success" as const }
          : Object.keys(pendingMoves).length > 0
            ? { text: "Réservation déplacée.", variant: "success" as const }
            : { text: "Réservation modifiée.", variant: "success" as const };
    setCommitting(true);
    setCommitError(null);
    startTransition(async () => {
      // Tout le brouillon part en UNE action atomique (commitDraft) : suppressions →
      // modifications → déplacements → ajouts dans une seule transaction serveur.
      // Si une résa est À LA FOIS supprimée et déplacée/modifiée (deux actions acceptées sur
      // le même élément), la SUPPRESSION prime : on ignore son déplacement/modif (sinon le
      // serveur tenterait de déplacer une résa déjà supprimée → « introuvable »).
      const removalIds = new Set(pendingRemovals.map((r) => r.bookingId));
      const draft = {
        removals: pendingRemovals.map((r) => r.bookingId),
        updates: Object.entries(pendingUpdates)
          .filter(([id]) => !removalIds.has(Number(id)))
          .map(([id, u]) => ({
            bookingId: Number(id),
            enfants: u.enfants,
            accompagnants: u.accompagnants,
            theme: u.theme,
          })),
        moves: Object.entries(pendingMoves)
          .filter(([id]) => !removalIds.has(Number(id)))
          .map(([id, m]) => ({
            bookingId: Number(id),
            slotId: m.slotId,
            ponctuel: m.ponctuel,
            periodId: m.periodId,
            week: m.week,
          })),
        adds: pendingAdds.map((a) => ({
          ponctuel: a.ponctuel,
          slotId: a.slotId,
          periodId: a.periodId,
          week: a.week,
          theme: a.theme,
          enfants: a.enfants,
          accompagnants: a.accompagnants,
        })),
      };
      const res = await commitDraft(service.id, draft);
      setCommitting(false);
      if (res.ok) {
        clearPending();
        showToast(summary.text, summary.variant);
        router.refresh();
      } else {
        // Atomique : rien n'a été appliqué → on garde le panier intact pour correction.
        // Plus de modale pour l'afficher → on signale l'échec par un toast rouge.
        setCommitError(res.error ?? "Échec de l'enregistrement.");
        showToast(res.error ?? "Échec de l'enregistrement.", "danger");
        router.refresh();
      }
    });
  }

  // Rendu d'UN bloc-créneau (timed ou journée entière), réutilisé par la grille
  // horaire et par la bande « Journée entière » (port du legacy
  // _renderAgendaAdminBlock(b, isAlldayBlock)). En all-day : pas de positionnement
  // absolu (le CSS .agenda-block.is-allday gère position/​taille dans la cellule).
  // Une date (YYYY-MM-DD) tombe-t-elle en vacances scolaires ? Convention data.gouv.fr :
  // dateStart = soir du dernier jour d'école → 1er jour de vacances = dateStart + 1
  // (borne stricte à gauche, inclusive à droite). Port legacy _isSchoolVacance.
  const isSchoolVacance = (date: string): boolean =>
    inSchoolHolidayRange(date, schoolHolidays ?? []);

  // Dates concrètes couvertes par un créneau récurrent un jour donné : ses miroirs
  // (créneaux uniques datés générés pour la période, hors jours fériés exclus à la
  // génération), restreints à la semaine A/B active puis filtrés des vacances
  // scolaires si le demandeur ferme alors. Trié. Port _predictedDatesForCurrentUser.
  // Date la plus proche réservable (aujourd'hui + délai du service) : côté USAGER, les
  // occurrences antérieures ne seront pas créées → on ne les affiche pas.
  // Première date réservable PAR DATE VISÉE : jours ouvrés de l'exercice couvrant
  // la date (décision produit), mémoïsé par jeu de jours actifs (peu de variantes).
  const earliestFor = useMemo(() => {
    const cache = new Map<string, string>();
    return (d: string): string => {
      const o = openingForYmd(d);
      let v = cache.get(o.activeDays);
      if (!v) {
        v = earliestBookableISO(
          service.bookingDelay,
          o.activeDays
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        );
        cache.set(o.activeDays, v);
      }
      return v;
    };
  }, [openingForYmd, service.bookingDelay]);
  // Dates concernées indexées par (slot parent | jour), précalculées une fois par jeu de
  // miroirs/réglages — au lieu d'un balayage O(uniqueSlots) à CHAQUE appel par bloc, lui-même
  // déclenché à chaque survol/pas de drag (onAgendaTip/canDropItem) : O(blocs×uniqueSlots).
  const concernedDatesByKey = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const u of uniqueSlots) {
      if (!u.parentSlotId || !u.slotDate) continue;
      const d = u.slotDate;
      // Délai de réservation : occurrences ≥ aujourd'hui + délai seulement (jours
      // ouvrés de l'exercice couvrant la date).
      if (d < earliestFor(d)) continue;
      // Convention UNIQUE de l'app : semaine ISO IMPAIRE = A, paire = B (lib/iso-week).
      if (abMode && effectiveWeek != null && slotWeekTag(d) !== effectiveWeek) continue;
      // Vacances scolaires exclues si l'exercice (∧ demandeur) ferme alors.
      if (!openingForYmd(d).openOnSchoolHolidays && inSchoolHolidayRange(d, schoolHolidays ?? []))
        continue;
      const key = `${u.parentSlotId}|${dayKeyFromYmd(d)}`;
      const arr = m.get(key);
      if (arr) arr.push(d);
      else m.set(key, [d]);
    }
    for (const arr of m.values()) arr.sort();
    return m;
  }, [uniqueSlots, earliestFor, abMode, effectiveWeek, openingForYmd, schoolHolidays]);

  // Dates concrètes couvertes par un créneau récurrent un jour donné (cf. memo ci-dessus).
  // Port _predictedDatesForCurrentUser.
  const concernedDatesForBlock = (slotId: string, dayKey: string): string[] =>
    concernedDatesByKey.get(`${slotId}|${dayKey}`) ?? [];

  // Créneau « clôturé » par le délai de réservation → non réservable, création bloquée.
  //   • Ponctuel  → sa date est antérieure à la 1re date réservable (aujourd'hui + délai).
  //   • Récurrent → AUCUN miroir réservable (concernedDatesForBlock applique délai + A/B
  //     + vacances) ; réserver le récurrent ne matérialiserait aucune occurrence.
  const isSlotClosed = (b: Block): boolean => {
    if (uniqueIdSet.has(b.slotId)) {
      const u = uniqSlotById.get(b.slotId);
      return !!u?.slotDate && u.slotDate < earliestFor(u.slotDate);
    }
    return concernedDatesForBlock(b.slotId, b.dayKey).length === 0;
  };

  // Disponibilité (colonne « Dispo » du panneau Périodes) : date d'ouverture des
  // réservations USAGER de la période du créneau. Renvoie la date si elle est encore
  // future (bloc non réservable, libellé « Réservable à partir du … »), sinon null. La période du
  // bloc = celle du créneau (récurrent : la sienne ; ponctuel/miroir : celle du
  // créneau daté). Le serveur applique la même règle (assertPeriodOpenForUser).
  const dispoByPeriod = new Map(periods.map((p) => [p.id, p.disponibilite]));
  const todayIso = ymd(new Date());
  const slotOpensOn = (b: Block): string | null => {
    const pid = uniqueIdSet.has(b.slotId)
      ? uniqSlotById.get(b.slotId)?.periodId
      : recurSlotById.get(b.slotId)?.periodId;
    if (pid == null) return null;
    const d = dispoByPeriod.get(pid);
    return d && todayIso < d ? d : null;
  };

  // Saisie de thème en cours (textarea/input focalisé dans un badge, ou picker liste
  // ouvert) → on n'affiche pas l'info-bulle pour ne pas gêner (port _isThemeBeingEdited).
  const isThemeBeingEdited = (): boolean => {
    if (typeof document === "undefined") return false;
    if (document.querySelector(".user-theme-picker-menu")) return true;
    const ae = document.activeElement as HTMLElement | null;
    return !!(
      ae &&
      (ae.tagName === "TEXTAREA" || ae.tagName === "INPUT") &&
      ae.closest(".user-agenda-mine-badge")
    );
  };

  // Handlers d'événements de renderBlock via un ref STABLE : réassignés à chaque rendu
  // (toujours frais) mais HORS des déps du useCallback → permet la mémo des blocs par jour
  // (perf, port du pattern de l'agenda admin). N'y mettre QUE des handlers exécutés sur
  // interaction (clic/drag/saisie), jamais des lectures faites pendant le rendu.
  const blockApi = {
    togglePendingAdd,
    togglePendingRemoval,
    bumpMyCount,
    setMyCount,
    setMyTheme,
    bumpAddCount,
    setAddCount,
    setPendingAdds,
    beginDrag,
  };
  const blockApiRef = useRef(blockApi);
  blockApiRef.current = blockApi;

  // biome-ignore lint/correctness/useExhaustiveDependencies: déps maintenues à la main — les handlers d'événements passent par blockApiRef (hors déps), et les helpers appelés AU RENDU (isSlotClosed/canDropOn/myCounts/slotTime/bookingLocked, recréés à chaque rendu) ont leurs entrées RÉELLES listées en primitives (uniqSlotById, recurSlotById, earliestBookable, concernedDatesByKey, pendingUpdates, service, modes…) → renderBlock se recrée quand elles changent, capturant des helpers frais. pendKey/participantsLabel sont purs.
  const renderBlock = useCallback(
    (b: Block, allday: boolean) => {
      const {
        togglePendingAdd,
        togglePendingRemoval,
        bumpMyCount,
        setMyCount,
        setMyTheme,
        bumpAddCount,
        setAddCount,
        setPendingAdds,
        beginDrag,
      } = blockApiRef.current;
      // Info-bulle « Journées concernées » : créneaux RÉCURRENTS, en Modèle de période
      // COMME en Semaine réelle (même comportement que l'agenda admin) — elle liste les
      // occurrences à venir du créneau, utile dans les deux vues.
      const isRecurringBlock = !uniqueIdSet.has(b.slotId);
      const posStyle: React.CSSProperties = allday
        ? {}
        : (() => {
            // top/height dérivés des minutes via mapMinToY (compactage pause).
            // Bornage à la plage visible + 2px de gap haut/bas (cf. legacy).
            const ys = mapMinToY(Math.max(b.startMin, gridStartMin));
            const ye = mapMinToY(Math.min(b.endMin, gridEndMin));
            return {
              top: ys + 2,
              height: Math.max(14, ye - ys - 4),
              left: `calc(${b.leftPct}% + 2px)`,
              width: `calc(${b.widthPct}% - 4px)`,
            };
          })();
      // Clôturé par le délai → bloc non réservable (grisé, clic ignoré, libellé « Clôturé »).
      const closed = isSlotClosed(b);
      // Période pas encore ouverte (Dispo) → bloc non réservable, « Réservable à partir du … ».
      const opensOn = slotOpensOn(b);
      return (
        // biome-ignore lint/a11y/useKeyWithClickEvents: bloc-créneau agenda (clic = créer)
        <div
          key={`${b.dayKey}|${b.slotId}`}
          // data-* pour l'info-bulle déléguée « Journées concernées » (créneau récurrent).
          data-slot-tip={isRecurringBlock ? "" : undefined}
          data-slotid={b.slotId}
          data-daykey={b.dayKey}
          // 2 couleurs fixes, sans variation selon le remplissage/jauge : vert pour
          // les ponctuels autonomes, jaune (défaut .agenda-block) pour les récurrents
          // et leurs miroirs (cf. légende Récurrent/Ponctuel).
          className={`agenda-block${allday ? " is-allday" : ""}${
            dropKey === `${b.dayKey}|${b.slotId}` && canDropOn(b) ? " slot-user-drop-target" : ""
          }`}
          style={{
            ...posStyle,
            // Centrage vertical des badges dans le créneau (inline = priorité
            // sur les feuilles concurrentes GRID_CSS / app-legacy.css).
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            // Ponctuel autonome (non miroir) → couleur distinctive pilotée par
            // --slot-uniq-color (cf. .agenda-block.is-uniq) : fond = color-mix 25 %,
            // bordure = couleur pleine.
            ...(uniqueIdSet.has(b.slotId)
              ? {
                  background: "color-mix(in srgb, var(--slot-uniq-color) 25%, transparent)",
                  borderColor: "var(--slot-uniq-color)",
                }
              : {}),
            // Créneau clôturé (délai) ou période pas encore ouverte (Dispo) :
            // grisé + curseur « interdit ».
            ...(closed || opensOn ? { opacity: 0.6, cursor: "not-allowed" } : {}),
          }}
          onClick={(e) => {
            // Clic sur un créneau → coche/décoche pour réservation (brouillon).
            // (Si c'est ma résa, le badge interne gère l'annulation et stoppe la propagation.)
            e.stopPropagation();
            if (b.full || closed || opensOn) return;
            const ponctuel = uniqueIdSet.has(b.slotId);
            if (!ponctuel && (effectivePeriodId == null || effectivePeriodId <= 0)) return;
            togglePendingAdd(b.slotId, b.dayKey, ponctuel);
          }}
        >
          {/* Badges centrés via le parent .agenda-block (justify-content:center).
          Le chips ne grandit pas pour que le centrage opère ; la jauge est
          sortie du flux (position absolue en bas). */}
          <div
            className="agenda-block-chips"
            // Conteneur de requête (cqmin) pour le badge « ma réservation » : il remplit le
            // bloc-créneau (flex:1) MAIS plafonné à 50px de haut → un créneau d'1h ou plus
            // (bloc ≳ 52px) donne un badge de 50px centré (le surplus de hauteur est réparti
            // par justify-content:center) ; un créneau plus court (< 1h) garde la hauteur du
            // créneau. La taille du badge = celle de la cellule (≤ 50px), et ses éléments
            // (exprimés en `bu` = cqmin) s'y dimensionnent proportionnellement. Un enfant
            // court (« Complet », créneau libre) reste centré (justify-content), le badge le
            // remplit (height:100%). `containerType` n'est posé QUE côté usager (style inline),
            // pas sur la classe partagée (agenda admin inchangé).
            style={{
              flex: "1 1 auto",
              minHeight: 0,
              maxHeight: 50,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              gap: 2,
              containerType: "size",
            }}
          >
            {(() => {
              // Agenda usager : MA réservation → badge ✅/⏳ (clic = annuler) ;
              // sinon complet → « Complet » ; sinon créneau libre → repère « + »
              // (clic sur le bloc = réserver). On n'affiche jamais les autres réservants.
              const isPonctuelCell = uniqueIdSet.has(b.slotId);
              // Jauge DU créneau (slots.jauge) : compteurs enfants/adultes éditables
              // sur le badge si vrai, libellé d'état sinon.
              const gaugeOn = b.jauge;
              // Badge sans thème NI jauge : on affiche toujours l'état (Validé / En attente).
              const noWidgets = !modes.themeMode && !gaugeOn;
              // Créneau court (≤ 30 min) : badge ras → on sort l'icône d'état du flux pour
              // dégager la place du thème (cf. MineBadge). Durée en minutes, pas un proxy
              // pixel ; les créneaux « journée entière » non concernés.
              const shortSlot = !b.isAllDay && b.endMin - b.startMin <= 30;
              // Créneau très court (≤ 15 min) : décale les compteurs de la jauge vers le bas.
              const veryShortSlot = !b.isAllDay && b.endMin - b.startMin <= 15;
              const myBk = b.bookings.find((x) => x.mine);
              // Brouillon : ma résa marquée pour annulation, ou créneau libre coché.
              const markedRemoval = myBk
                ? pendingRemovals.some((r) => r.bookingId === myBk.id)
                : false;
              const pendingSel =
                !myBk &&
                pendingAdds.some((a) => a.key === pendKey(b.slotId, b.dayKey, isPonctuelCell));
              if (myBk?.synthetic) {
                // Occurrence d'une récurrente que je détiens, non matérialisée pour cette
                // date : badge « ma réservation » EN LECTURE SEULE (pas de ×, d'édition ni
                // de glisser-déposer ; l'annulation passe par une occurrence matérialisée).
                const mb = myBk;
                const tipTime = b.isAllDay ? "Journée entière" : slotTime(b.slotId, isPonctuelCell);
                return (
                  <MineBadge
                    validated={mb.validated}
                    markedRemoval={false}
                    gaugeOn={false}
                    themeMode={false}
                    themesMode={service.themesMode}
                    themes={themes}
                    enfants={mb.enfants}
                    accompagnants={mb.accompagnants}
                    theme={mb.theme}
                    remaining={0}
                    stateLabel={
                      mb.validated ? "Réservation validée" : "Demande en attente de validation"
                    }
                    title={`${tipTime}\n${
                      mb.validated
                        ? "✅ Réservation validée"
                        : "⏳ Demande en attente de validation"
                    }\n${participantsLabel(mb.enfants, mb.accompagnants)}`}
                    closeIcon="×"
                    locked
                    onClose={() => {}}
                    onBump={() => {}}
                    onSetCount={() => {}}
                    onSetTheme={() => {}}
                    draggable={false}
                  />
                );
              }
              if (myBk) {
                const mb = myBk;
                const cur = myCounts(mb);
                // Déplacement en attente (pendingMove sur CETTE résa) → badge atténué + libellé.
                const isMoving = pendingMoves[mb.id] != null;
                // Sans thème ni jauge → on affiche l'état (Validé / En attente). Avec un
                // thème OU une jauge, l'état est porté par l'icône ✔/⏳ → pas de libellé
                // (sauf « Suppression en cours… » / « Déplacement en cours… » pour une action en attente).
                // La suppression PRIME sur le déplacement (deux actions possibles sur le même
                // élément ; au commit la suppression l'emporte).
                const stateLabel = markedRemoval
                  ? "Suppression en cours…"
                  : isMoving
                    ? "Déplacement en cours…"
                    : noWidgets
                      ? mb.validated
                        ? "Réservation validée"
                        : "Demande en attente de validation"
                      : "";
                // Place dispo pour CE booking = libre + sa propre occupation déjà comptée
                // (enfants + adultes en jauge ; 1 réservation hors jauge).
                const remaining = Math.max(
                  0,
                  b.capacity -
                    b.used +
                    (gaugeOn
                      ? gaugeUnits(cur.enfants, cur.accompagnants, service.gaugeAccompagnants)
                      : 1),
                );
                // Infobulle (legacy) : horaire + état + participants + semaine.
                const tipTime = b.isAllDay ? "Journée entière" : slotTime(b.slotId, isPonctuelCell);
                const tipState = markedRemoval
                  ? "🗑️ Suppression en cours"
                  : isMoving
                    ? "↔️ Déplacement en cours"
                    : mb.validated
                      ? "✅ Réservation validée"
                      : "⏳ Demande en attente de validation";
                const tipWeek =
                  abMode && (mb.week === "A" || mb.week === "B") ? `\nSemaine ${mb.week}` : "";
                return (
                  <MineBadge
                    validated={mb.validated}
                    markedRemoval={markedRemoval}
                    moving={isMoving}
                    gaugeOn={gaugeOn}
                    themeMode={modes.themeMode}
                    themesMode={service.themesMode}
                    themes={themes}
                    enfants={cur.enfants}
                    accompagnants={cur.accompagnants}
                    theme={cur.theme}
                    remaining={remaining}
                    stateLabel={stateLabel}
                    title={`${tipTime}\n${tipState}\n${participantsLabel(
                      cur.enfants,
                      cur.accompagnants,
                    )}${tipWeek}`}
                    closeIcon="×"
                    locked={bookingLocked(mb)}
                    onClose={() => togglePendingRemoval(mb)}
                    onBump={(f, d) => bumpMyCount(mb, f, d, remaining)}
                    onSetCount={(f, v) => setMyCount(mb, f, v, remaining)}
                    onSetTheme={(v) => setMyTheme(mb, v)}
                    // Déplaçable par glisser-déposer sauf si VERROUILLÉE (validation
                    // bloquante active) ou déjà marquée pour suppression. Aligné sur le
                    // serveur (moveInTx → assertBookingUnlocked) : une résa validée mais
                    // NON verrouillée reste déplaçable, comme elle reste annulable (croix ×).
                    // (Auparavant gaté sur `!mb.validated`, plus restrictif que le serveur.)
                    draggable={!bookingLocked(mb) && !markedRemoval}
                    dragFullSurface={isMobile}
                    // Jauge/thème agrandis aussi sur desktop (« pareil qu'en mobile »).
                    mobile
                    shortSlot={shortSlot}
                    veryShortSlot={veryShortSlot}
                    dragging={dragItem?.kind === "booking" && dragItem.bookingId === mb.id}
                    onDragPointerDown={(e) =>
                      beginDrag({ kind: "booking", bookingId: mb.id, ponctuel: isPonctuelCell }, e)
                    }
                  />
                );
              }
              if (pendingSel) {
                // Sélection en brouillon : LE MÊME badge que « ma réservation », alimenté
                // par l'entrée pendingAdds. Jamais validé → orange « En attente » ; le ×
                // (et le clic hors jauge) retire le brouillon de la sélection.
                const add = pendingAdds.find(
                  (a) => a.key === pendKey(b.slotId, b.dayKey, isPonctuelCell),
                );
                if (!add) return null;
                const remaining = Math.max(0, b.capacity - b.used);
                const removeDraft = () =>
                  setPendingAdds((prev) => prev.filter((a) => a.key !== add.key));
                // Infobulle (legacy) : horaire + état brouillon + participants + semaine.
                const tipTime = b.isAllDay ? "Journée entière" : slotTime(b.slotId, isPonctuelCell);
                const tipWeek =
                  abMode && (add.week === "A" || add.week === "B") ? `\nSemaine ${add.week}` : "";
                return (
                  <MineBadge
                    validated={false}
                    markedRemoval={false}
                    gaugeOn={gaugeOn}
                    themeMode={modes.themeMode}
                    themesMode={service.themesMode}
                    themes={themes}
                    enfants={add.enfants}
                    accompagnants={add.accompagnants}
                    theme={add.theme}
                    remaining={remaining}
                    stateLabel={noWidgets ? "Demande en attente de validation" : ""}
                    title={`${tipTime}\n📝 Brouillon — à enregistrer\n${participantsLabel(
                      add.enfants,
                      add.accompagnants,
                    )}${tipWeek}`}
                    closeIcon="×"
                    onClose={removeDraft}
                    onBump={(f, d) => bumpAddCount(add.key, f, d, remaining)}
                    onSetCount={(f, v) => setAddCount(add.key, f, v, remaining)}
                    onSetTheme={(v) =>
                      setPendingAdds((prev) =>
                        prev.map((x) => (x.key === add.key ? { ...x, theme: v } : x)),
                      )
                    }
                    // Brouillon : toujours déplaçable (relocalise simplement l'ajout).
                    draggable
                    dragFullSurface={isMobile}
                    // Jauge/thème agrandis aussi sur desktop (« pareil qu'en mobile »).
                    mobile
                    shortSlot={shortSlot}
                    veryShortSlot={veryShortSlot}
                    dragging={dragItem?.kind === "draft" && dragItem.key === add.key}
                    onDragPointerDown={(e) =>
                      beginDrag({ kind: "draft", key: add.key, ponctuel: isPonctuelCell }, e)
                    }
                  />
                );
              }
              if (opensOn) {
                // Période pas encore ouverte aux réservations (colonne « Dispo » admin).
                return (
                  <div
                    style={{
                      textAlign: "center",
                      color: "var(--muted)",
                      fontWeight: 600,
                      fontSize: ".62rem",
                    }}
                  >
                    Réservable à partir du{" "}
                    {new Date(`${opensOn}T00:00`).toLocaleDateString("fr-FR")}
                  </div>
                );
              }
              if (closed) {
                // Délai de réservation dépassé (ponctuel) ou aucun miroir réservable (récurrent).
                return (
                  <div
                    style={{
                      textAlign: "center",
                      color: "var(--muted)",
                      fontWeight: 600,
                      fontSize: ".62rem",
                    }}
                  >
                    Clôturé
                  </div>
                );
              }
              if (b.full) {
                return (
                  <div
                    style={{
                      textAlign: "center",
                      color: "var(--danger)",
                      fontWeight: 600,
                      fontSize: ".62rem",
                    }}
                  >
                    Complet
                  </div>
                );
              }
              // Créneau libre (pas de réservation de l'usager) : style legacy
              // (.user-agenda-block-inner) = icône agenda + places disponibles (.slot-spots).
              // Taille de l'icône selon la durée : masquée ≤ 30 min, 20px à 45 min, 24px au-delà.
              const remaining = Math.max(0, b.capacity - b.used);
              const slotIconPx = !b.isAllDay && b.endMin - b.startMin <= 45 ? 20 : 24;
              return (
                <div
                  aria-hidden="true"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 2,
                    height: "100%",
                    textAlign: "center",
                    color: "var(--muted)",
                  }}
                >
                  {/* Créneaux ≤ 30 min : pas d'icône (place insuffisante), seulement les places. */}
                  {!shortSlot && (
                    <span
                      className="slot-icon"
                      style={{
                        fontSize: slotIconPx,
                        lineHeight: 1,
                        width: slotIconPx,
                        height: slotIconPx,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      📆
                    </span>
                  )}
                  <span
                    className="slot-spots"
                    style={{
                      fontSize: ".62rem",
                      letterSpacing: ".04em",
                      lineHeight: 1.3,
                      background: "none",
                    }}
                  >
                    {remaining} place{remaining > 1 ? "s" : ""}
                  </span>
                </div>
              );
            })()}
          </div>
        </div>
      );
      // Déps = lectures réactives de renderBlock UNIQUEMENT (handlers via blockApiRef,
      // donc exclus). Énumérées à la main + vérifiées : une omission ⇒ badge figé.
    },
    [
      mode,
      uniqueIdSet,
      uniqSlotById,
      recurSlotById,
      earliestFor,
      concernedDatesByKey,
      mapMinToY,
      gridStartMin,
      gridEndMin,
      dropKey,
      effectivePeriodId,
      modes,
      pendingRemovals,
      pendingAdds,
      pendingMoves,
      pendingUpdates,
      service,
      themes,
      abMode,
      dragItem,
      isMobile,
      // Disponibilité des périodes (slotOpensOn) : réagit aux changements de « Dispo ».
      periods,
    ],
  );

  // Éléments JSX des blocs par jour, mémoïsés : renderBlock/isDayDisabled/blocksByDay
  // étant stables, ces éléments gardent la MÊME référence d'un rendu à l'autre tant que
  // données et mode ne changent pas → React bypasse la reconciliation des blocs pendant
  // un survol / glisser-déposer / saisie (perf, port de l'agenda admin).
  const dayBlockEls = useMemo(() => {
    const timed = new Map<string, React.ReactNode[]>();
    const allday = new Map<string, React.ReactNode[]>();
    for (const d of displayDays) {
      const bl: Block[] = isDayDisabled(d) ? [] : (blocksByDay[d] ?? []);
      timed.set(
        d,
        bl.filter((b) => !b.isAllDay).map((b) => renderBlock(b, false)),
      );
      allday.set(
        d,
        bl.filter((b) => b.isAllDay).map((b) => renderBlock(b, true)),
      );
    }
    return { timed, allday };
  }, [displayDays, isDayDisabled, blocksByDay, renderBlock]);

  return (
    // Info-bulle déléguée : un seul handler lit data-tip / data-slot-tip au survol.
    <div id="tab-content-agenda" onMouseMove={onAgendaTip} onMouseLeave={clearTip}>
      {/* Info-bulle flottante unique (texte data-tip / « Journées concernées »). */}
      <AgendaTooltip tip={tip} tipRef={tipRef} />

      {/* Toast (vert succès / rouge suppression ou erreur ou verrou), centré sur
          .app-main, bas de page. La classe .toast positionne en bas + translateX(-50%) ;
          on ne surcharge que `left`. */}
      {toast &&
        createPortal(
          <output
            className={`toast toast--${toast.variant}${toastVisible ? " show" : ""}`}
            style={{
              zIndex: 11000,
              ...(toastCenterX != null ? { left: `${toastCenterX}px` } : {}),
            }}
          >
            {toast.content}
          </output>,
          document.body,
        )}

      {/* Aperçu flottant du drag (ghost) = clone du badge source qui suit le pointeur
          (ancien rendu « badge entier »). pointer-events:none → n'interfère pas avec le
          hit-test (document.elementFromPoint) du créneau cible. */}
      {dragItem &&
        dragPos &&
        dragGhostRef.current &&
        createPortal(
          <div
            className="user-drag-ghost"
            style={{
              position: "fixed",
              left: dragPos.x,
              top: dragPos.y,
              transform: "translate(-50%, -50%)",
              width: dragGhostRef.current.width,
              height: dragGhostRef.current.height,
              // Conteneur de requête (cqmin) du clone : le badge cloné (height:100%) le
              // remplit, ses éléments retrouvent les mêmes proportions que le badge source.
              containerType: "size",
              zIndex: 11000,
              opacity: 0.9,
            }}
            // Clone HTML du badge (contenu déjà échappé par React au rendu d'origine).
            // biome-ignore lint/security/noDangerouslySetInnerHtml: snapshot interne du badge, pas une entrée externe
            dangerouslySetInnerHTML={{ __html: dragGhostRef.current.html }}
          />,
          document.body,
        )}
      <div
        style={{
          // position:relative → la nav semaine peut être centrée en absolu sur toute
          // la largeur (= largeur du tableau), indépendamment des éléments latéraux.
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: isMobile ? 0 : ".75rem",
          // Mobile : titre + nav semaine restent sur la MÊME ligne (pas de retour à la
          // ligne) ; desktop : wrap autorisé.
          flexWrap: isMobile ? "nowrap" : "wrap",
          // Sur mobile, pas de marge autour de la ligne de titre (ni dessus ni dessous).
          margin: isMobile ? "0" : "2rem 0 .75rem",
        }}
      >
        <div className="panel-title res-title" style={{ marginBottom: 0 }}>
          <span className="dot" />
          Réservations
          {/* Exercice en cours : même rendu inline que le titre de l'Agenda admin. */}
          {currentExerciceId != null && (
            <span className="exercice-nav-inline">
              <span className="ex-nav-label">
                {exercices.find((e) => e.id === currentExerciceId)?.label}
              </span>
            </span>
          )}
        </div>
        {/* Navigation semaine (Semaine réelle) : centrée sur la même ligne que le
            titre et le sélecteur. */}
        {mode === "realweek" && (
          <div
            className="periode-nav"
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              // Neutralise la marge asymétrique de .periode-nav qui décalerait le
              // centrage vertical (sinon la nav n'est pas au même niveau que le titre).
              margin: 0,
            }}
          >
            {/* Groupe ◀ label ▶ : shrink-wrappé et positionné (relative) → « Aujourd'hui »
                s'ancre en left:100% de CE groupe (juste après ▶), sans compter dans le
                centrage. Vrai sur desktop comme sur mobile, quelle que soit la largeur. */}
            <span
              className="pn-main"
              style={{
                position: "relative",
                display: "inline-flex",
                alignItems: "center",
                gap: ".5rem",
              }}
            >
              <button
                type="button"
                className="ex-arrow"
                disabled={!canWeekPrev}
                onClick={() => canWeekPrev && shiftWeek(-1)}
              >
                ◀
              </button>
              <span className="ex-nav-label">
                {mondayStr
                  ? `${shortDateFmt.format(addDays(mondayStr, 0))} → ${shortDateFmt.format(addDays(mondayStr, 6))}`
                  : "…"}
              </span>
              <button
                type="button"
                className="ex-arrow"
                disabled={!canWeekNext}
                onClick={() => canWeekNext && shiftWeek(1)}
              >
                ▶
              </button>
              {todayInVisiblePeriods && (
                <button
                  type="button"
                  className="btn btn-ghost pn-today"
                  // Hors flux : positionné à droite de « ◀ label ▶ » sans compter dans sa
                  // largeur → seule la nav ◀ label ▶ est centrée par rapport au tableau.
                  style={{
                    padding: ".05rem .45rem",
                    fontSize: ".64rem",
                    position: "absolute",
                    left: "100%",
                    top: "50%",
                    transform: "translateY(-50%)",
                    marginLeft: ".4rem",
                    whiteSpace: "nowrap",
                  }}
                  onClick={() => {
                    // Retour à la semaine courante : on verrouille sur la période
                    // qui couvre AUJOURD'HUI (et non celle du lundi de la semaine,
                    // qui diffère quand la semaine chevauche deux périodes — sinon
                    // on afficherait la période du mois précédent).
                    setRwPeriodId(periodCoveringDate(todayYmd)?.id ?? null);
                    setAnchorMonday(ymd(mondayOf(new Date())));
                  }}
                >
                  Aujourd&apos;hui
                </button>
              )}
            </span>
          </div>
        )}
        {/* Sélecteurs empilés (cf. legacy .agenda-mode-toggles-wrap, colonne,
            alignés à droite) : Modèle/Semaine réelle, puis EN DESSOUS le toggle
            Semaine A/B en mode modèle, ou l'indicateur de semaine en semaine réelle. */}
        {/* Agenda usager : la vue (Modèle / Semaine réelle) est verrouillée sur le
            type du demandeur, donc pas de bascule manuelle — on ne garde que le
            sélecteur Semaine A/B (mode modèle) / l'indicateur de semaine. */}
        {/* Desktop : aligné à gauche (marginRight auto). Mobile : aligné à droite
            (marginLeft auto) et boutons un peu plus gros. */}
        <div
          className="agenda-mode-toggles-wrap"
          style={isMobile ? { marginLeft: "auto" } : { marginRight: "auto" }}
        >
          {abMode && mode === "model" && (
            <div className="agenda-mode-toggle" aria-label="Semaine A ou B">
              <button
                type="button"
                className={`agenda-mode-btn${weekAB === "A" ? " active" : ""}`}
                style={{
                  fontSize: isMobile ? ".7rem" : ".71rem",
                  padding: isMobile ? ".26rem .55rem" : ".21rem .65rem",
                }}
                onClick={() => setWeekAB("A")}
              >
                Semaine A
              </button>
              <button
                type="button"
                className={`agenda-mode-btn${weekAB === "B" ? " active" : ""}`}
                style={{
                  fontSize: isMobile ? ".7rem" : ".71rem",
                  padding: isMobile ? ".26rem .55rem" : ".21rem .65rem",
                }}
                onClick={() => setWeekAB("B")}
              >
                Semaine B
              </button>
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: ".75rem",
          flexWrap: "wrap",
          // Conteneur des onglets de période : marge basse réduite sur smartphone.
          marginBottom: isMobile ? "0.5rem" : ".75rem",
        }}
      >
        <div className="period-tabs" id="agenda-period-tabs">
          {visiblePeriods.map((p, i) => {
            const active = mode === "realweek" ? p.id === coveringPeriod?.id : i === periodIdx;
            return (
              <button
                key={p.id}
                type="button"
                className={`period-btn ${active ? "active" : ""}`}
                style={{ "--period-color": p.color } as React.CSSProperties}
                onClick={() => {
                  if (mode === "realweek") {
                    // Onglet choisi = source de vérité : on fige la période ET on
                    // ancre la semaine sur son début (cf. legacy _pickedP).
                    if (p.dateStart) {
                      setRwPeriodId(p.id);
                      setAnchorMonday(ymd(mondayOf(new Date(`${p.dateStart}T00:00:00`))));
                    }
                  } else {
                    setPeriodIdx(i);
                  }
                }}
              >
                <span className="period-badge" />
                {p.label}
              </button>
            );
          })}
          {periods.length === 0 && (
            <span style={{ fontSize: ".75rem", color: "var(--muted)" }}>
              Aucune période active.
            </span>
          )}
        </div>
        {/* Options (case « sans créneau » + impression) : masquées sur mobile. */}
        <div
          style={{
            display: isMobile ? "none" : "flex",
            alignItems: "center",
            gap: "1rem",
            flexWrap: "wrap",
          }}
        >
          <div
            className="planning-options-row"
            style={{ flexDirection: "column", alignItems: "flex-end", gap: 1, lineHeight: 1.1 }}
          >
            <label className="planning-option">
              Masquer les horaires sans créneau
              <input
                type="checkbox"
                checked={hideNoSlotPref}
                onChange={(e) => setHideNoSlotPref(e.target.checked)}
              />
            </label>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
            <button
              type="button"
              onClick={printMyBookings}
              data-tip="Imprimer la liste de mes réservations"
              aria-label="Imprimer la liste de mes réservations"
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
          </div>
        </div>
      </div>

      {/* Navigation jour par jour (mobile uniquement) : la grille n'affiche qu'un jour.
          Cyclique en Modèle de période ; à travers toute la période en Semaine réelle. */}
      {isMobile && mobileDay && (
        <div className="mobile-day-nav">
          <button
            type="button"
            onClick={() => mobileGoDay(-1)}
            disabled={!mobileDayTarget(-1)}
            aria-label="Jour précédent"
          >
            ◀
          </button>
          <span className="mobile-day-label">
            {DAY_NAMES[mobileDay] ?? mobileDay}
            {mode === "realweek" && weekDateByDay[mobileDay] ? ` ${weekDateByDay[mobileDay]}` : ""}
          </span>
          <button
            type="button"
            onClick={() => mobileGoDay(1)}
            disabled={!mobileDayTarget(1)}
            aria-label="Jour suivant"
          >
            ▶
          </button>
        </div>
      )}

      <div className="planning-wrap">
        <div
          className={`agenda-grid${mode === "realweek" ? " is-realweek" : ""}`}
          style={{ gridTemplateColumns: `44px repeat(${displayDays.length}, minmax(0, 1fr))` }}
        >
          <AgendaWeekHeader
            days={displayDays}
            abMode={abMode}
            effectiveWeek={effectiveWeek}
            realweek={mode === "realweek"}
            weekDateByDay={weekDateByDay}
            outOfPeriodCls={outOfPeriodCls}
          />

          {/* Bande « Journée entière » : créneaux sans horaire, au-dessus de la
              grille horaire (port du legacy alldayRow). Masquée s'il n'y a aucun
              bloc all-day. Côté usager, on affiche TOUS les créneaux (réservés ou
              vides réservables) : le compactage « sans créneau » ne masque que des
              heures vides, pas les créneaux. */}
          {displayDays.some((d) => dayBlocks(d).some((b) => b.isAllDay)) && (
            <>
              <div className="agenda-header-cell agenda-allday-corner" data-tip="Journée entière">
                Journée entière
              </div>
              {displayDays.map((d) => (
                <div key={`ad-${d}`} className={`agenda-allday-cell${outOfPeriodCls(d)}`}>
                  {dayBlockEls.allday.get(d)}
                </div>
              ))}
            </>
          )}

          <AgendaTimeColumn
            quarters={quarters}
            qIdx={qIdx}
            gridStartMin={gridStartMin}
            gridEndMin={gridEndMin}
            totalH={totalH}
            hasLunch={hasLunch}
            lunchSkipFrom={lunchSkipFrom}
            lunchEnd={lunchEnd}
            mapMinToY={mapMinToY}
          />

          {displayDays.map((d) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: grille agenda (clic = créer)
            <div
              key={d}
              className={`agenda-day-col${outOfPeriodCls(d)}`}
              // Jour fermé : on neutralise toute interaction (clic créer, drag/drop)
              // sur la colonne ET tout son contenu (blocs/badges) via pointer-events.
              style={{
                height: totalH,
                cursor: isDayDisabled(d) ? "not-allowed" : "cell",
                pointerEvents: isDayDisabled(d) ? "none" : undefined,
              }}
              onClick={(e) => {
                if (isDayDisabled(d)) return;
                const slot = slotAtClientY(e.currentTarget.getBoundingClientRect().top, e.clientY);
                if (slot && effectivePeriodId != null && effectivePeriodId > 0)
                  togglePendingAdd(slot.id, d, uniqueIdSet.has(slot.id));
              }}
            >
              <AgendaDayBackground
                quarters={quarters}
                hasLunch={hasLunch}
                lunchStart={lunchStart}
                lunchEnd={lunchEnd}
                mapMinToY={mapMinToY}
              />
              {/* Grille horaire : uniquement les créneaux horaires (les « journée
                  entière » sont rendus dans la bande dédiée en haut). On affiche TOUS
                  les créneaux (réservés ou vides réservables) ; « Masquer les horaires
                  sans créneau » ne compacte que des heures, pas des créneaux. Blocs
                  mémoïsés via dayBlockEls (perf). */}
              {dayBlockEls.timed.get(d)}
            </div>
          ))}
        </div>
      </div>

      {/* Légende des états (sous le tableau) : mini-badge (icône d'état seule) + libellé. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: ".4rem",
          margin: "0.2rem 0 0",
          fontSize: ".75rem",
          color: "var(--muted)",
        }}
      >
        {/* 1re ligne : état « en attente » à gauche, info « max. réservations » à droite. */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "1rem",
            width: "100%",
          }}
        >
          {/* Info « max. réservations » (ligne du haut, alignée à gauche). */}
          <p
            style={{
              fontSize: ".75rem",
              color: "var(--muted)",
              margin: 0,
              textAlign: "left",
              flex: "1 1 auto",
              minWidth: 0,
            }}
          >
            ℹ️ {(() => {
              // « par période » affiché dès qu'il y a des périodes : récurrent (toujours) OU
              // ponctuel rattaché à des périodes — la limite par période s'applique aussi au
              // ponctuel (cf. assertReservationLimits, slot avec periodId). Hors période, seule
              // la limite annuelle vaut.
              // Granularité d'une période, déduite de la durée médiane (dateStart→dateEnd) :
              // ~mois / ~trimestre / ~année. Sert à nommer la limite « par <granularité> ».
              const spans = periods
                .filter((p) => p.dateStart && p.dateEnd)
                .map((p) => (Date.parse(p.dateEnd) - Date.parse(p.dateStart)) / 86_400_000 + 1)
                .sort((a, b) => a - b);
              const medianDays = spans.length ? spans[Math.floor(spans.length / 2)] : null;
              const periodNoun =
                medianDays == null
                  ? "période"
                  : medianDays <= 45
                    ? "mois"
                    : medianDays <= 200
                      ? "trimestre"
                      : "année";
              // « par <granularité> » affiché dès qu'il y a des périodes (récurrent toujours, ou
              // ponctuel rattaché à des périodes — la limite s'applique aussi, cf.
              // assertReservationLimits). Masqué quand la période = l'année (doublon « par an »).
              const showPeriod =
                (modes.recurringMode || periods.length > 0) && periodNoun !== "année";
              // Libellé unifié « séance(s) » quel que soit le mode (récurrent ou ponctuel).
              const noun = (n: number) => `séance${n > 1 ? "s" : ""}`;
              return (
                <>
                  Vous pouvez réserver{" "}
                  {showPeriod && (
                    <>
                      <strong>
                        {service.maxReservationsPeriod} {noun(service.maxReservationsPeriod)} par{" "}
                        {periodNoun}
                      </strong>{" "}
                      et{" "}
                    </>
                  )}
                  <strong>
                    {service.maxReservations} {noun(service.maxReservations)} par an
                  </strong>
                  .
                </>
              );
            })()}
          </p>
        </div>
        {/* 2e ligne : état « en attente » à gauche, boutons d'action à droite. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          {/* Zone gauche commune aux deux lignes : 50 % de la ligne (2 × 25 % pour le
              libellé d'état et la légende Créneau), bornée par la somme des min-width. */}
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              flexShrink: 0,
              width: "50%",
              // Somme des planchers : libellé (160) + légende (130) + marge (1rem).
              minWidth: 306,
            }}
          >
            {/* Largeur fixe commune aux deux lignes de légende : les items « Récurrent »
                et « Ponctuel » qui suivent démarrent sur la même colonne. */}
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: ".45rem",
                // 25 % de la ligne (50 % de la zone gauche), plancher 160px → les légendes
                // qui suivent démarrent sur la même colonne ; repli au besoin, interligne
                // minimal.
                width: "50%",
                minWidth: 160,
                lineHeight: 1,
                letterSpacing: "-0.02em",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 34,
                  height: 20,
                  borderRadius: "var(--rad-sm)",
                  background: "#ffe6a7",
                  boxShadow: "2px 2px 4px rgba(0, 0, 0, .28)",
                  flexShrink: 0,
                }}
              >
                <span
                  className="slot-icon"
                  style={{ fontSize: ".85rem", lineHeight: 1, color: "#b2a478" }}
                >
                  ⏳
                </span>
              </span>
              Demande en attente de validation
            </span>
            {/* Légende « Créneau récurrent » (même rendu que l'agenda admin), à droite. */}
            <span
              className="agenda-legend-item"
              style={{
                marginLeft: "1rem",
                letterSpacing: "-0.02em",
                // 25 % de la ligne (moitié restante de la zone gauche, marge déduite),
                // plancher 130px ; repli au besoin, interligne minimal.
                width: "calc(50% - 1rem)",
                minWidth: 130,
                lineHeight: 1.1,
              }}
            >
              <span className="agenda-legend-swatch is-rec" />
              Créneau récurrent
            </span>
          </span>
          {/* Barre d'actions du brouillon (« Annuler » / « Enregistrer → »). */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: ".6rem",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: ".22rem .6rem", fontSize: ".66rem" }}
              onClick={clearPending}
              disabled={pendingCount === 0}
            >
              Annuler
            </button>
            <button
              type="button"
              className="btn btn-primary"
              // Une suppression en attente → « Supprimer → » en rouge danger.
              style={{
                padding: ".22rem .6rem",
                fontSize: ".66rem",
                ...(isDeletion
                  ? { background: "var(--danger)", borderColor: "var(--danger)", color: "#fff" }
                  : {}),
              }}
              // Enregistrement DIRECT → toast vert (création/modif/déplacement) ou rouge.
              onClick={commitPending}
              disabled={pendingCount === 0 || committing}
            >
              {isDeletion ? "Supprimer →" : "Enregistrer →"}
            </button>
          </div>
        </div>
        {/* 3e ligne : état « validée » à gauche, compteur du brouillon à droite. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          {/* Zone gauche commune aux deux lignes : 50 % de la ligne (2 × 25 % pour le
              libellé d'état et la légende Créneau), bornée par la somme des min-width. */}
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              flexShrink: 0,
              width: "50%",
              // Somme des planchers : libellé (160) + légende (130) + marge (1rem).
              minWidth: 306,
            }}
          >
            {/* Même largeur fixe que la ligne « en attente » ci-dessus → colonnes alignées. */}
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: ".45rem",
                // 25 % de la ligne (50 % de la zone gauche), plancher 160px → les légendes
                // qui suivent démarrent sur la même colonne ; repli au besoin, interligne
                // minimal.
                width: "50%",
                minWidth: 160,
                lineHeight: 1,
                letterSpacing: "-0.02em",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 34,
                  height: 20,
                  borderRadius: "var(--rad-sm)",
                  background: "#c8e8b8",
                  boxShadow: "2px 2px 4px rgba(0, 0, 0, .28)",
                  flexShrink: 0,
                }}
              >
                <span
                  className="slot-icon"
                  style={{ fontSize: ".85rem", lineHeight: 1, color: "#3e7e2f" }}
                >
                  ✔
                </span>
              </span>
              Réservation validée
            </span>
            {/* Légende « Créneau ponctuel » (même rendu que l'agenda admin), à droite. */}
            <span
              className="agenda-legend-item"
              style={{
                marginLeft: "1rem",
                letterSpacing: "-0.02em",
                // 25 % de la ligne (moitié restante de la zone gauche, marge déduite),
                // plancher 130px ; repli au besoin, interligne minimal.
                width: "calc(50% - 1rem)",
                minWidth: 130,
                lineHeight: 1.1,
              }}
            >
              <span className="agenda-legend-swatch is-uniq" />
              Créneau ponctuel
            </span>
          </span>
          {/* Compteur du brouillon (aligné à droite). */}
          <p
            style={{
              fontSize: ".75rem",
              color: pendingCount > 0 ? "var(--warn)" : "var(--muted)",
              margin: 0,
              textAlign: "right",
              whiteSpace: "nowrap",
            }}
          >
            {pendingCount > 0
              ? [
                  pendingAdds.length > 0
                    ? `${pendingAdds.length} élément${pendingAdds.length > 1 ? "s" : ""} à réserver`
                    : "",
                  pendingRemovals.length > 0
                    ? `${pendingRemovals.length} élément${pendingRemovals.length > 1 ? "s" : ""} à supprimer`
                    : "",
                  Object.keys(pendingUpdates).length > 0
                    ? `${Object.keys(pendingUpdates).length} élément${
                        Object.keys(pendingUpdates).length > 1 ? "s" : ""
                      } à modifier`
                    : "",
                  Object.keys(pendingMoves).length > 0
                    ? `${Object.keys(pendingMoves).length} élément${
                        Object.keys(pendingMoves).length > 1 ? "s" : ""
                      } à déplacer`
                    : "",
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "Aucune modification en attente"}
          </p>
        </div>
      </div>

      {/* Bandeau debug (legacy #dem-info) : demandeur de l'usager + ses 5 modes,
          affiché uniquement en mode debug (localStorage rc_debug / body.debug-mode). */}
      {debug && (
        <div
          className="dem-info"
          style={{
            display: "flex",
            alignItems: "center",
            gap: ".6rem",
            flexWrap: "wrap",
            fontSize: ".78rem",
            color: "var(--muted)",
            padding: ".6rem 0",
            marginTop: ".4rem",
          }}
        >
          {demandeurLabel && (
            <span style={{ color: "var(--text)", fontWeight: 600 }}>{demandeurLabel}</span>
          )}
          <span style={{ color: "var(--border)" }}>|</span>
          {(
            [
              ["Récurrent", modes.recurringMode],
              ["Sem. A/B", modes.abMode],
              ["Validation", modes.validationMode],
              ["Thèmes", modes.themeMode],
              // (Jauge : portée par chaque créneau — slots.jauge — plus un mode service.)
              // Ouvert les jours fériés = niveau service ; Ouvert vacances scolaires =
              // niveau demandeur de l'usager (openOnSchoolHolidays).
              ["Ouvert les jours fériés", contextOpenings[0]?.openOnHolidays ?? false],
              [
                "Ouvert vacances scolaires",
                (contextOpenings[0]?.openOnSchoolHolidays ?? false) &&
                  demandeurOpenOnSchoolHolidays,
              ],
            ] as [string, boolean][]
          ).map(([label, on]) => (
            <span key={label} style={{ opacity: on ? 1 : 0.35 }}>
              {label} <strong>{on ? "✓" : "—"}</strong>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
