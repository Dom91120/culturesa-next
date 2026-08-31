"use client";

import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  useAgendaAutoRefresh,
  useAgendaToast,
  useCoveringPeriodLock,
  useFreshRef,
  usePersistedAgendaView,
  useWeekGridColumns,
  useWeekNavigation,
} from "@/components/agenda-hooks";
import {
  AgendaAllDayRow,
  AgendaDayBackground,
  AgendaEmptyWeekNotice,
  AgendaLegendSwatch,
  AgendaTimeColumn,
  AgendaWeekHeader,
  PrintIconButton,
} from "@/components/agenda-shared";
import { AgendaTooltip, useAgendaTooltip } from "@/components/agenda-tooltip";
import {
  type AgendaBlockBase,
  type AgendaBookingCore,
  addDays,
  autonomousUniqueIds,
  buildBlocksByDay,
  buildMirrorMap,
  CLOSED_OPENING,
  coveringForYmd,
  DAY_NAMES,
  DAY_OFFSET,
  dayKeyFromYmd,
  deriveCoveringPeriod,
  type ExerciceOpening,
  gridGeometry,
  lunchBounds,
  makeDayClosure,
  mondayOf,
  parseWeeks,
  periodsCoverToday,
  type Slot,
  shortDateFmt,
  slotWeekTag,
  toMinutes,
  type UniqueSlot,
  visiblePeriodsOf,
  weekDateLabels,
  ymd,
} from "@/lib/agenda-core";
import { earliestBookableISO } from "@/lib/booking-delay";
import { isFrenchHoliday } from "@/lib/french-holidays";
import { gaugeUnits } from "@/lib/gauge";
import { printTableDocument } from "@/lib/print-html";
import { isInSchoolHolidayRange as inSchoolHolidayRange } from "@/lib/school-holidays";
import { usePointerDrag } from "@/lib/use-pointer-drag";
import { THEME_REQUIS_MSG } from "@/schemas/booking";
import type { ServiceModes } from "@/server/services/service-modes";
import { commitDraft } from "./actions";

// (Les réglages d'ouverture — plages, jours actifs, fériés, vacances — sont portés
// par CHAQUE EXERCICE, cf. type Exercice.opening ; hors exercice = fermé.)
type Service = {
  id: string;
  label: string;
  bookingDelay: number;
  capacity: number;
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

// Flèches de la navigation SEMAINE : 1rem (contre les .7rem de `.periode-nav
// .ex-arrow`), sans padding vertical pour ne pas épaissir la ligne. Réglé ici et non
// sur la classe, que partagent la barre d'exercice et le panneau Périodes. Même
// gabarit que la nav de l'agenda admin.
const WEEK_ARROW_STYLE: React.CSSProperties = { fontSize: "1rem", padding: "0 .2rem" };

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
  const onClickRef = useFreshRef(onClick);
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
  fieldId,
  big = false,
  multiline = false,
}: {
  value: string;
  validated: boolean;
  themesMode: "libre" | "liste";
  themes: string[];
  onChange: (v: string) => void;
  // Identifiant DOM du contrôle focalisable : sert à AMENER LE CURSEUR sur le thème
  // manquant quand l'enregistrement est refusé (cf. commitPending).
  fieldId?: string;
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
          id={fieldId}
          // Focalisable au clavier ET par script : c'est ce contrôle que vise le curseur
          // quand l'enregistrement est refusé faute de thème (mode « liste »). Un vrai
          // <button> serait plus juste, mais il porte déjà un bouton chevron imbriqué —
          // interdit dans un bouton — et sa refonte déborde de ce correctif.
          // biome-ignore lint/a11y/noNoninteractiveTabindex: picker custom, cible du focus
          tabIndex={0}
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
      id={fieldId}
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

/**
 * Identifiant DOM du champ thème d'un badge. Deux origines possibles — une réservation
 * enregistrée (son id) ou un ajout du brouillon (sa clé) —, d'où le préfixe : un
 * brouillon et une réservation ne doivent jamais se disputer le même identifiant.
 * Sert à AMENER LE CURSEUR sur le thème manquant quand l'enregistrement est refusé.
 */
function themeFieldId(ref: { kind: "booking"; id: number } | { kind: "draft"; key: string }) {
  return ref.kind === "booking" ? `theme-bk-${ref.id}` : `theme-add-${ref.key}`;
}

// Badge « ma réservation » / sélection en brouillon — RENDU UNIQUE partagé par les
// réservations existantes de l'usager ET les sélections en attente (pending add).
// Les deux sont LE MÊME badge : seules la source des compteurs/thème et les callbacks
// diffèrent (réservation enregistrée ↔ brouillon). Vert si validé, orange sinon.
// React.memo (audit perf 2026-07-19) : un changement de brouillon (jauge, thème,
// ajout/suppression) recrée renderBlock (les 4 maps de brouillon sont en déps) →
// dayBlockEls recrée les éléments, MAIS ce badge mémoïsé ne se re-rend QUE si SES
// props changent. Primitives comparées par valeur ; les 5 callbacks sont stabilisés
// par badge côté parent (cf. badgeCbs) → seul le badge modifié se re-rend, pas les
// ~50 autres. Sans stabilisation des callbacks, la mémo ne servirait à rien.
const MineBadge = memo(function MineBadge({
  validated,
  markedRemoval,
  moving = false,
  mobile = false,
  gaugeOn,
  themeMode,
  themesMode,
  themes,
  themeFieldId,
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
  // Identifiant DOM du champ thème, pour y amener le curseur en cas de refus.
  themeFieldId?: string;
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
        fieldId={themeFieldId}
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
});

// Callbacks « no-op » stables (badge synthétique en lecture seule) : références
// constantes → la mémo de MineBadge n'est pas invalidée par des closures recréées.
const NOOP = () => {};

// Jeu des 5 callbacks interactifs d'un badge « ma réservation » / brouillon, stabilisé
// par badge (cf. badgeCbs) pour que React.memo(MineBadge) reste efficace.
type BadgeCbs = {
  onClose: () => void;
  onBump: (field: "enfants" | "accompagnants", delta: 1 | -1) => void;
  onSetCount: (field: "enfants" | "accompagnants", value: number) => void;
  onSetTheme: (v: string) => void;
  onDragPointerDown: (e: React.PointerEvent) => void;
};

// Ligne « N enfant(s) M adulte(s) » de l'info-bulle au survol (port legacy _badgeTitle).
function participantsLabel(enfants: number, accompagnants: number): string {
  return `${enfants} enfant${enfants > 1 ? "s" : ""} ${accompagnants} adulte${
    accompagnants > 1 ? "s" : ""
  }`;
}

// Socle commun aux deux grilles (AgendaBookingCore, agenda-core) + champs propres
// au payload USAGER.
type Booking = AgendaBookingCore & {
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
// committé via le panier atomique (commitDraft). Clé = id de la réservation déplacée.
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
  // Agenda usager UNIFIÉ (décision 2026-07-11) : TOUJOURS en « Semaine réelle », quel
  // que soit le type du demandeur — récurrents en jaune, ponctuels en bleu-gris, côte à
  // côte. Cliquer un récurrent réserve TOUTE la récurrence (période couvrante, parité de
  // la semaine affichée) ; cliquer un ponctuel réserve l'occurrence. L'ancien mode
  // « Modèle de période » a été retiré (code mort purgé 2026-07-14).
  const [anchorMonday, setAnchorMonday] = useState<string | null>(null);
  // Mode "Semaine réelle" : période active verrouillée. Sans ce verrou, on
  // re-dérive la période depuis la semaine à chaque ◀/▶ — et quand une semaine
  // chevauche la frontière de deux périodes contiguës, elle bascule sur la
  // voisine (dont les bornes laissent sortir). Cf. legacy _agendaPeriodUserPicked.
  const [rwPeriodId, setRwPeriodId] = useState<number | null>(null);
  // « Masquer les horaires sans créneau » : compacte les heures qui ne portent AUCUN
  // créneau. Préférence utilisateur (décochée par défaut) — voir la valeur effective
  // `hideNoSlot` dérivée plus bas (forcée sur mobile).
  const [hideNoSlotPref, setHideNoSlotPref] = useState(false);
  // Modale "pile" : liste des réservations d'un créneau (clé slot+jour, recalculée
  // en direct depuis blocksByDay pour rester à jour après un refresh).
  // Glisser-déplacer (pointer events, cf. usePointerDrag) : élément en cours de drag.
  // Remplace l'ancien drag HTML5 (inopérant au doigt). Le suivi du curseur (ghost) et la
  // surbrillance de la cible sont pilotés en DOM DIRECT via refs (audit perf 2026-07-19) :
  // un setState par pixel/cellule re-rendait tout le composant à chaque pointermove.
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  // Position de MONTAGE du ghost (posée au 1er pointermove uniquement) ; les déplacements
  // suivants écrivent left/top directement sur l'élément (dragGhostElRef), sans re-render.
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const dragGhostElRef = useRef<HTMLDivElement | null>(null);
  // Cellule cible de dépôt courante : classe .slot-user-drop-target posée/retirée en DOM
  // direct (l'ancien état dropKey invalidait renderBlock → re-render de toute la grille à
  // chaque changement de cellule survolée).
  const dropTargetElRef = useRef<HTMLElement | null>(null);
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
  // Toast (variantes --success vert / --danger rouge), repris de la grille admin : centré
  // sur .app-main, bas de page, auto-dismiss ~4 s. Sert au verrou « une seule action »
  // (rouge) et au résultat de l'enregistrement du brouillon (vert création/modif/déplacement,
  // rouge suppression ou erreur).
  // (Hook partagé avec la grille admin — cf. components/agenda-hooks.)
  const {
    toast,
    toastVisible,
    toastCenterX,
    showToast: pushToast,
  } = useAgendaToast<{ content: string; variant: "success" | "danger" }>();
  function showToast(content: string, variant: "success" | "danger") {
    pushToast({ content, variant });
  }
  // Info-bulle flottante unique (texte data-tip / « Journées concernées »), factorisée
  // dans un hook partagé. Suspendue pendant la saisie d'un thème.
  const { tip, tipRef, onAgendaTip, clearTip } = useAgendaTooltip({
    getDates: (slotId, dayKey) => concernedDatesForBlock(slotId, dayKey),
    // Cadence du créneau récurrent survolé (au-dessus des « Journées concernées ») :
    // « Semaine A » / « Semaine B » quand le service alterne A/B et que le créneau ne
    // porte qu'une parité ; sinon « Toutes les semaines ». Les ponctuels (absents de
    // `slots`) n'ont pas de cadence.
    getMeta: (slotId) => {
      const s = slots.find((sl) => sl.id === slotId);
      if (!s) return {};
      const weeks = parseWeeks(s.weeks);
      const weekLabel =
        modes.abMode && weeks.length === 1
          ? weeks[0] === "A"
            ? "Semaines A"
            : "Semaines B"
          : "Toutes les semaines";
      return { weekLabel };
    },
    suppressed: () => isThemeBeingEdited(),
  });

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

  // Ouvertures « de contexte », colonnes (jours actifs, UNION des exercices de la
  // semaine — le grisage par date via isDayDisabled ferme les jours inactifs),
  // bornes horaires et offsets des jours travaillés : câblage partagé
  // (useWeekGridColumns, agenda-hooks). openingForYmd reste local (∧ demandeur).
  const { contextOpenings, days, baseFirst, baseLast, firstDayOffset, lastDayOffset } =
    useWeekGridColumns(anchorMonday, openingForYmd);

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

  // (Bornes horaires de la grille : dérivées plus haut avec les colonnes, cf.
  // gridDaysAndBounds.)

  // Périodes visibles = celles de l'exercice courant (toutes si aucun exercice).
  const visiblePeriods = visiblePeriodsOf(periods, currentExerciceId);

  // « Aujourd'hui » n'a de sens que si la date du jour tombe dans une période de l'exercice
  // affiché (sinon le bouton renverrait hors de la plage visible) → on masque le bouton sinon.
  const todayYmd = ymd(new Date());
  const todayInVisiblePeriods = periodsCoverToday(visiblePeriods, todayYmd);

  // ── Mode "Semaine réelle" : semaine datée + période couvrant cette semaine ──
  // (Dérivation partagée deriveCoveringPeriod, agenda-core — verrou rwPeriodId
  // prioritaire, repli lundi puis mercredi.)
  const mondayStr = anchorMonday;
  const { sundayStr, periodCoveringDate, coveringPeriod } = deriveCoveringPeriod(
    periods,
    mondayStr,
    rwPeriodId,
  );
  // Sans période couvrant la semaine, -1 ne matche rien → aucun bloc.
  const effectivePeriodId = coveringPeriod?.id ?? -1;

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
  // Navigation hebdo ◀/▶ (câblage partagé useWeekNavigation, agenda-hooks) : bornée
  // à la période couvrante ; en hideNoSlot, saute aux semaines AYANT un créneau.
  const { canWeekPrev, canWeekNext, shiftWeek } = useWeekNavigation({
    mondayStr,
    coveringPeriod,
    hideEmpty: hideNoSlot,
    weekHas: weekHasSlot,
    weekHasDeps: [uniqSlotDates, recurSlotAbByPeriod, periods, modes.abMode],
    setAnchorMonday,
  });

  // ── Navigation jour (mobile) ────────────────────────────────────────────────
  // Modèle de période (récurrent) : CYCLIQUE sur les jours de la semaine type.
  // Semaine réelle (ponctuel) : NON cyclique, à travers TOUTE la période (change de
  // semaine en franchissant les bords), bornée par les dates de la période.
  // Renvoie la cible { monday, idx } ou null si le déplacement est bloqué (bord de période).
  function mobileDayTarget(dir: 1 | -1): { monday: string | null; idx: number } | null {
    if (!days.length) return null;
    const idx = Math.min(mobileDayIdx, days.length - 1);
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
    if (t.monday && t.monday !== mondayStr) setAnchorMonday(t.monday);
    setMobileDayIdx(t.idx);
  }

  // Libellé daté de chaque jour de la semaine réelle, par dayKey.
  const weekDateByDay = useMemo(() => weekDateLabels(mondayStr, days), [mondayStr, days]);
  // Jour fermé / férié (semaine réelle) : prédicats partagés (makeDayClosure,
  // agenda-core). La politique vacances du DEMANDEUR est déjà combinée (∧) dans
  // openingForYmd. Mémoïsé : identités stables requises pour mémoïser `occupiedQ`
  // (sinon recalcul à chaque rendu, donc à chaque survol/drag).
  const { isDayDisabled, outOfPeriodCls } = useMemo(
    () =>
      makeDayClosure({
        active: true,
        mondayStr,
        coveringPeriod,
        openingForYmd,
        schoolHolidays: schoolHolidays ?? [],
      }),
    [mondayStr, coveringPeriod, openingForYmd, schoolHolidays],
  );

  // ── Semaines A/B ── (toujours disponible ; la parité est portée par chaque créneau, Slot.weeks)
  const abMode = modes.abMode;
  const realWeekParity: "A" | "B" | null = mondayStr ? slotWeekTag(mondayStr) : null;
  // Semaine effective filtrée = parité de la date affichée (mode A/B seulement).
  const effectiveWeek: "A" | "B" | null = abMode ? realWeekParity : null;

  // La plage horaire affichée reste fixe (matin → après-midi). « Masquer les
  // horaires sans créneau » ne resserre pas la plage : il COMPACTE les quarts
  // d'heure sans créneau (cf. legacy renderAgendaWeekly), géré plus bas via `quarters`.
  const firstHour = baseFirst;
  const lastHour = baseLast;

  const gridStartMin = firstHour * 60;
  const gridEndMin = lastHour * 60;

  // Ids des créneaux ponctuels AUTONOMES (non miroirs) : affichés en vert et en
  // lecture seule (on neutralise la création/déplacement de résa récurrente dessus ;
  // la réservation ponctuelle relève d'un autre flux).
  const uniqueIdSet = useMemo(() => autonomousUniqueIds(uniqueSlots), [uniqueSlots]);
  // Index slot ponctuel → slot (lookup O(1)), au lieu d'un .find() linéaire répété par bloc.
  const uniqSlotById = useMemo(() => new Map(uniqueSlots.map((s) => [s.id, s])), [uniqueSlots]);
  // Index réservation → réservation : résout une occurrence ENFANT vers sa PARENTE
  // (les actions du badge — annulation, édition, déplacement — portent toujours sur
  // la réservation logique, jamais sur une séance isolée).
  const bookingById = useMemo(() => new Map(bookings.map((b) => [b.id, b])), [bookings]);
  // Idem pour les créneaux récurrents.
  const recurSlotById = useMemo(() => new Map(slots.map((s) => [s.id, s])), [slots]);
  // Slots miroirs → parent + date : rattache les réservations-enfants à la cellule du
  // slot parent en « Semaine réelle » (elles y portent le pointage, en lecture seule
  // côté usager).
  const mirrorMap = useMemo(() => buildMirrorMap(uniqueSlots), [uniqueSlots]);

  // ── Pause méridienne (port legacy renderAgendaWeekly) ───────────────────────
  // Zone entre morningEnd et afternoonStart. Si > 30 min, on COMPACTE : on ne garde
  // que 2 quarts visuels (30 min) — les quarts au-delà de lunchStart+30 sont sautés.
  // Le reste de la grille (lignes, heures, blocs, clics) suit un mapping par quarts
  // d'heure VISIBLES (mapMinToY), au lieu d'un mapping linéaire heure/heure.
  // Bornes de pause du premier contexte qui en définit une (fonction partagée
  // lunchBounds, agenda-core) — un jour hors exercice (CLOSED_OPENING) ne masque
  // pas la pause du reste de la semaine.
  const { lunchStart, lunchEnd, hasLunch, lunchSkipFrom } = lunchBounds(
    contextOpenings,
    gridStartMin,
    gridEndMin,
  );

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
    // Créneaux PONCTUELS autonomes datés dans la semaine affichée.
    if (mondayStr) {
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

  // Blocs par jour : moteur PARTAGÉ (buildBlocksByDay, agenda-core) avec les deux
  // points d'extension usager — re-routage des déplacements en brouillon
  // (routeBooking) et occurrences synthétiques de MES récurrentes non matérialisées
  // (injectExtra, lecture seule : le serveur refuserait de toute façon une 2ᵉ
  // réservation du même créneau ; les jours fermés sont écartés par dayBlocks).
  const blocksByDay = useMemo(
    () =>
      buildBlocksByDay<Booking>({
        slots,
        uniqueSlots,
        bookings,
        days,
        mondayStr,
        sundayStr,
        realweek: true,
        periodBounds: coveringPeriod,
        effectivePeriodId,
        effectiveWeek,
        abMode,
        gridStartMin,
        serviceCapacity: service.capacity,
        gaugeAccompagnants: service.gaugeAccompagnants,
        uniqueIdSet,
        mirrorMap,
        projectRecurringParent: false,
        // Réservation DÉPLACÉE (brouillon) : rattachée à son créneau CIBLE, plus à
        // son créneau d'origine (used/full suivent). Hors période/semaine active
        // (récurrent) ou hors « Semaine réelle » (ponctuel) → masquée. Le déplacement
        // porte sur la réservation PARENTE (réservation logique) : ses ENFANTS
        // matérialisés sont masqués tant que le déplacement est en brouillon — sinon
        // le badge apparaissait à la fois sur l'origine (enfant) et la cible (parente).
        routeBooking: (b) => {
          const mv = pendingMoves[b.id];
          if (!mv) {
            if (b.parentBookingId != null && pendingMoves[b.parentBookingId]) return "skip";
            return "default";
          }
          if (mv.ponctuel) {
            if (!mondayStr) return "skip";
          } else {
            if (effectivePeriodId != null && mv.periodId !== effectivePeriodId) return "skip";
            if (effectiveWeek != null && mv.week !== effectiveWeek && mv.week !== "") return "skip";
          }
          return { dayKey: mv.dayKey, slotId: mv.slotId };
        },
        injectExtra: ({ groups, pushGroup, slotById }) => {
          if (!mondayStr) return;
          for (const p of bookings) {
            if (!p.mine || p.bookingType !== "recurring" || p.parentBookingId !== null) continue;
            // Parente en cours de DÉPLACEMENT (brouillon) : ne rien synthétiser sur
            // l'origine — le badge ne doit apparaître que sur la cible.
            if (pendingMoves[p.id]) continue;
            if (effectivePeriodId != null && p.periodId !== effectivePeriodId) continue;
            if (effectiveWeek != null && p.week !== effectiveWeek && p.week !== "") continue;
            const dk = slotById.get(p.slotId)?.slotDay;
            if (!dk || !days.includes(dk)) continue;
            const key = `${dk}|${p.slotId}`;
            // Occurrence déjà présente (enfant matérialisé de moi) → ne rien synthétiser.
            if (groups.get(key)?.some((x) => x.mine)) continue;
            pushGroup(key, { ...p, dayKey: dk, synthetic: true, pointage: null });
          }
        },
      }),
    [
      bookings,
      pendingMoves,
      slots,
      uniqueSlots,
      uniqueIdSet,
      mirrorMap,
      mondayStr,
      sundayStr,
      days,
      abMode,
      effectivePeriodId,
      effectiveWeek,
      coveringPeriod,
      gridStartMin,
      service.capacity,
      service.gaugeAccompagnants,
    ],
  );

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
    const period = coveringPeriod;
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
          .filter((d) => openingForYmd(d).openOnSchoolHolidays || !isSchoolHoliday(d))
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

    const who = `${userInfo.prenom} ${userInfo.nom}`.trim();
    // Gabarit partagé (printTableDocument, lib/print-html), variante standard.
    printTableDocument({
      title: [service.label, period?.label].filter(Boolean).join(" — ") || "Réservations",
      meta: `${who} · ${rows.length} réservation${rows.length > 1 ? "s" : ""}`,
      head: ["Date", "Créneau", "Type", "Thème", "Statut", "Pointage"],
      rows: rows.map((r) => [
        { text: dateLabel(r.date) },
        { text: r.creneau },
        { text: r.type },
        { text: r.theme },
        { text: r.statut },
        { text: r.pointage },
      ]),
    });
  }

  // Ancre PAR DÉFAUT (aucune vue mémorisée) — décision produit :
  //   1. semaine du prochain créneau encore RÉSERVABLE (délai, dispo de période,
  //      jour ouvert, place restante) ;
  //   2. sinon prochaine semaine PORTANT un créneau (semaine courante incluse) ;
  //   3. sinon dernière semaine portant un créneau (semaine courante incluse) ;
  //   à défaut de tout créneau, lundi courant.
  // Appelée au montage uniquement (effet ci-dessous) : les helpers de rendu
  // (earliestFor, dispoByPeriod, openingForYmd…) sont alors tous initialisés.
  // Règles 2/3 = occurrences AFFICHÉES par la grille : les créneaux RÉCURRENTS se
  // rendent sur TOUTES les semaines de leur période (miroir ou non, même « Clôturé »)
  // → on itère les dates de leur jour sur la période ; s'y ajoutent les ponctuels
  // autonomes datés. Règle 1 = occurrences RÉSERVABLES : miroirs (comme
  // isSlotClosed, réserver un récurrent ne matérialise que ses miroirs) + ponctuels.
  // Filtres communs « jour ouvert » : jours actifs, fériés, vacances scolaires,
  // parité A/B, capacité configurée (le rendu grise ces dates via isDayDisabled).
  function defaultAnchorMonday(): string {
    const todayMonday = ymd(mondayOf(new Date()));
    const dayOpen = (d: string, dk: string): boolean => {
      const o = openingForYmd(d);
      if (
        !o.activeDays
          .split(",")
          .map((s) => s.trim())
          .includes(dk)
      )
        return false;
      if (!o.openOnHolidays && isFrenchHoliday(d)) return false;
      return o.openOnSchoolHolidays || !isSchoolHoliday(d);
    };
    let nextVisible: string | null = null; // règle 2 : prochaine affichée (≥ lundi courant)
    let lastVisible: string | null = null; // règle 3 : dernière affichée (< lundi courant)
    const noteVisible = (d: string) => {
      if (d >= todayMonday) {
        if (!nextVisible || d < nextVisible) nextVisible = d;
      } else if (!lastVisible || d > lastVisible) {
        lastVisible = d;
      }
    };
    // Récurrents : chaque date de leur jour dans leur période.
    const periodById = new Map(periods.map((p) => [p.id, p]));
    for (const s of slots) {
      const p = s.periodId != null ? periodById.get(s.periodId) : null;
      if (!p?.dateStart || !p.dateEnd) continue;
      if ((s.capacity ?? service.capacity) <= 0) continue;
      const off = s.slotDay != null ? DAY_OFFSET[s.slotDay] : undefined;
      if (off == null) continue;
      let d = ymd(addDays(ymd(mondayOf(new Date(`${p.dateStart}T00:00:00`))), off));
      if (d < p.dateStart) d = ymd(addDays(d, 7));
      for (; d <= p.dateEnd; d = ymd(addDays(d, 7))) {
        if (abMode && !parseWeeks(s.weeks).includes(slotWeekTag(d))) continue;
        if (dayOpen(d, s.slotDay as string)) noteVisible(d);
      }
    }
    // Règle 1 sur les occurrences datées (+ règles 2/3 pour les ponctuels autonomes).
    const bookedBySlot = new Map<string, Booking[]>();
    for (const b of bookings) {
      const arr = bookedBySlot.get(b.slotId);
      if (arr) arr.push(b);
      else bookedBySlot.set(b.slotId, [b]);
    }
    // Places occupées d'un créneau daté, selon sa jauge (même règle que les blocs).
    const usedOn = (slotId: string, jauge: boolean): number => {
      const list = bookedBySlot.get(slotId) ?? [];
      return jauge
        ? list.reduce(
            (sum, b) => sum + gaugeUnits(b.enfants, b.accompagnants, service.gaugeAccompagnants),
            0,
          )
        : list.length;
    };
    let nextBookable: string | null = null; // règle 1 : prochaine occurrence réservable
    for (const u of uniqueSlots) {
      const d = u.slotDate;
      if (!d) continue;
      const parent = u.parentSlotId ? recurSlotById.get(u.parentSlotId) : null;
      if (u.parentSlotId && !parent) continue; // miroir orphelin
      if (!dayOpen(d, dayKeyFromYmd(d))) continue;
      if (parent && abMode && !parseWeeks(parent.weeks).includes(slotWeekTag(d))) continue;
      const capacity = (parent ? parent.capacity : u.capacity) ?? service.capacity;
      if (capacity <= 0) continue;
      // Règles 2/3 : les ponctuels autonomes ne sont couverts que par leur date.
      if (!parent) noteVisible(d);
      // Règle 1 : réservable = délai respecté, période ouverte (Dispo), place restante.
      if (d < earliestFor(d)) continue;
      if (nextBookable && d >= nextBookable) continue; // déjà une occurrence plus proche
      const pid = parent ? parent.periodId : u.periodId;
      const dispo = pid != null ? dispoByPeriod.get(pid) : null;
      if (dispo && todayIso < dispo) continue;
      if (usedOn(u.id, parent ? parent.jauge : u.jauge) >= capacity) continue;
      nextBookable = d;
    }
    const target = nextBookable ?? nextVisible ?? lastVisible;
    return target ? ymd(mondayOf(new Date(`${target}T00:00:00`))) : todayMonday;
  }

  // Restaure la vue (exercice / semaine) depuis sessionStorage au montage, puis la
  // persiste à chaque changement (hook partagé usePersistedAgendaView). À défaut,
  // ancre la semaine via defaultAnchorMonday (prochain créneau réservable, sinon
  // semaine avec créneau la plus proche). Clé PAR UTILISATEUR : sessionStorage est
  // partagé par l'onglet — sans l'e-mail dans la clé, un compte héritait de la vue
  // mémorisée du compte précédent.
  usePersistedAgendaView<{ exerciceId: number | null; anchorMonday: string | null }>({
    storageKey: `agenda-view:${service.id}:${userInfo.email}`,
    restore: (v) => {
      let anchored = false;
      if (v) {
        // Ne restaure l'exercice que s'il existe encore ; un `null` mémorisé (vue
        // enregistrée quand le service n'avait pas d'exercice) est ignoré, sinon il
        // désactiverait le filtre d'exercice (périodes de tous les exercices mélangées).
        if (v.exerciceId != null && exercices.some((e) => e.id === v.exerciceId)) {
          setCurrentExerciceId(v.exerciceId);
        }
        if (typeof v.anchorMonday === "string") {
          setAnchorMonday(v.anchorMonday);
          anchored = true;
        }
      }
      if (!anchored) setAnchorMonday(defaultAnchorMonday());
    },
    snapshot: () => ({ exerciceId: currentExerciceId, anchorMonday }),
    deps: [currentExerciceId, anchorMonday],
  });

  // Verrouille la période active en semaine réelle (hook partagé, cf. agenda-hooks).
  useCoveringPeriodLock(true, coveringPeriod, rwPeriodId, setRwPeriodId);

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

  // Réplique CLIENT de assertReservationLimits (server/services/bookings) : bloque
  // dès le CLIC sur un créneau — au lieu d'un refus à l'enregistrement — quand une
  // limite de réservations de l'exercice est atteinte. Comptage par TYPE, comme le
  // serveur : une création récurrente compte MES récurrentes (période visée, puis
  // exercice entier) ; une ponctuelle compte MES ponctuelles STANDALONE via la
  // période de leur créneau (miroirs/enfants exclus). Le brouillon est intégré
  // (ajouts comptés, suppressions déduites) ; le serveur re-vérifie de toute façon.
  function reservationLimitError(slotId: string, ponctuel: boolean): string | null {
    const targetPeriodId = ponctuel
      ? (uniqSlotById.get(slotId)?.periodId ?? 0)
      : (effectivePeriodId ?? 0);
    if (!targetPeriodId || targetPeriodId <= 0) return null;
    const exoPeriodIds = new Set(periods.map((p) => p.id));
    const removed = new Set(pendingRemovals.map((r) => r.bookingId));
    // Période de chacune de mes réservations existantes du même type.
    const minePeriodIds: number[] = [];
    for (const b of bookings) {
      if (!b.mine || b.parentBookingId !== null || removed.has(b.id)) continue;
      if (ponctuel) {
        if (b.bookingType !== "unique") continue;
        const pid = uniqSlotById.get(b.slotId)?.periodId ?? null;
        if (pid != null && pid > 0) minePeriodIds.push(pid);
      } else {
        if (b.bookingType !== "recurring") continue;
        if (b.periodId > 0) minePeriodIds.push(b.periodId);
      }
    }
    // + les ajouts du brouillon du même type (déjà cochés, pas encore enregistrés).
    for (const a of pendingAdds) {
      if (a.ponctuel !== ponctuel) continue;
      const pid = a.ponctuel ? (uniqSlotById.get(a.slotId)?.periodId ?? 0) : a.periodId;
      if (pid > 0) minePeriodIds.push(pid);
    }
    if (
      minePeriodIds.filter((pid) => pid === targetPeriodId).length >= service.maxReservationsPeriod
    ) {
      return "Limite de réservations atteinte pour cette période.";
    }
    if (minePeriodIds.filter((pid) => exoPeriodIds.has(pid)).length >= service.maxReservations) {
      return "Limite annuelle de réservations atteinte.";
    }
    return null;
  }

  // Coche / décoche un créneau libre pour réservation (sans appel serveur).
  function togglePendingAdd(slotId: string, dayKey: string, ponctuel: boolean) {
    const key = pendKey(slotId, dayKey, ponctuel);
    // Verrou « une seule action » : décocher l'ajout courant reste permis (même clé) ;
    // cocher un AUTRE créneau alors qu'une action est en attente est bloqué.
    if (!guardSingleAction(`add:${key}`)) return;
    // Limites de réservation : contrôle AU CLIC (décocher reste toujours permis).
    if (!pendingAdds.some((a) => a.key === key)) {
      const limitError = reservationLimitError(slotId, ponctuel);
      if (limitError) {
        showToast(limitError, "danger");
        return;
      }
    }
    setPendingAdds((prev) => {
      if (prev.some((a) => a.key === key)) return prev.filter((a) => a.key !== key);
      const time = slotTime(slotId, ponctuel);
      // Récurrent (agenda unifié : réservé depuis la Semaine réelle) → le libellé
      // explicite la RÉCURRENCE : cadence (chaque semaine / 1 sem. sur 2) + période.
      const periodLabel = !ponctuel
        ? (periods.find((p) => p.id === effectivePeriodId)?.label ?? "")
        : "";
      const cadence =
        abMode && effectiveWeek ? `1 semaine sur 2 (sem. ${effectiveWeek})` : "chaque semaine";
      const label = ponctuel
        ? `${ponctuelDateLabel(slotId)} · ${time}`
        : `${DAY_NAMES[dayKey] ?? dayKey} · ${time} · ${cadence}${periodLabel ? ` — ${periodLabel}` : ""}`;
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
  // Cellule (élément .agenda-block, porteur de data-slotid/data-daykey) sous le point
  // écran donné. Sert au hit-test du drag « pointer events » (plus d'onDrop natif).
  function cellAtPoint(x: number, y: number): HTMLElement | null {
    return document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-slotid]") ?? null;
  }
  // Créneau (Block) correspondant à une cellule du hit-test.
  function blockFromCell(cell: HTMLElement): Block | null {
    const slotId = cell.dataset.slotid;
    if (!slotId) return null;
    const dayKey = cell.dataset.daykey ?? "";
    return blocksByDay[dayKey]?.find((bl) => bl.slotId === slotId) ?? null;
  }
  function blockAtPoint(x: number, y: number): Block | null {
    const cell = cellAtPoint(x, y);
    return cell ? blockFromCell(cell) : null;
  }
  // Dépôt sur un créneau : relocalise le brouillon, ou enregistre/annule un déplacement.
  function dropOnBlock(item: DragItem, b: Block) {
    const ponctuel = uniqueIdSet.has(b.slotId);
    if (item.ponctuel !== ponctuel || b.full) return; // sécurité (déjà filtré au dragover)
    const targetPeriodId = ponctuel ? 0 : (effectivePeriodId ?? 0);
    const targetWeek = !ponctuel && abMode ? (effectiveWeek ?? "") : "";
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
  const mobileGoDayRef = useFreshRef(mobileGoDay);
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

  // Surbrillance de la cellule cible en DOM direct (aucun re-render pendant le drag).
  // `isConnected` re-pose la classe si un re-render concurrent (auto-refresh) a
  // remplacé/réécrit l'élément pendant le drag.
  function setDropTargetEl(el: HTMLElement | null) {
    const prev = dropTargetElRef.current;
    if (prev === el && (el == null || el.isConnected)) return;
    if (prev) prev.classList.remove("slot-user-drop-target");
    if (el) el.classList.add("slot-user-drop-target");
    dropTargetElRef.current = el;
  }

  // Drag « pointer events » (souris + tactile) : activation au-delà du seuil → on mémorise
  // l'item ; à chaque déplacement on suit le curseur (ghost), on surligne le créneau cible
  // et on gère le défilement au bord (mobile) ; au relâché on dépose sur le créneau sous le
  // pointeur (sinon annulation). PERF (audit 2026-07-19) : le suivi du pointeur écrit
  // left/top directement sur le ghost et la surbrillance passe par classList — l'ancien
  // setState par pointermove ré-exécutait tout le composant (~2 600 l.) à chaque pixel.
  const pointerDrag = usePointerDrag<DragItem>({
    onActivate: (item) => setDragItem(item),
    onMove: (item, e) => {
      const ghost = dragGhostElRef.current;
      if (ghost) {
        ghost.style.left = `${e.clientX}px`;
        ghost.style.top = `${e.clientY}px`;
      } else {
        // 1er déplacement : monte le ghost à cette position (unique setState du suivi).
        setDragPos({ x: e.clientX, y: e.clientY });
      }
      handleEdgePaging(e.clientX);
      const cell = cellAtPoint(e.clientX, e.clientY);
      const b = cell ? blockFromCell(cell) : null;
      setDropTargetEl(b && canDropItem(item, b) ? cell : null);
    },
    onDrop: (item, e) => {
      stopEdgePaging();
      const b = blockAtPoint(e.clientX, e.clientY);
      if (b && canDropItem(item, b)) dropOnBlock(item, b);
      setDragItem(null);
      setDropTargetEl(null);
      setDragPos(null);
      dragGhostRef.current = null;
    },
    onCancel: () => {
      stopEdgePaging();
      setDragItem(null);
      setDropTargetEl(null);
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
    setPendingUpdates((prev) => ({ ...prev, [bk.id]: { ...myCounts(bk), theme: v } }));
  }

  // Marque / démarque une de MES réservations pour annulation (sans appel serveur).
  function togglePendingRemoval(bk: Booking) {
    // Résa verrouillée (validation bloquante) → annulation impossible.
    if (bookingLocked(bk)) return;
    // Démarquer la suppression courante → brouillon vidé de cette suppression (permis).
    if (pendingRemovals.some((r) => r.bookingId === bk.id)) {
      setPendingRemovals((prev) => prev.filter((r) => r.bookingId !== bk.id));
      return;
    }
    // Supprimer cette résa est permis si le brouillon est vide ou porte déjà sur CE même
    // badge (déplacement/modif du même bookingId) — plusieurs actions sur un même élément.
    // Supprimer une AUTRE résa alors qu'un badge est en cours est bloqué (toast). Au commit,
    // la suppression prime : le déplacement/modif de cette résa est ignoré (cf. commitPending).
    if (!guardSingleAction(`bk:${bk.id}`)) return;
    const time = slotTime(bk.slotId, uniqueIdSet.has(bk.slotId));
    const label = bk.dayKey ? `${DAY_NAMES[bk.dayKey] ?? bk.dayKey} · ${time}` : time;
    setPendingRemovals((prev) => [...prev, { bookingId: bk.id, label }]);
  }

  function clearPending() {
    setPendingAdds([]);
    setPendingRemovals([]);
    setPendingUpdates({});
    setPendingMoves({});
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
  // (Hook partagé avec la grille admin — cf. components/agenda-hooks.) La sonde
  // /api/agenda-version court-circuite le refresh complet quand rien n'a changé.
  useAgendaAutoRefresh(
    autoRefreshSeconds,
    () => pendingCount === 0 && !committing,
    () => startTransition(() => router.refresh()),
    `/api/agenda-version?serviceId=${encodeURIComponent(service.id)}`,
  );

  // « Enregistrer → » : valide le brouillon (crée les ajouts, annule les retraits).
  // Chaque opération RÉUSSIE est retirée du brouillon au fil de l'eau : en cas
  // d'échec au milieu du lot, le panier restant ne contient que ce qui n'a PAS été
  // appliqué — re-cliquer « Enregistrer » ne rejoue plus les annulations déjà
  // faites (« Réservation introuvable ») et le brouillon reste récupérable.
  /**
   * Thème obligatoire : rien ne part tant qu'un thème manque. On refuse AVANT l'appel
   * serveur — qui applique la même règle — pour amener le curseur sur le champ fautif,
   * ce qu'un aller-retour ne permettrait pas : le serveur ne sait pas de quel badge il
   * s'agit, et le brouillon peut en contenir plusieurs.
   *
   * Portée : les ajouts ET les modifications (vider le thème d'une réservation existante
   * revient à la laisser sans thème). Un retrait n'est pas concerné.
   */
  function themeManquant(): string | null {
    if (!modes.themeRequired) return null;
    const removalIds = new Set(pendingRemovals.map((r) => r.bookingId));
    const add = pendingAdds.find((a) => !a.theme.trim());
    if (add) return themeFieldId({ kind: "draft", key: add.key });
    const update = Object.entries(pendingUpdates).find(
      ([id, u]) => !removalIds.has(Number(id)) && !u.theme.trim(),
    );
    return update ? themeFieldId({ kind: "booking", id: Number(update[0]) }) : null;
  }

  function commitPending() {
    const fautif = themeManquant();
    if (fautif) {
      showToast(THEME_REQUIS_MSG, "danger");
      // Deux temps : le badge d'abord amené à l'écran, le focus ensuite — un focus sur
      // un élément hors vue ferait sauter la page sans que l'usager voie quoi.
      const el = document.getElementById(fautif);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      window.setTimeout(() => (el as HTMLElement | null)?.focus(), 120);
      return;
    }
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
        // L'échec est signalé par un toast rouge.
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
  const isSchoolHoliday = (date: string): boolean =>
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
      // NB : PAS de filtre par parité de la semaine AFFICHÉE ici. Les miroirs encodent
      // déjà la cadence réelle du créneau (récurrent « toutes les semaines » → un miroir
      // par semaine ; « Semaines A »/« B » → un miroir sur deux). Filtrer par la semaine
      // A/B courante réduisait de moitié les dates d'un créneau hebdomadaire (affichage
      // « tous les 15 jours » à tort) et rendait l'info-bulle dépendante de la semaine vue.
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
  }, [uniqueSlots, earliestFor, openingForYmd, schoolHolidays]);

  // Dates concrètes couvertes par un créneau récurrent un jour donné (cf. memo ci-dessus).
  // Port _predictedDatesForCurrentUser. Ponctuel autonome : sa seule date.
  const concernedDatesForBlock = (slotId: string, dayKey: string): string[] => {
    const u = uniqSlotById.get(slotId);
    if (u && !u.parentSlotId) return u.slotDate ? [u.slotDate] : [];
    return concernedDatesByKey.get(`${slotId}|${dayKey}`) ?? [];
  };

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
  const blockApiRef = useFreshRef(blockApi);

  // Cache de callbacks STABLES par badge (clé "bk:<id>" ou "add:<key>") : chaque
  // wrapper garde une identité CONSTANTE tandis que sa closure interne (holder.fresh)
  // est rafraîchie à chaque rendu → les props de callback de MineBadge ne changent
  // jamais de référence, donc React.memo ne re-rend QUE le badge dont les primitives
  // ont changé (audit perf 2026-07-19). Sans ça, la mémo serait inopérante (closures
  // recréées). Comportement identique aux anciennes closures inline (mêmes appels).
  const badgeCbsRef = useRef(new Map<string, { holder: { fresh: BadgeCbs }; cbs: BadgeCbs }>());
  const badgeCbs = (key: string, fresh: BadgeCbs): BadgeCbs => {
    let e = badgeCbsRef.current.get(key);
    if (!e) {
      const holder = { fresh };
      e = {
        holder,
        cbs: {
          onClose: () => holder.fresh.onClose(),
          onBump: (f, d) => holder.fresh.onBump(f, d),
          onSetCount: (f, v) => holder.fresh.onSetCount(f, v),
          onSetTheme: (v) => holder.fresh.onSetTheme(v),
          onDragPointerDown: (ev) => holder.fresh.onDragPointerDown(ev),
        },
      };
      badgeCbsRef.current.set(key, e);
    }
    e.holder.fresh = fresh;
    return e.cbs;
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: déps maintenues à la main — les handlers d'événements passent par blockApiRef (hors déps), et les helpers appelés AU RENDU (isSlotClosed/myCounts/slotTime/bookingLocked, recréés à chaque rendu) ont leurs entrées RÉELLES listées en primitives (uniqSlotById, recurSlotById, earliestBookable, concernedDatesByKey, pendingUpdates, service, modes…) → renderBlock se recrée quand elles changent, capturant des helpers frais. pendKey/participantsLabel sont purs.
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
      // Info-bulle « Journées concernées » : créneaux RÉCURRENTS (liste des occurrences
      // à venir, en Modèle COMME en Semaine réelle) ET ponctuels autonomes (leur seule
      // date) — cf. concernedDatesForBlock.
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
          // data-* pour l'info-bulle déléguée « Journées concernées » (tous les blocs :
          // récurrents ET ponctuels autonomes).
          data-slot-tip=""
          data-slotid={b.slotId}
          data-daykey={b.dayKey}
          // 2 couleurs fixes, sans variation selon le remplissage/jauge : vert pour
          // les ponctuels autonomes, jaune (défaut .agenda-block) pour les récurrents
          // et leurs miroirs (cf. légende Récurrent/Ponctuel).
          // (La classe .slot-user-drop-target est posée en DOM direct pendant le drag,
          // cf. setDropTargetEl — plus de dépendance de rendu à la cellule survolée.)
          className={`agenda-block${allday ? " is-allday" : ""}`}
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
          {/* Repère de cadence des créneaux RÉCURRENTS : « Semaine A / Semaine B / Toutes »
              (abrégé). Filigrane en ARRIÈRE-PLAN (centré, sous le contenu), couleur = bordure
              jaune du créneau (--block-color). Décoratif (aria-hidden, pointerEvents none). */}
          {(() => {
            const s = recurSlotById.get(b.slotId);
            if (!s) return null;
            const w = parseWeeks(s.weeks);
            const label = abMode && w.length === 1 ? `Semaine ${w[0]}` : "Toutes";
            return (
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  top: 1,
                  left: 3,
                  // Une seule ligne, bornée à droite + overflow hidden : le libellé ne
                  // déborde pas et ne passe pas à la ligne — la partie qui dépasse est
                  // simplement rognée (pas d'ellipse).
                  right: 3,
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  lineHeight: 1,
                  color: "var(--block-color)",
                  pointerEvents: "none",
                  // Derrière les autres éléments du créneau (contenu en zIndex 1) mais
                  // devant le bloc lui-même (fond/bordure).
                  zIndex: 0,
                }}
              >
                {label}
              </span>
            );
          })()}
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
              // Au-dessus du filigrane de cadence (en arrière-plan, zIndex 0).
              position: "relative",
              zIndex: 1,
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
              // Occurrence ENFANT d'une récurrente → on remonte à la réservation
              // PARENTE : annulation, édition et déplacement portent sur la
              // réservation logique entière (supprimer depuis une occurrence ne
              // doit pas retirer UNE seule séance). Compteurs/état/validation des
              // enfants étant synchronisés sur la parente, l'affichage est inchangé.
              const myBkOcc = b.bookings.find((x) => x.mine);
              const myBk =
                myBkOcc?.parentBookingId != null
                  ? (bookingById.get(myBkOcc.parentBookingId) ?? myBkOcc)
                  : myBkOcc;
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
                    onClose={NOOP}
                    onBump={NOOP}
                    onSetCount={NOOP}
                    onSetTheme={NOOP}
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
                // Callbacks stabilisés par badge (identité constante, closures fraîches) :
                // logique IDENTIQUE aux anciennes closures inline, mais mémo-compatibles.
                const cbs = badgeCbs(`bk:${mb.id}`, {
                  onClose: () => togglePendingRemoval(mb),
                  onBump: (f, d) => bumpMyCount(mb, f, d, remaining),
                  onSetCount: (f, v) => setMyCount(mb, f, v, remaining),
                  onSetTheme: (v) => setMyTheme(mb, v),
                  onDragPointerDown: (e) =>
                    beginDrag({ kind: "booking", bookingId: mb.id, ponctuel: isPonctuelCell }, e),
                });
                return (
                  <MineBadge
                    validated={mb.validated}
                    markedRemoval={markedRemoval}
                    moving={isMoving}
                    gaugeOn={gaugeOn}
                    themeMode={modes.themeMode}
                    themesMode={service.themesMode}
                    themes={themes}
                    themeFieldId={themeFieldId({ kind: "booking", id: mb.id })}
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
                    onClose={cbs.onClose}
                    onBump={cbs.onBump}
                    onSetCount={cbs.onSetCount}
                    onSetTheme={cbs.onSetTheme}
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
                    onDragPointerDown={cbs.onDragPointerDown}
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
                // Infobulle (legacy) : horaire + état brouillon + participants + semaine.
                const tipTime = b.isAllDay ? "Journée entière" : slotTime(b.slotId, isPonctuelCell);
                const tipWeek =
                  abMode && (add.week === "A" || add.week === "B") ? `\nSemaine ${add.week}` : "";
                // Callbacks stabilisés par badge de brouillon (cf. badgeCbs).
                const cbs = badgeCbs(`add:${add.key}`, {
                  onClose: () => setPendingAdds((prev) => prev.filter((a) => a.key !== add.key)),
                  onBump: (f, d) => bumpAddCount(add.key, f, d, remaining),
                  onSetCount: (f, v) => setAddCount(add.key, f, v, remaining),
                  onSetTheme: (v) =>
                    setPendingAdds((prev) =>
                      prev.map((x) => (x.key === add.key ? { ...x, theme: v } : x)),
                    ),
                  onDragPointerDown: (e) =>
                    beginDrag({ kind: "draft", key: add.key, ponctuel: isPonctuelCell }, e),
                });
                return (
                  <MineBadge
                    validated={false}
                    markedRemoval={false}
                    gaugeOn={gaugeOn}
                    themeMode={modes.themeMode}
                    themesMode={service.themesMode}
                    themes={themes}
                    themeFieldId={themeFieldId({ kind: "draft", key: add.key })}
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
                    onClose={cbs.onClose}
                    onBump={cbs.onBump}
                    onSetCount={cbs.onSetCount}
                    onSetTheme={cbs.onSetTheme}
                    // Brouillon : toujours déplaçable (relocalise simplement l'ajout).
                    draggable
                    dragFullSurface={isMobile}
                    // Jauge/thème agrandis aussi sur desktop (« pareil qu'en mobile »).
                    mobile
                    shortSlot={shortSlot}
                    veryShortSlot={veryShortSlot}
                    dragging={dragItem?.kind === "draft" && dragItem.key === add.key}
                    onDragPointerDown={cbs.onDragPointerDown}
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
      uniqueIdSet,
      uniqSlotById,
      recurSlotById,
      earliestFor,
      concernedDatesByKey,
      mapMinToY,
      gridStartMin,
      gridEndMin,
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
            // Position mise à jour en DOM direct par onMove (cf. usePointerDrag) : la ref
            // est la cible des écritures left/top, dragPos ne sert qu'au montage.
            ref={(el) => {
              dragGhostElRef.current = el;
            }}
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
          // Desktop : plus de marge HAUTE non plus — les 2rem dégageaient l'ancienne
          // user-bar flottante en haut à droite, partie vivre en pied de sidebar
          // (2026-08-30) ; l'écran remonte d'autant.
          margin: isMobile ? "0" : "0 0 .75rem",
        }}
      >
        <div className="panel-title res-title" style={{ marginBottom: 0 }}>
          <span className="dot" />
          Réservations
          {/* Exercice en cours : même rendu inline que le titre de l'Agenda admin.
              Masqué sur MOBILE — à 375px, « 2026-2027 » passait sous la nav de
              semaine (l'info reste lisible via les onglets de période dessous). */}
          {currentExerciceId != null && !isMobile && (
            <span className="exercice-nav-inline">
              <span className="ex-nav-label">
                {exercices.find((e) => e.id === currentExerciceId)?.label}
              </span>
            </span>
          )}
        </div>
        {/* Navigation semaine (Semaine réelle) : centrée en absolu sur la ligne de
            titre (desktop). Sur MOBILE, elle reste DANS LE FLUX, calée à droite par
            le space-between — centrée en absolu, elle chevauchait le titre. */}
        <div
          className="periode-nav"
          style={
            isMobile
              ? { margin: 0 }
              : {
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  transform: "translate(-50%, -50%)",
                  // Neutralise la marge asymétrique de .periode-nav qui décalerait le
                  // centrage vertical (sinon la nav n'est pas au même niveau que le titre).
                  margin: 0,
                }
          }
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
              // Flèches rapprochées du libellé (largeur du libellé figée juste
              // au-dessus de la semaine la plus longue).
              gap: ".1rem",
            }}
          >
            <button
              type="button"
              className="ex-arrow"
              style={WEEK_ARROW_STYLE}
              disabled={!canWeekPrev}
              onClick={() => canWeekPrev && shiftWeek(-1)}
            >
              ◂
            </button>
            <span
              className="ex-nav-label"
              // Largeur FIGÉE : les flèches ne bougent plus d'une semaine à l'autre.
              // 6.25rem = 100 px, calibrés sur la semaine la plus large de l'année
              // (« 23 mars ‣ 27 mars », 98,5 px mesurés — mars est le seul mois long
              // que l'abréviation française ne tronque pas). Gabarit HARMONISÉ sur la
              // nav de l'agenda admin.
              style={{ width: "6.25rem", letterSpacing: "-.05em", textAlign: "center" }}
            >
              {mondayStr ? (
                <>
                  {shortDateFmt.format(addDays(mondayStr, firstDayOffset))}
                  {/* Séparateur « ‣ » et non « → » : 4,6 px contre 13,5 px. Grossi (le
                      glyphe est dessiné bien plus petit que la hauteur d'x) et descendu,
                      sans toucher à la hauteur de ligne. */}
                  <span
                    style={{
                      fontSize: "1.35em",
                      lineHeight: 0,
                      position: "relative",
                      top: ".12em",
                    }}
                  >
                    {" ‣ "}
                  </span>
                  {shortDateFmt.format(addDays(mondayStr, lastDayOffset))}
                </>
              ) : (
                "…"
              )}
            </span>
            <button
              type="button"
              className="ex-arrow"
              style={WEEK_ARROW_STYLE}
              disabled={!canWeekNext}
              onClick={() => canWeekNext && shiftWeek(1)}
            >
              ▸
            </button>
            {todayInVisiblePeriods && (
              <button
                type="button"
                className="btn btn-ghost pn-today"
                // Hors flux : positionné à droite de « ◀ label ▶ » sans compter dans sa
                // largeur → seule la nav ◀ label ▶ est centrée par rapport au tableau.
                // Sur MOBILE, la nav est calée au bord droit : « Aujourd'hui » s'ancre
                // à sa GAUCHE (à droite, il sortirait de l'écran).
                style={{
                  padding: ".05rem .45rem",
                  fontSize: ".64rem",
                  position: "absolute",
                  top: "50%",
                  transform: "translateY(-50%)",
                  whiteSpace: "nowrap",
                  ...(isMobile
                    ? { right: "100%", marginRight: ".4rem" }
                    : { left: "100%", marginLeft: ".4rem" }),
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
        {/* Options (case « sans créneau » + impression) : sur la ligne de TITRE,
            poussées au bord droit par marginLeft:auto (l'agenda usager est verrouillé
            en « Semaine réelle », il n'y a plus de sélecteur A/B ici). Masquées sur mobile. */}
        <div
          style={{
            display: isMobile ? "none" : "flex",
            marginLeft: "auto",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: ".5rem",
            // Plafond = la moitié DROITE de la ligne, moins la demi-nav de semaine
            // (centrée en absolu, donc invisible pour le flux) : le libellé tient sur
            // UNE ligne quand la place le permet, et se replie automatiquement sinon
            // au lieu de passer sous la nav.
            maxWidth: "calc(50% - 80px)",
          }}
        >
          <div
            className="planning-options-row"
            style={{ flexDirection: "column", alignItems: "flex-end", gap: 1, lineHeight: 1.1 }}
          >
            <label className="planning-option" style={{ whiteSpace: "normal", textAlign: "right" }}>
              Masquer les horaires sans créneau
              <input
                type="checkbox"
                checked={hideNoSlotPref}
                onChange={(e) => setHideNoSlotPref(e.target.checked)}
              />
            </label>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
            <PrintIconButton
              onClick={printMyBookings}
              tip="Imprimer la liste de mes réservations"
            />
          </div>
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
          {visiblePeriods.map((p) => {
            const active = p.id === coveringPeriod?.id;
            return (
              <button
                key={p.id}
                type="button"
                className={`period-btn ${active ? "active" : ""}`}
                style={{ "--period-color": p.color } as React.CSSProperties}
                onClick={() => {
                  // Onglet choisi = source de vérité : on fige la période ET on ancre
                  // la semaine sur son début (cf. legacy _pickedP).
                  if (p.dateStart) {
                    setRwPeriodId(p.id);
                    setAnchorMonday(ymd(mondayOf(new Date(`${p.dateStart}T00:00:00`))));
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
        {/* (Options « sans créneau » + impression : remontées sur la ligne de titre.) */}
      </div>

      {/* Navigation jour par jour (mobile uniquement) : la grille n'affiche qu'un jour,
          on navigue à travers toute la période. */}
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
            {weekDateByDay[mobileDay] ? ` ${weekDateByDay[mobileDay]}` : ""}
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
        {/* Aucune colonne de jour (semaine hors période) : le squelette de grille n'a
            aucun sens (colonne horaire orpheline) — on affiche un état vide explicite à
            la place (même traitement que l'agenda admin). */}
        {displayDays.length === 0 ? (
          <AgendaEmptyWeekNotice>
            Aucune période ne couvre cette semaine — utilisez les flèches ou les raccourcis de
            période pour rejoindre une semaine couverte.
          </AgendaEmptyWeekNotice>
        ) : (
          <div
            className="agenda-grid is-realweek"
            style={{ gridTemplateColumns: `44px repeat(${displayDays.length}, minmax(0, 1fr))` }}
          >
            <AgendaWeekHeader
              days={displayDays}
              abMode={abMode}
              effectiveWeek={effectiveWeek}
              realweek={true}
              weekDateByDay={weekDateByDay}
              outOfPeriodCls={outOfPeriodCls}
            />

            {/* Bande « Journée entière » : créneaux sans horaire, au-dessus de la
              grille horaire (port du legacy alldayRow). Masquée s'il n'y a aucun
              bloc all-day. Côté usager, on affiche TOUS les créneaux (réservés ou
              vides réservables) : le compactage « sans créneau » ne masque que des
              heures vides, pas les créneaux. */}
            {displayDays.some((d) => dayBlocks(d).some((b) => b.isAllDay)) && (
              <AgendaAllDayRow days={displayDays} outOfPeriodCls={outOfPeriodCls}>
                {(d) => dayBlockEls.allday.get(d)}
              </AgendaAllDayRow>
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
                  const slot = slotAtClientY(
                    e.currentTarget.getBoundingClientRect().top,
                    e.clientY,
                  );
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
        )}
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
              // Libellé unifié « réservation(s) » quel que soit le mode (récurrent ou ponctuel).
              const noun = (n: number) => `réservation${n > 1 ? "s" : ""}`;
              return (
                <>
                  Vous pouvez au maximum demander{" "}
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
        {/* Ligne légende + actions : bloc légende 2×2 à gauche (⏳/récurrent puis
            ✔/ponctuel), bloc actions à droite (boutons du brouillon puis compteur).
            flex-wrap : quand la place manque (smartphone étroit), le bloc actions
            passe EN ENTIER sous la légende, calé à droite — la légende reste un
            bloc 2×2 contigu à toutes les largeurs, même rendu qu'en mode étroit. */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            flexWrap: "wrap",
            width: "100%",
            rowGap: ".4rem",
          }}
        >
          {/* Bloc légende 2×2 : grandit jusqu'à la moitié de la ligne ; plancher
              203px = somme des planchers des 2 colonnes (libellé 106 + légende 90
              + marge .4rem) — le plus étroit possible en .7rem avec l'état sur
              3 lignes max, pour garder les boutons à côté le plus longtemps
              possible (dès 375px). Le max() garde la moitié de ligne prioritaire
              sur les grands écrans. */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              // Interligne resserré entre les 2 lignes du bloc légende.
              gap: ".2rem",
              flex: "1 1 203px",
              maxWidth: "max(50%, 203px)",
              fontSize: ".7rem",
            }}
          >
            {/* 1re ligne du bloc : état « en attente » + légende « récurrent ». */}
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                width: "100%",
              }}
            >
              {/* Largeur fixe commune aux deux lignes de légende : les items « Récurrent »
                et « Ponctuel » qui suivent démarrent sur la même colonne. */}
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: ".45rem",
                  // Moitié du bloc légende, plancher 106px (pastille 34 + espace +
                  // « Demande en » / « attente de » en .7rem : l'état s'étale sur
                  // 3 lignes maximum, pas 4) → les légendes qui suivent démarrent
                  // sur la même colonne ; interligne minimal.
                  width: "50%",
                  minWidth: 106,
                  lineHeight: 0.95,
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
              <AgendaLegendSwatch
                kind="rec"
                style={{
                  marginLeft: ".4rem",
                  letterSpacing: "-0.02em",
                  // Moitié restante du bloc légende (marge déduite), plancher 90px
                  // (pastille 30 + espace + « récurrent » en .7rem) ; repli,
                  // interligne minimal.
                  width: "calc(50% - .4rem)",
                  minWidth: 90,
                  lineHeight: 0.95,
                }}
              >
                Créneau récurrent
              </AgendaLegendSwatch>
            </span>
            {/* 2e ligne du bloc : état « validée » + légende « ponctuel ». */}
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                width: "100%",
              }}
            >
              {/* Même largeur fixe que la ligne « en attente » ci-dessus → colonnes alignées. */}
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: ".45rem",
                  // Moitié du bloc légende, plancher 106px (pastille 34 + espace +
                  // « Demande en » / « attente de » en .7rem : l'état s'étale sur
                  // 3 lignes maximum, pas 4) → les légendes qui suivent démarrent
                  // sur la même colonne ; interligne minimal.
                  width: "50%",
                  minWidth: 106,
                  lineHeight: 0.95,
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
              <AgendaLegendSwatch
                kind="uniq"
                style={{
                  marginLeft: ".4rem",
                  letterSpacing: "-0.02em",
                  // Moitié restante du bloc légende (marge déduite), plancher 90px
                  // (pastille 30 + espace + « récurrent » en .7rem) ; repli,
                  // interligne minimal.
                  width: "calc(50% - .4rem)",
                  minWidth: 90,
                  lineHeight: 0.95,
                }}
              >
                Créneau ponctuel
              </AgendaLegendSwatch>
            </span>
          </div>
          {/* Bloc actions, calé à droite : boutons du brouillon puis compteur.
              Centré verticalement sur la hauteur du bloc légende (sans effet
              quand il se replie dessous : sa ligne fait alors sa hauteur). */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              alignSelf: "center",
              gap: ".4rem",
              marginLeft: "auto",
              // Jamais plus large que la ligne : un compteur long se replie au lieu
              // d'élargir le viewport mobile (l'ancien nowrap tronquait le bord droit).
              maxWidth: "100%",
            }}
          >
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
            {/* Compteur du brouillon (sous les boutons, aligné à droite). En .7rem
                comme la légende : « Aucune modification en attente » reste assez
                court pour laisser le bloc actions à côté de la légende dès 375px. */}
            <p
              style={{
                fontSize: ".7rem",
                color: pendingCount > 0 ? "var(--warn)" : "var(--muted)",
                margin: 0,
                textAlign: "right",
              }}
            >
              {(() => {
                // Ajout en attente → avertissement --danger à la place du compteur :
                // nombre d'occurrences réellement réservées sur la période citée
                // (récurrent : miroirs à venir du créneau parent — la parité A/B est
                // déjà portée par les miroirs ; ponctuel : sa seule date). Le verrou
                // « une seule action » garantit qu'il n'y a rien d'autre à afficher
                // en même temps.
                const add = pendingAdds[0];
                if (add) {
                  const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD local
                  const n = add.ponctuel
                    ? 1
                    : uniqueSlots.filter(
                        (u) => u.parentSlotId === add.slotId && u.slotDate >= today,
                      ).length;
                  // Période citée : celle de l'ajout (récurrent), sinon celle du
                  // créneau ponctuel daté.
                  const periodId = add.ponctuel
                    ? uniqSlotById.get(add.slotId)?.periodId
                    : add.periodId;
                  const periodLabel = periods.find((p) => p.id === periodId)?.label ?? "la période";
                  return (
                    // Message plus long que les compteurs : se replie sur plusieurs
                    // lignes quand la place vient à manquer au lieu de déborder.
                    <span
                      style={{
                        color: "var(--danger)",
                        fontWeight: "bold",
                        whiteSpace: "normal",
                        display: "inline-block",
                        lineHeight: 1.2,
                      }}
                    >
                      Ceci réservera {n} occurrence{n > 1 ? "s" : ""} sur {periodLabel}
                    </span>
                  );
                }
                return pendingCount > 0
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
                  : "Aucune modification en attente";
              })()}
            </p>
          </div>
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
