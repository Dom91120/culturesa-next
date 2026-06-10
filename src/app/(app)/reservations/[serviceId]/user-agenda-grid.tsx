"use client";

import { AgendaTooltip, useAgendaTooltip } from "@/components/agenda-tooltip";
import { earliestBookableISO } from "@/lib/booking-delay";
import { gaugeUnits } from "@/lib/gauge";
import type { ServiceModes } from "@/server/services/service-modes";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  cancelMyBookingAction,
  moveMyBookingAction,
  reservePonctuelAction,
  reserveRecurringAction,
  updateMyBookingAction,
} from "./actions";

type Service = {
  id: string;
  label: string;
  activeDays: string;
  bookingDelay: number;
  morningStart: string;
  morningEnd: string;
  afternoonStart: string;
  afternoonEnd: string;
  capacity: number;
  semaineAb: boolean;
  themesMode: "libre" | "liste";
  maxReservations: number;
  maxReservationsPeriod: number;
  openOnHolidays: boolean;
  gaugeAccompagnants: boolean;
  validationBloquante: boolean;
};
type Period = {
  id: number;
  label: string;
  color: string;
  dateStart: string;
  dateEnd: string;
  exerciceId: number | null;
};
type Exercice = { id: number; label: string };

// Bouton − / + d'un compteur de jauge (sans cercle, remplace les anciennes flèches ▲▼).
// Clic-maintenu : 1er pas immédiat, puis répétition (90 ms) après un délai de 400 ms
// tant que le bouton reste enfoncé. La répétition appelle TOUJOURS le `onClick` courant
// (via une ref) → borne `remaining` et compteurs à jour à chaque tick.
function StepBtn({
  sign,
  color,
  onClick,
}: {
  sign: "+" | "−";
  color: string;
  onClick: () => void;
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
        width: 14,
        height: 16,
        border: "none",
        background: "transparent",
        color,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        // Glyphe collé vers le nombre : « Diminuer » (−) à droite, « Augmenter » (+) à gauche.
        justifyContent: sign === "−" ? "end" : "start",
        fontSize: ".95rem",
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
}: {
  value: string;
  validated: boolean;
  themesMode: "libre" | "liste";
  themes: string[];
  onChange: (v: string) => void;
}) {
  const themeColor = validated ? "#3e7e2f" : "#b2a478";
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
          style={{
            position: "relative",
            fontSize: ".62rem",
            color: themeColor,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            maxWidth: "100%",
            lineHeight: 1,
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 2,
            height: 14,
            padding: "0 2px 0 4px",
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
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
              fontWeight: 700,
            }}
          >
            {value || "— Thème —"}
          </span>
          <span style={{ flexShrink: 0, fontSize: "1rem", color: themeColor, lineHeight: 1 }}>
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
                fontSize: ".62rem",
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
      placeholder="Saisissez un thème"
      value={value}
      rows={1}
      style={{
        color: themeColor,
        WebkitTextFillColor: themeColor,
        fontSize: ".62rem",
        fontWeight: 700,
      }}
      onMouseDown={(e) => e.stopPropagation()}
      // Sans ça, le clic remonte au corps du badge (onBodyClick = action rapide) et
      // empêche d'éditer le thème. stopPropagation → le clic ne fait que focus le champ.
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
  onBodyClick,
  title,
  locked = false,
  draggable = false,
  dragging = false,
  onDragStart,
  onDragEnd,
}: {
  validated: boolean;
  markedRemoval: boolean;
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
  onBodyClick: () => void;
  // Infobulle au survol : horaire + état + participants + semaine.
  title?: string;
  // Validation bloquante : résa validée verrouillée → pas de croix de suppression
  // (port legacy `_blockedDelete` / `noCloseBtn`).
  locked?: boolean;
  // Glisser-déplacer : le badge devient draggable (brouillon / résa « en attente »).
  draggable?: boolean;
  dragging?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
}) {
  // Couleur du texte/éléments : vert foncé si validé (lisible sur le fond vert clair
  // du badge), orange sinon (jamais « inherit »).
  const gColor = validated ? "#3e7e2f" : "#b2a478";
  const stateColor = markedRemoval ? "var(--danger)" : gColor;
  const hasWidgets = gaugeOn || themeMode;
  const editable = gaugeOn && !markedRemoval;
  const icon = validated ? "✔" : "⏳";
  const themeField =
    themeMode && !markedRemoval ? (
      <ThemeField
        value={theme}
        validated={validated}
        themesMode={themesMode}
        themes={themes}
        onChange={onSetTheme}
      />
    ) : null;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: badge (clic corps = action hors édition)
    <div
      className={`user-agenda-mine-badge${hasWidgets ? " has-widgets" : ""} ${
        validated ? "is-validated" : "is-pending"
      }`}
      data-tip={title}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      style={{
        position: "relative",
        top: "auto",
        left: "auto",
        transform: "none",
        width: "100%",
        maxWidth: "100%",
        maxHeight: "none",
        boxShadow: "2px 2px 4px rgba(0, 0, 0, .28)",
        cursor: editable ? "default" : draggable ? "grab" : "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        // Jauge : interligne du badge (entre compteurs / thème / état).
        gap: editable ? 3 : 2,
        textAlign: "center",
        opacity: dragging ? 0.4 : markedRemoval ? 0.55 : 1,
      }}
      onClick={
        editable
          ? (e) => e.stopPropagation()
          : (e) => {
              e.stopPropagation();
              onBodyClick();
            }
      }
    >
      {/* × : supprime la réservation (ou le brouillon) — caché, affiché au survol via CSS.
          Masqué si la résa est verrouillée (validation bloquante). */}
      {!locked && (
        <button
          type="button"
          className="slot-btn-close"
          data-tip={markedRemoval ? "Rétablir" : "Supprimer"}
          aria-label={markedRemoval ? "Rétablir" : "Supprimer"}
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
      {editable ? (
        // Graphique jauge (legacy _createGaugeBadge) : deux colonnes Enfants | icône |
        // Adultes ; chaque compteur = bouton rond − à gauche, nombre, bouton rond + à
        // droite (clic-maintenu), + libellé en dessous.
        <div
          className="gauge-badge"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 0,
            width: "100%",
            cursor: "default",
            paddingTop: 0,
            color: gColor,
          }}
        >
          {/* Colonne Enfants */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              width: "45%",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 0,
              }}
            >
              <StepBtn sign="−" color={gColor} onClick={() => onBump("enfants", -1)} />
              <input
                type="number"
                min={1}
                max={remaining}
                value={enfants}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onChange={(e) => onSetCount("enfants", Number.parseInt(e.target.value, 10))}
                style={{
                  width: "1.4rem",
                  height: "16px",
                  boxSizing: "border-box",
                  textAlign: "center",
                  fontSize: ".85rem",
                  background: "transparent",
                  border: "none",
                  color: gColor,
                  fontWeight: 600,
                  padding: 0,
                  flexShrink: 0,
                }}
              />
              <StepBtn sign="+" color={gColor} onClick={() => onBump("enfants", 1)} />
            </div>
            <span
              className="gauge-txt"
              style={{ color: gColor, fontSize: ".62rem", lineHeight: 1, fontWeight: 700 }}
            >
              {enfants > 1 ? "Enfants" : "Enfant"}
            </span>
          </div>
          {/* Icône d'état */}
          <span
            className="slot-icon"
            style={{
              width: "10%",
              flexShrink: 0,
              display: "flex",
              justifyContent: "center",
              alignSelf: "flex-start",
              ...(validated ? { fontSize: "1.1rem" } : {}),
            }}
          >
            {icon}
          </span>
          {/* Colonne Adultes */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              width: "45%",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 0,
              }}
            >
              <StepBtn sign="−" color={gColor} onClick={() => onBump("accompagnants", -1)} />
              <input
                type="number"
                min={1}
                max={remaining}
                value={accompagnants}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onChange={(e) => onSetCount("accompagnants", Number.parseInt(e.target.value, 10))}
                style={{
                  width: "1.4rem",
                  height: "16px",
                  boxSizing: "border-box",
                  textAlign: "center",
                  fontSize: ".85rem",
                  background: "transparent",
                  border: "none",
                  color: gColor,
                  fontWeight: 600,
                  padding: 0,
                  flexShrink: 0,
                }}
              />
              <StepBtn sign="+" color={gColor} onClick={() => onBump("accompagnants", 1)} />
            </div>
            <span
              className="gauge-txt"
              style={{ color: gColor, fontSize: ".62rem", lineHeight: 1, fontWeight: 700 }}
            >
              {accompagnants > 1 ? "Adultes" : "Adulte"}
            </span>
          </div>
        </div>
      ) : (
        <span
          className="slot-icon"
          style={{
            // Icône d'état des badges non-éditables (validé / en attente / à annuler) : 18×18 px.
            fontSize: 18,
            lineHeight: 1,
            width: 18,
            height: 18,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            // Même couleur de texte que le mode jauge (vert si validé, orange sinon ;
            // rouge si retrait en attente), pour que la coche s'harmonise avec le reste.
            color: stateColor,
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
            fontSize: ".62rem",
            fontWeight: 600,
            lineHeight: 1.3,
            background: "none",
            color: stateColor,
          }}
        >
          {stateLabel}
        </span>
      )}
      {themeField}
    </div>
  );
}

const DAY_OFFSET: Record<string, number> = {
  lun: 0,
  mar: 1,
  mer: 2,
  jeu: 3,
  ven: 4,
  sam: 5,
  dim: 6,
};

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7; // 0 = lundi
  x.setDate(x.getDate() - day);
  return x;
}
function addDays(iso: string, n: number): Date {
  const x = new Date(`${iso}T00:00:00`);
  x.setDate(x.getDate() + n);
  return x;
}
const shortDateFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });

// Ligne « N enfant(s) M adulte(s) » de l'info-bulle au survol (port legacy _badgeTitle).
function participantsLabel(enfants: number, accompagnants: number): string {
  return `${enfants} enfant${enfants > 1 ? "s" : ""} ${accompagnants} adulte${
    accompagnants > 1 ? "s" : ""
  }`;
}

// Calcul de Pâques (algorithme de Gauss/Butcher) — port exact du legacy _easterDate.
function easterDate(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}
// Jour férié français (fixes + lundi de Pâques/Ascension/Pentecôte) — port du legacy
// _isFrenchHoliday. dateStr au format "YYYY-MM-DD".
function isFrenchHoliday(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [year, month, day] = dateStr.split("-").map(Number);
  const fixed = [
    [1, 1],
    [5, 1],
    [5, 8],
    [7, 14],
    [8, 15],
    [11, 1],
    [11, 11],
    [12, 25],
  ];
  if (fixed.some(([m, d]) => m === month && d === day)) return true;
  const e = easterDate(year);
  const fmt = (date: Date) => date.toISOString().slice(0, 10);
  const dayMs = 86400000;
  // Offsets : lundi de Pâques (+1), Ascension (+39), lundi de Pentecôte (+50).
  return [1, 39, 50].some((off) => fmt(new Date(e.getTime() + off * dayMs)) === dateStr);
}

// Clé jour (lun..dim) d'une date "YYYY-MM-DD" — pour projeter un créneau ponctuel
// daté sur la bonne colonne jour de l'agenda (legacy _agendaDayKeyFromYmd).
const YMD_DAY_KEYS = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"];
function dayKeyFromYmd(ymd: string): string {
  return YMD_DAY_KEYS[new Date(`${ymd}T00:00:00`).getDay()] ?? "";
}

// Une date 'YYYY-MM-DD' tombe-t-elle dans une plage de vacances scolaires ?
// Convention data.education.gouv.fr : dateStart = soir du dernier jour d'école →
// 1er jour de vacances = dateStart + 1 (borne gauche stricte, droite incluse).
// Port legacy _isSchoolVacance. Vacances = par demandeur (pas par service), donc
// filtré côté user selon openOnSchoolHolidays du demandeur de l'usager.
function inSchoolHolidayRange(
  date: string,
  ranges: { dateStart: string; dateEnd: string }[],
): boolean {
  return ranges.some((p) => date > p.dateStart && date <= p.dateEnd);
}

/** Numéro de semaine ISO (1..53) — sert à déduire la parité A/B en semaine réelle. */
function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const fdn = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fdn + 3);
  return 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
}
type Slot = {
  id: string;
  startTime: string;
  endTime: string;
  capacity: number | null;
  // Jour de la semaine du créneau récurrent (modèle « un slot = un jour »).
  slotDay: string | null;
  periodId: number | null;
  weeks: string | null;
  // Renseigné uniquement pour les créneaux ponctuels projetés (slots virtuels).
  slotDate?: string | null;
};
// Créneau ponctuel (daté) tel que chargé pour l'agenda.
// parentSlotId non nul = créneau "miroir" (matérialisation d'un récurrent) ; null =
// ponctuel autonome (affiché en vert dans le legacy).
type UniqueSlot = {
  id: string;
  startTime: string;
  endTime: string;
  capacity: number | null;
  slotDate: string;
  parentSlotId: string | null;
};

// Semaines où le créneau "tourne" (port de la colonne weeks). null / "A,B" = toutes.
function parseWeeks(weeks: string | null): ("A" | "B")[] {
  if (!weeks) return ["A", "B"];
  const set = new Set(
    weeks
      .split(",")
      .map((w) => w.trim().toUpperCase())
      .filter((w) => w === "A" || w === "B"),
  );
  return set.size ? (Array.from(set) as ("A" | "B")[]) : ["A", "B"];
}

// Modèle « un slot = un jour » : la capacité d'un jour n'existe que si c'est LE jour
// du créneau (slot.slotDay). Les slots ponctuels projetés portent leur slotDay = jour
// de leur date, ce qui les fait passer ici aussi.
function dayCap(slot: Slot, dayKey: string): number | null {
  return slot.slotDay === dayKey ? slot.capacity : null;
}
type Pointage = "present" | "absent" | null;
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
};
type UserOpt = { id: string; label: string };

const DAY_NAMES: Record<string, string> = {
  lun: "Lundi",
  mar: "Mardi",
  mer: "Mercredi",
  jeu: "Jeudi",
  ven: "Vendredi",
  sam: "Samedi",
  dim: "Dimanche",
};

const ROW_H = 56;

// Feuille de style autonome pour la fenêtre d'impression : ne reprend que les
// classes nécessaires au rendu de la grille agenda (équivalent legacy printAgenda).
const PRINT_CSS = `
  body{font-family:system-ui,Segoe UI,sans-serif;margin:1rem;color:#1a1a1a}
  h1{font-size:1.1rem;margin:0 0 1rem}
  .planning-wrap{position:relative}
  .agenda-grid{display:grid;gap:0;border:1px solid #ccc;border-radius:8px;overflow:hidden;background:#fff}
  .agenda-header-cell{background:#f3f3f3;padding:.4rem .3rem;font-size:.72rem;font-weight:700;text-align:center;border-bottom:1px solid #ccc;border-left:1px solid #ccc;display:flex;flex-direction:column;align-items:center;gap:1px}
  .agenda-corner{border-left:none}
  .agenda-day-sub{font-size:.6rem;color:#666;font-weight:600}
  .agenda-time-col{position:relative;border-right:1px solid #ccc}
  .agenda-time-mark{position:absolute;right:4px;font-size:.6rem;color:#666;transform:translateY(-50%)}
  .agenda-day-col{position:relative;border-left:1px solid #ccc;min-height:40px}
  .agenda-grid-line{position:absolute;left:0;right:0;border-top:1px solid #e2e2e2}
  .agenda-grid-line.is-hour{border-top-color:#bbb}
  .agenda-block{position:absolute;border-radius:6px;padding:2px 4px;overflow:hidden;display:flex;flex-direction:column;gap:2px;font-size:.62rem;background:#f0c14b;border:1px solid #b89020;color:#3a2f00}
  .agenda-block-chips{display:flex;flex-direction:column;gap:1px;overflow:hidden;flex:1}
  .agenda-block-meta{font-size:.58rem;font-weight:700;display:flex;align-items:center;gap:3px}
  .agenda-block-gauge-bar{flex:1;height:4px;border-radius:2px;background:rgba(0,0,0,.15);overflow:hidden;display:inline-block;min-width:24px}
  .agenda-block-gauge-bar>span{display:block;height:100%;background:#b89020}
  .planning-name-tag{display:inline-flex;flex-direction:column;font-size:.62rem;font-weight:700}
  @media print{@page{size:landscape;margin:1cm}}
`;

function toMinutes(t: string, fallback: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return fallback;
  return Number(m[1]) * 60 + Number(m[2]);
}

// Couleurs de base des badges, reprises de `_badgeStyle(bk)` du legacy (app.js) :
// validé = fond vert clair + bordure accent ; en attente = fond orange clair +
// bordure orange. Le texte reste lisible via --badge-text (fallback inline).
function badgeStyle(validated: boolean): React.CSSProperties {
  return validated
    ? {
        background: "#c8e8b8",
        borderColor: "var(--accent)",
        color: "var(--badge-text, #1a1f2e)",
      }
    : {
        background: "#f3dfbb",
        borderColor: "rgba(232, 164, 90, .45)",
        color: "var(--badge-text, #1a1f2e)",
      };
}

// Pastille de pointage P (présent, vert) / A (absent, rouge) affichée en haut à
// droite du badge, reprise du legacy `_badgeIndicators` (classes .indic_p /
// .indic_a). Le pointage n'existe que sur les réservations ponctuelles datées,
// donc cette pastille n'apparaît qu'en « Semaine réelle ». Le badge parent doit
// être `position: relative` pour l'ancrer.
function PointagePill({ pointage }: { pointage: Pointage }) {
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

// Bloc = UN créneau (slot) un jour donné, regroupant toutes ses réservations.
type Block = {
  slotId: string;
  dayKey: string;
  bookings: Booking[];
  // Minutes brutes du créneau : top/height (px) sont dérivés AU RENDU via mapMinToY
  // (qui dépend du compactage pause/hideNoSlot, recalculé hors useMemo).
  startMin: number;
  endMin: number;
  leftPct: number;
  widthPct: number;
  used: number;
  capacity: number;
  full: boolean;
  // Créneau « journée entière » (sans horaire) : rendu dans la bande dédiée en
  // haut de l'agenda, pas sur la grille horaire (cf. legacy alldayBlocks).
  isAllDay: boolean;
};

// Port de `_agendaLayoutOverlaps` (app.js) : pour les créneaux d'une même colonne
// jour qui se chevauchent dans le temps, calcule le nombre de colonnes et l'index
// de chacun → permet de les juxtaposer horizontalement (sinon pleine largeur).
type LayoutItem = { startMin: number; endMin: number; col: number; colCount: number };
function layoutOverlaps(items: LayoutItem[]): void {
  if (!items.length) return;
  items.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  let cluster: LayoutItem[] = [];
  let clusterMaxEnd = Number.NEGATIVE_INFINITY;
  const flush = () => {
    const n = Math.max(1, ...cluster.map((b) => b.col + 1));
    for (const b of cluster) b.colCount = n;
    cluster = [];
    clusterMaxEnd = Number.NEGATIVE_INFINITY;
  };
  for (const b of items) {
    if (b.startMin >= clusterMaxEnd) flush();
    const activeCols = new Set(cluster.filter((x) => x.endMin > b.startMin).map((x) => x.col));
    let col = 0;
    while (activeCols.has(col)) col++;
    b.col = col;
    cluster.push(b);
    clusterMaxEnd = Math.max(clusterMaxEnd, b.endMin);
  }
  flush();
}

type Detail = { booking: Booking } | null;
type CreateCtx = {
  dayKey: string;
  slotId: string;
  // Créneau ponctuel : réservation ponctuelle (pas de période / jour) + date affichée.
  ponctuel?: boolean;
  slotDate?: string;
} | null;

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
  showPrevious,
  demandeurLabel,
  openOnSchoolHolidays,
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
  showPrevious: boolean;
  demandeurLabel: string | null;
  // Demandeur de l'usager ouvert pendant les vacances scolaires (filtre des dates prédites).
  openOnSchoolHolidays: boolean;
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
  // période » ; non-récurrent (ponctuel) → « Semaine réelle » (dates).
  const [mode, setMode] = useState<"model" | "realweek">(
    modes.recurringMode ? "model" : "realweek",
  );
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
  const [validation, setValidation] = useState(false);
  const [pointageMode, setPointageMode] = useState(false);
  const [detail, setDetail] = useState<Detail>(null);
  // Modale "pile" : liste des réservations d'un créneau (clé slot+jour, recalculée
  // en direct depuis blocksByDay pour rester à jour après un refresh).
  const [stackKey, setStackKey] = useState<{ slotId: string; dayKey: string } | null>(null);
  // Glisser-déplacer : élément en cours de drag + clé "dayKey|slotId" du créneau survolé
  // (drop target en surbrillance). Remplace l'ancien `draggingId`.
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  // Brouillon de réservations (ajouts), d'annulations, de modifications de compteurs/thème,
  // et de déplacements sur mes réservations existantes (legacy : tout est éditable).
  const [pendingAdds, setPendingAdds] = useState<PendingAdd[]>([]);
  const [pendingRemovals, setPendingRemovals] = useState<PendingRemoval[]>([]);
  const [pendingUpdates, setPendingUpdates] = useState<
    Record<number, { enfants: number; accompagnants: number; theme: string }>
  >({});
  const [pendingMoves, setPendingMoves] = useState<Record<number, PendingMove>>({});
  const [recapOpen, setRecapOpen] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  // Info-bulle flottante unique (texte data-tip / « Journées concernées »), factorisée
  // dans un hook partagé. Suspendue pendant la saisie d'un thème.
  const { tip, tipRef, onAgendaTip, clearTip } = useAgendaTooltip({
    getDates: (slotId, dayKey) => concernedDatesForBlock(slotId, dayKey),
    suppressed: () => isThemeBeingEdited(),
  });

  const days = service.activeDays
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);

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
  const displayDays = isMobile && mobileDay ? [mobileDay] : days;
  // Compactage « sans créneau » : valeur effective. Sur mobile, toujours désactivé (la
  // case est masquée et n'est donc pas modifiable) → on affiche toute la plage horaire.
  const hideNoSlot = isMobile ? false : hideNoSlotPref;

  // Bornes de la grille = amplitude des plages d'ouverture RÉELLEMENT ouvertes.
  // Une plage « fermée » (fin ≤ début, p.ex. 00:00–00:00) est ignorée — sinon
  // afternoonEnd=00:00 ramenait la fin de grille à minuit et masquait toute la grille.
  const openRanges = (
    [
      [toMinutes(service.morningStart, 9 * 60), toMinutes(service.morningEnd, 12 * 60)],
      [toMinutes(service.afternoonStart, 14 * 60), toMinutes(service.afternoonEnd, 18 * 60)],
    ] as const
  ).filter(([s, e]) => e > s);
  const startMin = openRanges.length ? Math.min(...openRanges.map((r) => r[0])) : 9 * 60;
  const endMin = openRanges.length ? Math.max(...openRanges.map((r) => r[1])) : 18 * 60;
  const baseFirst = Math.floor(startMin / 60);
  const baseLast = Math.ceil(endMin / 60);

  // Périodes visibles = celles de l'exercice courant (toutes si aucun exercice).
  const visiblePeriods =
    currentExerciceId == null ? periods : periods.filter((p) => p.exerciceId === currentExerciceId);
  const selectedPeriodId = visiblePeriods[periodIdx]?.id ?? null;

  // Navigation entre exercices (◀ label ▶).
  const exIdx = exercices.findIndex((e) => e.id === currentExerciceId);
  const exLabel = exIdx >= 0 ? exercices[exIdx].label : "—";
  const canExPrev = exIdx > 0 && showPrevious;
  const canExNext = exIdx >= 0 && exIdx < exercices.length - 1;
  function gotoExercice(id: number) {
    setCurrentExerciceId(id);
    setPeriodIdx(0);
  }

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
  // un créneau et (dés)activer ◀/▶. Trié croissant.
  const uniqSlotDates = uniqueSlots
    .filter((s) => !s.parentSlotId && s.slotDate && (s.capacity ?? service.capacity) > 0)
    .map((s) => s.slotDate as string)
    .sort();
  // Parités A/B couvertes par les créneaux RÉCURRENTS de chaque période (un créneau
  // « A,B » couvre les deux). Les récurrents se répètent chaque semaine de la période →
  // une semaine porte un créneau si sa parité y figure (ou hors mode A/B).
  const recurSlotAbByPeriod = new Map<number, Set<"A" | "B">>();
  for (const s of slots) {
    if (s.periodId == null || s.periodId <= 0) continue;
    if ((s.capacity ?? service.capacity) <= 0) continue;
    const set = recurSlotAbByPeriod.get(s.periodId) ?? new Set<"A" | "B">();
    for (const w of parseWeeks(s.weeks)) set.add(w);
    recurSlotAbByPeriod.set(s.periodId, set);
  }

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
    const parity: "A" | "B" = isoWeek(new Date(`${monday}T00:00:00`)) % 2 === 1 ? "A" : "B";
    return ab.has(parity);
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
  const canWeekPrev = mondayStr
    ? (coveringPeriod?.dateStart
        ? ymd(addDays(mondayStr, -1)) >= coveringPeriod.dateStart
        : true) &&
      (!hideNoSlot || hasSlotWeekBeyond(mondayStr, -1))
    : false;
  const canWeekNext = mondayStr
    ? (coveringPeriod?.dateEnd ? ymd(addDays(mondayStr, 7)) <= coveringPeriod.dateEnd : true) &&
      (!hideNoSlot || hasSlotWeekBeyond(mondayStr, 1))
    : false;

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
  const weekDateByDay: Record<string, string> = {};
  if (mondayStr) {
    for (const d of days)
      weekDateByDay[d] = shortDateFmt.format(addDays(mondayStr, DAY_OFFSET[d] ?? 0));
  }
  // Jour fermé : uniquement en semaine réelle, pour un jour hors de la période
  // active, OU férié quand le service ferme les fériés, OU en vacances scolaires
  // quand le demandeur de l'usager ferme pendant les vacances. Contrairement au
  // legacy (grisage purement visuel), on bloque ici aussi toutes les interactions
  // → l'usager ne peut pas réserver ce jour-là (créneau miroir inclus).
  const isDayDisabled = (dayKey: string): boolean => {
    if (mode !== "realweek" || !mondayStr) return false;
    const dayYmd = ymd(addDays(mondayStr, DAY_OFFSET[dayKey] ?? 0));
    if (
      coveringPeriod?.dateStart &&
      coveringPeriod.dateEnd &&
      (dayYmd < coveringPeriod.dateStart || dayYmd > coveringPeriod.dateEnd)
    ) {
      return true;
    }
    if (!service.openOnHolidays && isFrenchHoliday(dayYmd)) return true;
    // Vacances scolaires : fermé pour un demandeur fermé pendant les vacances.
    return !openOnSchoolHolidays && inSchoolHolidayRange(dayYmd, schoolHolidays ?? []);
  };
  // Jour férié français (service fermé les fériés), en semaine réelle.
  const isHolidayDay = (dayKey: string): boolean => {
    if (mode !== "realweek" || !mondayStr || service.openOnHolidays) return false;
    return isFrenchHoliday(ymd(addDays(mondayStr, DAY_OFFSET[dayKey] ?? 0)));
  };
  // Classe de grisage : jour férié → hachis de la pause méridienne (is-holiday) ;
  // hors période / vacances scolaires → hachis dédié (is-out-of-period).
  const outOfPeriodCls = (dayKey: string): string => {
    if (!isDayDisabled(dayKey)) return "";
    return isHolidayDay(dayKey) ? " is-holiday" : " is-out-of-period";
  };

  // ── Semaines A/B ── (dérivé de la matrice demandeurs, pas de la colonne service)
  const abMode = modes.abMode;
  const realWeekParity: "A" | "B" | null = mondayStr
    ? isoWeek(new Date(`${mondayStr}T00:00:00`)) % 2 === 1
      ? "A"
      : "B"
    : null;
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
  const QUARTER_H = ROW_H / 4; // px par tranche de 15 min

  // Ids des créneaux ponctuels AUTONOMES (non miroirs) : affichés en vert et en
  // lecture seule (on neutralise la création/déplacement de résa récurrente dessus ;
  // la réservation ponctuelle relève d'un autre flux).
  const uniqueIdSet = useMemo(
    () => new Set(uniqueSlots.filter((s) => !s.parentSlotId).map((s) => s.id)),
    [uniqueSlots],
  );
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
  const lunchStart = toMinutes(service.morningEnd, Number.NaN);
  const lunchEnd = toMinutes(service.afternoonStart, Number.NaN);
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
  const occupiedQ = new Set<number>();
  if (hideNoSlot) {
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
        if (q >= gridStartMin && q < gridEndMin) occupiedQ.add(q);
      }
    }
  }

  // Liste ordonnée des quarts d'heure visibles (minutes) : pause méridienne compactée
  // et, si hideNoSlot, quarts sans créneau sautés.
  const quarters: number[] = [];
  for (let m = gridStartMin; m < gridEndMin; m += 15) {
    if (hideNoSlot && !occupiedQ.has(m)) continue;
    if (lunchSkipFrom !== null && m >= lunchSkipFrom && m < lunchEnd) continue;
    quarters.push(m);
  }
  const qIdx = new Map<number, number>();
  quarters.forEach((m, i) => qIdx.set(m, i));
  const totalH = quarters.length * QUARTER_H;
  // mapMinToY : minute réelle → y (px), linéaire intra-quart, basé sur les quarts
  // visibles (gère le compactage de la pause). Cf. legacy mapMinToY.
  const mapMinToY = (min: number): number => {
    const q = Math.floor(min / 15) * 15;
    const offset = (min - q) / 15; // 0..1
    const idx = qIdx.get(q);
    if (idx !== undefined) return (idx + offset) * QUARTER_H;
    // Quart non visible (dans la pause compactée) : on colle au dernier quart visible amont.
    let prev = -1;
    for (const qv of quarters) {
      if (qv >= q) break;
      const i = qIdx.get(qv);
      if (i !== undefined) prev = i;
    }
    return (prev + 1) * QUARTER_H;
  };
  // Inverse de mapMinToY pour le clic (y → minute). Trouve le quart visible sous y.
  const yToMin = (y: number): number => {
    const idx = Math.floor(y / QUARTER_H);
    const clamped = Math.max(0, Math.min(quarters.length - 1, idx));
    const base = quarters[clamped] ?? gridStartMin;
    const offset = y - clamped * QUARTER_H; // px dans le quart
    return base + (offset / QUARTER_H) * 15;
  };

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
        const u = uniqueSlots.find((s) => s.id === b.slotId);
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
      // Places occupées (même règle que l'agenda admin) : en mode jauge = enfants +
      // adultes (accompagnants) ; hors jauge = 1 par réservation.
      const used =
        modes.gaugeRec || modes.gaugePonct
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
    modes.gaugeRec,
    modes.gaugePonct,
  ]);

  // Blocs affichés pour un jour : AUCUN sur un jour fermé (hors période active,
  // vacances scolaires ou férié) — sinon les créneaux/réservations de la période
  // couvrante débordent sur un jour appartenant à une autre période (semaine à
  // cheval), un jour de vacances, ou un férié.
  const dayBlocks = (d: string): Block[] => (isDayDisabled(d) ? [] : (blocksByDay[d] ?? []));

  function run(p: Promise<unknown>) {
    setDetail(null);
    startTransition(async () => {
      await p;
      router.refresh();
    });
  }

  // "Mode validation" et "Mode pointage" sont mutuellement exclusifs (comme legacy).
  function toggleValidation(on: boolean) {
    setValidation(on);
    if (on) setPointageMode(false);
  }
  function togglePointageMode(on: boolean) {
    setPointageMode(on);
    if (on) setValidation(false);
  }

  // Validation bloquante (port legacy `_blockedDelete = validationMode && validated &&
  // validationBloquante`) : une résa VALIDÉE est verrouillée quand le service a
  // `validationBloquante` ET que le demandeur de l'usager est en mode validation.
  function bookingLocked(bk: { validated: boolean }): boolean {
    return service.validationBloquante && modes.validationMode && bk.validated;
  }

  // Agenda USAGER : clic sur une réservation. Si c'est la mienne → annulation ;
  // sinon (réservation d'autrui, anonyme) → aucune action. La réservation d'un
  // créneau libre passe par la modale de confirmation (openCreate → submitCreate).
  function onBlockQuickAction(bk: Booking): boolean {
    // Résa verrouillée (validation bloquante) → aucune action.
    if (bookingLocked(bk)) return true;
    // Clic sur MA réservation → la marque (ou démarque) pour annulation (brouillon).
    if (bk.mine) {
      togglePendingRemoval(bk);
      return true;
    }
    return true;
  }

  // Impression N&B (bw=true) ou couleur : ouvre une fenêtre dédiée avec la seule grille.
  function printAgenda(bw: boolean) {
    if (typeof window === "undefined") return;
    const grid = document.getElementById("agenda-print-grid");
    if (!grid) {
      window.alert("Rien à imprimer.");
      return;
    }
    const titleParts = [service.label];
    if (mode === "model") {
      const p = periods[periodIdx];
      if (p) titleParts.push(p.label);
    } else if (mondayStr) {
      titleParts.push(
        `${shortDateFmt.format(addDays(mondayStr, 0))} → ${shortDateFmt.format(addDays(mondayStr, 6))}`,
      );
    }
    const titleStr = titleParts.filter(Boolean).join(" — ") || "Réservations";
    const clone = grid.cloneNode(true) as HTMLElement;
    for (const n of clone.querySelectorAll(".agenda-empty-overlay")) n.remove();
    const win = window.open("", "_blank", "width=1100,height=800");
    if (!win) {
      window.alert("Veuillez autoriser les pop-ups pour imprimer.");
      return;
    }
    const bwCss = bw
      ? "*{color:#000 !important;background:#fff !important;border-color:#999 !important}.agenda-block,.planning-name-tag{border:1px solid #333 !important}"
      : "";
    win.document.write(
      `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>${titleStr}</title><style>${PRINT_CSS}${bwCss}</style></head><body><h1>${titleStr}</h1>${clone.outerHTML}</body></html>`,
    );
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
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
        // Ne restaure l'exercice que s'il existe encore (sinon défaut).
        if (v.exerciceId == null || exercices.some((e) => e.id === v.exerciceId)) {
          if (v.exerciceId !== undefined) setCurrentExerciceId(v.exerciceId);
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

  // Le mode pointage n'a de sens qu'en semaine réelle : on le désactive si on
  // repasse en "modèle de période" (cohérent avec le legacy).
  useEffect(() => {
    if (mode !== "realweek" && pointageMode) setPointageMode(false);
  }, [mode, pointageMode]);

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
  function pendKey(slotId: string, dayKey: string, ponctuel: boolean) {
    return ponctuel ? `u:${slotId}` : `r:${slotId}|${dayKey}`;
  }
  function slotTime(slotId: string, ponctuel: boolean) {
    const s = ponctuel
      ? uniqueSlots.find((x) => x.id === slotId)
      : slots.find((x) => x.id === slotId);
    return s ? `${s.startTime}–${s.endTime}` : "";
  }
  function ponctuelDateLabel(slotId: string) {
    const u = uniqueSlots.find((x) => x.id === slotId);
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
  // Un bloc accepte-t-il le dépôt de l'élément en cours de drag ? Cible LIBRE et de
  // MÊME type (récurrent↔récurrent, ponctuel↔ponctuel) — cf. décision produit.
  function canDropOn(b: Block): boolean {
    return dragItem != null && !b.full && dragItem.ponctuel === uniqueIdSet.has(b.slotId);
  }
  // Dépôt sur un créneau : relocalise le brouillon, ou enregistre/annule un déplacement.
  function dropOnBlock(b: Block) {
    const item = dragItem;
    setDragItem(null);
    setDropKey(null);
    if (!item) return;
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
      setPendingMoves((prev) => {
        if (!(item.bookingId in prev)) return prev;
        const next = { ...prev };
        delete next[item.bookingId];
        return next;
      });
      return;
    }
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
    setCommitError(null);
    setPendingUpdates((prev) => ({ ...prev, [bk.id]: { ...myCounts(bk), theme: v } }));
  }

  // Marque / démarque une de MES réservations pour annulation (sans appel serveur).
  function togglePendingRemoval(bk: Booking) {
    // Résa verrouillée (validation bloquante) → annulation impossible.
    if (bookingLocked(bk)) return;
    setCommitError(null);
    // Supprimer une réservation annule un éventuel déplacement en attente (sinon le
    // commit échouerait : suppression puis déplacement d'une résa déjà supprimée).
    setPendingMoves((prev) => {
      if (!(bk.id in prev)) return prev;
      const next = { ...prev };
      delete next[bk.id];
      return next;
    });
    setPendingRemovals((prev) => {
      if (prev.some((r) => r.bookingId === bk.id)) return prev.filter((r) => r.bookingId !== bk.id);
      const time = slotTime(bk.slotId, uniqueIdSet.has(bk.slotId));
      const label = bk.dayKey ? `${DAY_NAMES[bk.dayKey] ?? bk.dayKey} · ${time}` : time;
      return [...prev, { bookingId: bk.id, label }];
    });
  }

  function clearPending() {
    setPendingAdds([]);
    setPendingRemovals([]);
    setPendingUpdates({});
    setPendingMoves({});
    setCommitError(null);
    setRecapOpen(false);
  }

  const pendingCount =
    pendingAdds.length +
    pendingRemovals.length +
    Object.keys(pendingUpdates).length +
    Object.keys(pendingMoves).length;
  // Le brouillon ne contient QUE des suppressions (aucun ajout / modif / déplacement)
  // → le bouton d'enregistrement devient « Supprimer → ».
  const onlyRemovals =
    pendingRemovals.length > 0 &&
    pendingAdds.length === 0 &&
    Object.keys(pendingUpdates).length === 0 &&
    Object.keys(pendingMoves).length === 0;

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
  function commitPending() {
    setCommitting(true);
    setCommitError(null);
    startTransition(async () => {
      try {
        // Ordre : suppressions (libèrent des places) → modifications → déplacements
        // (capacité revérifiée côté serveur) → nouvelles réservations.
        for (const r of pendingRemovals) {
          const res = await cancelMyBookingAction(service.id, r.bookingId);
          if (!res.ok) throw new Error(res.error ?? "Échec d'une annulation.");
        }
        for (const [id, u] of Object.entries(pendingUpdates)) {
          await updateMyBookingAction(service.id, Number(id), u.enfants, u.accompagnants, u.theme);
        }
        for (const [id, m] of Object.entries(pendingMoves)) {
          const res = await moveMyBookingAction(service.id, Number(id), {
            slotId: m.slotId,
            ponctuel: m.ponctuel,
            periodId: m.periodId,
            week: m.week,
          });
          if (!res.ok) throw new Error(res.error ?? "Échec d'un déplacement.");
        }
        for (const a of pendingAdds) {
          const res = a.ponctuel
            ? await reservePonctuelAction(service.id, a.slotId, a.theme, a.enfants, a.accompagnants)
            : await reserveRecurringAction(
                service.id,
                a.slotId,
                a.periodId,
                a.week,
                a.theme,
                a.enfants,
                a.accompagnants,
              );
          if (!res.ok) throw new Error(res.error ?? "Échec d'une réservation.");
        }
        setCommitting(false);
        clearPending();
        router.refresh();
      } catch (e) {
        setCommitting(false);
        setCommitError(e instanceof Error ? e.message : "Échec de l'enregistrement.");
      }
    });
  }

  // Bloc de la pile ouverte, recalculé en direct (reste à jour après refresh ;
  // se referme tout seul si le créneau n'a plus de réservation).
  const stackBlock = stackKey
    ? (blocksByDay[stackKey.dayKey]?.find((bl) => bl.slotId === stackKey.slotId) ?? null)
    : null;
  const stackSlot = stackKey
    ? (slots.find((s) => s.id === stackKey.slotId) ??
      uniqueSlots.find((s) => s.id === stackKey.slotId) ??
      null)
    : null;

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
  const earliestBookable = earliestBookableISO(
    service.bookingDelay,
    service.activeDays
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const concernedDatesForBlock = (slotId: string, dayKey: string): string[] => {
    const dates = uniqueSlots
      .filter(
        (u) => u.parentSlotId === slotId && u.slotDate && dayKeyFromYmd(u.slotDate) === dayKey,
      )
      .map((u) => u.slotDate as string)
      .filter((d) => {
        // Délai de réservation : occurrences ≥ aujourd'hui + délai seulement.
        if (d < earliestBookable) return false;
        if (!abMode || effectiveWeek == null) return true;
        // Convention UNIQUE de l'app : semaine ISO IMPAIRE = A, paire = B (cf.
        // realWeekParity / slotWeekTag). effectiveWeek est dans cette même convention.
        const parity: "A" | "B" = isoWeek(new Date(`${d}T00:00:00`)) % 2 === 1 ? "A" : "B";
        return parity === effectiveWeek;
      })
      .sort();
    return openOnSchoolHolidays ? dates : dates.filter((d) => !isSchoolVacance(d));
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

  const renderBlock = (b: Block, allday: boolean) => {
    // Info-bulle « Journées concernées » : créneaux RÉCURRENTS en vue Modèle de période
    // uniquement (en Semaine réelle, les dates sont déjà visibles → inutile).
    const isRecurringModel = mode === "model" && !uniqueIdSet.has(b.slotId);
    const posStyle: React.CSSProperties = allday
      ? {}
      : (() => {
          // top/height dérivés des minutes via mapMinToY (compactage pause).
          // Bornage à la plage visible + 2px de gap haut/bas (cf. legacy).
          const ys = mapMinToY(Math.max(b.startMin, gridStartMin));
          const ye = mapMinToY(Math.min(b.endMin, gridEndMin));
          return {
            top: ys + 2,
            height: Math.max(28, ye - ys - 4),
            left: `calc(${b.leftPct}% + 2px)`,
            width: `calc(${b.widthPct}% - 4px)`,
          };
        })();
    return (
      // biome-ignore lint/a11y/useKeyWithClickEvents: bloc-créneau agenda (clic = créer)
      <div
        key={`${b.dayKey}|${b.slotId}`}
        // data-* pour l'info-bulle déléguée « Journées concernées » (créneau récurrent).
        data-slot-tip={isRecurringModel ? "" : undefined}
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
        }}
        onClick={(e) => {
          // Clic sur un créneau → coche/décoche pour réservation (brouillon).
          // (Si c'est ma résa, le badge interne gère l'annulation et stoppe la propagation.)
          e.stopPropagation();
          if (b.full) return;
          const ponctuel = uniqueIdSet.has(b.slotId);
          if (!ponctuel && (effectivePeriodId == null || effectivePeriodId <= 0)) return;
          togglePendingAdd(b.slotId, b.dayKey, ponctuel);
        }}
        onDragOver={(e) => {
          // Cible de dépôt valide (libre + même type) → autorise le drop.
          if (canDropOn(b)) e.preventDefault();
        }}
        onDragEnter={(e) => {
          if (canDropOn(b)) {
            e.preventDefault();
            setDropKey(`${b.dayKey}|${b.slotId}`);
          }
        }}
        onDragLeave={(e) => {
          // Retire la surbrillance uniquement en quittant réellement le bloc.
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDropKey((k) => (k === `${b.dayKey}|${b.slotId}` ? null : k));
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          dropOnBlock(b);
        }}
      >
        {/* Badges centrés via le parent .agenda-block (justify-content:center).
          Le chips ne grandit pas pour que le centrage opère ; la jauge est
          sortie du flux (position absolue en bas). */}
        <div
          className="agenda-block-chips"
          style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", gap: 2 }}
        >
          {(() => {
            // Agenda usager : MA réservation → badge ✅/⏳ (clic = annuler) ;
            // sinon complet → « Complet » ; sinon créneau libre → repère « + »
            // (clic sur le bloc = réserver). On n'affiche jamais les autres réservants.
            const isPonctuelCell = uniqueIdSet.has(b.slotId);
            // L'usager n'a qu'UN demandeur : sa jauge est active dès que gaugeRec OU
            // gaugePonct l'est (peu importe le type du créneau cliqué).
            const gaugeOn = modes.gaugeRec || modes.gaugePonct;
            // Badge sans thème NI jauge : on affiche toujours l'état (Validé / En attente).
            const noWidgets = !modes.themeMode && !gaugeOn;
            const myBk = b.bookings.find((x) => x.mine);
            // Brouillon : ma résa marquée pour annulation, ou créneau libre coché.
            const markedRemoval = myBk
              ? pendingRemovals.some((r) => r.bookingId === myBk.id)
              : false;
            const pendingSel =
              !myBk &&
              pendingAdds.some((a) => a.key === pendKey(b.slotId, b.dayKey, isPonctuelCell));
            if (myBk) {
              const mb = myBk;
              const cur = myCounts(mb);
              // Sans thème ni jauge → on affiche l'état (Validé / En attente). Avec un
              // thème OU une jauge, l'état est porté par l'icône ✔/⏳ → pas de libellé
              // (sauf « À supprimer » pour un retrait en attente).
              const stateLabel = markedRemoval
                ? "À supprimer"
                : noWidgets
                  ? mb.validated
                    ? "Validé"
                    : "En attente de validation"
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
                ? "🗑️ À supprimer"
                : mb.validated
                  ? "✅ Réservé (validé)"
                  : "⏳ Réservé (en attente)";
              const tipWeek =
                abMode && (mb.week === "A" || mb.week === "B") ? `\nSemaine ${mb.week}` : "";
              return (
                <MineBadge
                  validated={mb.validated}
                  markedRemoval={markedRemoval}
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
                  closeIcon={markedRemoval ? "↺" : "×"}
                  locked={bookingLocked(mb)}
                  onClose={() => togglePendingRemoval(mb)}
                  onBump={(f, d) => bumpMyCount(mb, f, d, remaining)}
                  onSetCount={(f, v) => setMyCount(mb, f, v, remaining)}
                  onSetTheme={(v) => setMyTheme(mb, v)}
                  onBodyClick={() => onBlockQuickAction(mb)}
                  // Seules les réservations « en attente » (non validées, non marquées
                  // pour suppression) sont déplaçables par glisser-déposer.
                  draggable={!mb.validated && !markedRemoval}
                  dragging={dragItem?.kind === "booking" && dragItem.bookingId === mb.id}
                  onDragStart={(e) => {
                    setDragItem({ kind: "booking", bookingId: mb.id, ponctuel: isPonctuelCell });
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", String(mb.id));
                  }}
                  onDragEnd={() => {
                    setDragItem(null);
                    setDropKey(null);
                  }}
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
                  stateLabel={noWidgets ? "En attente de validation" : ""}
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
                  onBodyClick={removeDraft}
                  // Brouillon : toujours déplaçable (relocalise simplement l'ajout).
                  draggable
                  dragging={dragItem?.kind === "draft" && dragItem.key === add.key}
                  onDragStart={(e) => {
                    setDragItem({ kind: "draft", key: add.key, ponctuel: isPonctuelCell });
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", add.key);
                  }}
                  onDragEnd={() => {
                    setDragItem(null);
                    setDropKey(null);
                  }}
                />
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
            // (.user-agenda-block-inner) = icône agenda 24px + places disponibles
            // (.slot-spots, .62rem) en dessous.
            const remaining = Math.max(0, b.capacity - b.used);
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
                <span
                  className="slot-icon"
                  style={{
                    fontSize: 24,
                    lineHeight: 1,
                    width: 24,
                    height: 24,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  📆
                </span>
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
  };

  return (
    // Info-bulle déléguée : un seul handler lit data-tip / data-slot-tip au survol.
    <div id="tab-content-agenda" onMouseMove={onAgendaTip} onMouseLeave={clearTip}>
      {/* Info-bulle flottante unique (texte data-tip / « Journées concernées »). */}
      <AgendaTooltip tip={tip} tipRef={tipRef} />
      <div
        style={{
          // position:relative → la nav semaine peut être centrée en absolu sur toute
          // la largeur (= largeur du tableau), indépendamment des éléments latéraux.
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: isMobile ? 0 : ".75rem",
          flexWrap: "wrap",
          // Sur mobile, pas de marge autour de la ligne de titre (ni dessus ni dessous).
          margin: isMobile ? "0" : "2rem 0 .75rem",
        }}
      >
        <div className="panel-title res-title" style={{ marginBottom: 0 }}>
          <span className="dot" />
          Réservations
          {exercices.length > 0 && (
            <span className="exercice-nav-inline">
              <span className="ex-nav-label">{exLabel}</span>
              {/* Flèches de navigation d'exercice masquées côté Réservations (usager). */}
              <span className="ex-nav-arrows" style={{ display: "none" }}>
                <button
                  type="button"
                  className="ex-arrow"
                  aria-label="Exercice précédent"
                  disabled={!canExPrev}
                  onClick={() => canExPrev && gotoExercice(exercices[exIdx - 1].id)}
                >
                  ◀
                </button>
                <button
                  type="button"
                  className="ex-arrow"
                  aria-label="Exercice suivant"
                  disabled={!canExNext}
                  onClick={() => canExNext && gotoExercice(exercices[exIdx + 1].id)}
                >
                  ▶
                </button>
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
                  // Retour à la semaine courante : on relâche le verrou pour
                  // re-dériver la période qui couvre aujourd'hui.
                  setRwPeriodId(null);
                  setAnchorMonday(ymd(mondayOf(new Date())));
                }}
              >
                Aujourd&apos;hui
              </button>
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
              onClick={() => printAgenda(true)}
              data-tip="Imprimer en noir & blanc"
              aria-label="Imprimer en noir & blanc"
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
            <button
              type="button"
              onClick={() => printAgenda(false)}
              data-tip="Imprimer en couleur"
              aria-label="Imprimer en couleur"
              style={{
                background: "none",
                border: "1px solid var(--border)",
                borderRadius: "var(--rad-sm)",
                padding: ".28rem .38rem",
                cursor: "pointer",
                color: "var(--accent)",
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
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6" />
                <rect x="6" y="14" width="12" height="8" rx="1" />
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

      <div className="planning-wrap" id="agenda-print-grid">
        <div
          className={`agenda-grid${mode === "realweek" ? " is-realweek" : ""}`}
          style={{ gridTemplateColumns: `44px repeat(${displayDays.length}, minmax(0, 1fr))` }}
        >
          {/* Mode A/B : grosse lettre A/B de la semaine active dans le coin haut-gauche
              (cf. legacy cornerAB) — Semaine réelle = parité de la semaine affichée,
              Modèle de période = semaine A/B sélectionnée. Sinon, l'horloge. */}
          <div
            className="agenda-header-cell agenda-corner"
            data-tip={abMode && effectiveWeek ? `Semaine ${effectiveWeek}` : "Horaires"}
          >
            {abMode && effectiveWeek ? effectiveWeek : "🕘"}
          </div>
          {displayDays.map((d) => (
            <div key={d} className={`agenda-header-cell${outOfPeriodCls(d)}`}>
              {DAY_NAMES[d] ?? d}
              {mode === "realweek" && weekDateByDay[d] && (
                <span className="agenda-day-sub">{weekDateByDay[d]}</span>
              )}
            </div>
          ))}

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
                  {dayBlocks(d)
                    .filter((b) => b.isAllDay)
                    .map((b) => renderBlock(b, true))}
                </div>
              ))}
            </>
          )}

          <div className="agenda-time-col" style={{ height: totalH }}>
            {(() => {
              // Colonne d'heures (port legacy renderUserAgenda). En mode « masquer les
              // horaires sans créneau », la grille est compactée : la colonne ne doit
              // afficher que les heures RÉELLEMENT visibles et se terminer sur la fin du
              // dernier créneau affiché — PAS sur la borne de la plage/journée. On marque
              // donc aussi la fin réelle de chaque plage (rupture) avec son horaire exact.
              const minLabel = (m: number) =>
                `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
              // Fin réelle de la grille = fin du dernier quart visible (≠ gridEndMin si compacté).
              const effectiveEnd = quarters.length
                ? quarters[quarters.length - 1] + 15
                : gridEndMin;
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
              // Fin de chaque plage précédant une rupture (hors pause) : l'heure de fin
              // réelle du dernier créneau de la plage, remontée au-dessus de sa ligne.
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
              return marks.map((mk) => (
                <div key={mk.key} className={mk.cls} style={{ top: mk.top }}>
                  {mk.label}
                </div>
              ));
            })()}
          </div>

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
              onDragOver={(e) => {
                if (isDayDisabled(d)) return;
                if (dragItem != null) e.preventDefault();
              }}
              onDrop={(e) => {
                // Dépôt dans l'inter-bloc (pas sur un créneau) → on annule simplement le drag ;
                // les dépôts utiles sont gérés par le bloc-créneau (stopPropagation).
                if (isDayDisabled(d)) return;
                e.preventDefault();
                setDragItem(null);
                setDropKey(null);
              }}
            >
              {/* Lignes de grille sur les quarts VISIBLES (compactage pause) :
                  pointillé fin par quart, trait plein (is-hour) sur l'heure pleine. */}
              {quarters.map((min) => {
                const isHour = min % 60 === 0;
                return (
                  <div
                    key={min}
                    className={`agenda-grid-line${isHour ? " is-hour" : ""}`}
                    style={{ top: mapMinToY(min) }}
                  />
                );
              })}
              {/* Bande grise « pause méridienne » (top/height via le mapping ;
                  disparaît si la pause tombe entièrement dans une zone masquée). */}
              {hasLunch &&
                (() => {
                  const ltop = mapMinToY(lunchStart);
                  const lh = mapMinToY(lunchEnd) - ltop;
                  return lh > 0 ? (
                    <div className="agenda-lunch-band" style={{ top: ltop, height: lh }} />
                  ) : null;
                })()}
              {dayBlocks(d)
                // Grille horaire : uniquement les créneaux horaires (les « journée
                // entière » sont rendus dans la bande dédiée en haut). On affiche TOUS
                // les créneaux (réservés ou vides réservables) ; « Masquer les horaires
                // sans créneau » ne compacte que des heures, pas des créneaux.
                .filter((b) => !b.isAllDay)
                .map((b) => renderBlock(b, false))}
            </div>
          ))}
        </div>
      </div>

      {/* Sous le tableau : info « max. réservations ». */}
      <p style={{ fontSize: ".8rem", color: "var(--muted)", margin: 0 }}>
        ℹ️{" "}
        {modes.recurringMode ? (
          <>
            Vous pouvez réserver{" "}
            <strong>
              {service.maxReservationsPeriod} créneau
              {service.maxReservationsPeriod > 1 ? "x" : ""} par période
            </strong>{" "}
            et{" "}
            <strong>
              {service.maxReservations} créneau{service.maxReservations > 1 ? "x" : ""} par an
            </strong>
            .
          </>
        ) : (
          <>
            Vous pouvez réserver{" "}
            <strong>
              {service.maxReservations} séance{service.maxReservations > 1 ? "s" : ""} par an
            </strong>
            .
          </>
        )}
      </p>

      {/* Compteur du brouillon, sur sa propre ligne juste en dessous.
          Marge supérieure plus large sur mobile (0.75rem) que sur desktop (0.2rem). */}
      <p
        style={{
          fontSize: ".75rem",
          // Modifications en attente → couleur warning ; sinon muté.
          color: pendingCount > 0 ? "var(--warn)" : "var(--muted)",
          margin: isMobile ? "0.75rem 0 0" : "0.2rem 0 0",
          textAlign: "right",
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

      {/* Barre d'actions du brouillon (legacy « Annuler » / « Enregistrer → ») :
          toujours affichée, boutons désactivés s'il n'y a aucune modification. */}
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
          onClick={clearPending}
          disabled={pendingCount === 0}
        >
          Annuler
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setRecapOpen(true)}
          disabled={pendingCount === 0}
        >
          {onlyRemovals ? "Supprimer →" : "Enregistrer →"}
        </button>
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
              ["Jauge", modes.gaugeRec || modes.gaugePonct],
              // Ouvert les jours fériés = niveau service ; Ouvert vacances scolaires =
              // niveau demandeur de l'usager (openOnSchoolHolidays).
              ["Ouvert les jours fériés", service.openOnHolidays],
              ["Ouvert vacances scolaires", openOnSchoolHolidays],
            ] as [string, boolean][]
          ).map(([label, on]) => (
            <span key={label} style={{ opacity: on ? 1 : 0.35 }}>
              {label} <strong>{on ? "✓" : "—"}</strong>
            </span>
          ))}
        </div>
      )}

      {stackKey && stackBlock && (
        <ModalOverlay onClose={() => setStackKey(null)}>
          {(() => {
            // Modale "pile" stylée comme le legacy (cell-stack-modal) : pastille
            // date/jour, sous-titre horaire, bascules validation/pointage, mini-grille
            // horaire (csm-time-col + bloc créneau coloré csm-slot-block) contenant la
            // liste des badges (cell-stack-list), puis bandeau capacité.
            const isPonctuel = uniqueIdSet.has(stackKey.slotId);
            const uSlot = uniqueSlots.find((s) => s.id === stackKey.slotId);
            const ponctDate =
              isPonctuel && uSlot?.slotDate
                ? new Date(`${uSlot.slotDate}T00:00:00`).toLocaleDateString("fr-FR", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })
                : "";
            const period = periods.find((p) => p.id === effectivePeriodId);
            // Pastille : libellé de période (récurrent) ou date (ponctuel), cf. legacy.
            const pillLabel = isPonctuel ? ponctDate : (period?.label ?? "");
            const dayLabel = DAY_NAMES[stackKey.dayKey] ?? stackKey.dayKey;
            // Jauge = somme enfants (+ accompagnants si comptés) / capacité.
            const gaugeSum = stackBlock.bookings.reduce(
              (s, bk) => s + gaugeUnits(bk.enfants, bk.accompagnants, service.gaugeAccompagnants),
              0,
            );
            const gaugeTotal = stackBlock.capacity;
            const gaugePct =
              gaugeTotal > 0 ? Math.min(100, Math.round((gaugeSum / gaugeTotal) * 100)) : 0;
            const gaugeColor =
              gaugePct >= 100 ? "var(--danger)" : gaugePct >= 70 ? "#e8a45a" : "var(--accent)";
            const showGauge = isPonctuel ? modes.gaugePonct : modes.gaugeRec;
            const sMin = stackSlot ? toMinutes(stackSlot.startTime, 0) : 0;
            const eMin = stackSlot ? toMinutes(stackSlot.endTime, sMin + 60) : sMin + 60;
            const hasRange = eMin > sMin;
            const pxPerMinModal = 24 / 15; // 24 px par quart d'heure (legacy)
            const blockMinH = hasRange ? Math.max(56, (eMin - sMin) * pxPerMinModal) : 56;
            const marks: number[] = [];
            if (hasRange) for (let m = sMin; m <= eMin; m += 15) marks.push(m);
            return (
              <>
                <button
                  type="button"
                  className="modal-close"
                  onClick={() => setStackKey(null)}
                  aria-label="Fermer"
                >
                  ×
                </button>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "1rem",
                    flexWrap: "wrap",
                    marginBottom: ".6rem",
                    paddingRight: "1.5rem",
                  }}
                >
                  {/* Gauche : pastille période/date + horaire (jour) sur la même ligne. */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: ".6rem",
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      className={`period-btn active${isPonctuel ? " is-uniq" : ""}`}
                      style={{
                        cursor: "default",
                        padding: ".12rem .5rem",
                        fontSize: ".64rem",
                        gap: ".3rem",
                        textTransform: "capitalize",
                      }}
                    >
                      <span className="period-badge" />
                      {pillLabel}
                    </span>
                    <span className="panel-subtitle" style={{ margin: 0 }}>
                      {isPonctuel
                        ? stackSlot
                          ? `${stackSlot.startTime} – ${stackSlot.endTime}`
                          : ""
                        : `${dayLabel}${stackSlot ? ` · ${stackSlot.startTime} – ${stackSlot.endTime}` : ""}`}
                    </span>
                  </div>
                </div>
                <div className="csm-grid-wrap">
                  <div className="csm-time-col" style={{ height: blockMinH }}>
                    {marks.map((m) => (
                      <div
                        key={m}
                        className="csm-time-mark"
                        style={{ top: (m - sMin) * pxPerMinModal }}
                      >
                        {`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`}
                      </div>
                    ))}
                  </div>
                  <div
                    className={`csm-slot-block${isPonctuel ? " is-uniq" : ""}`}
                    style={
                      {
                        minHeight: blockMinH,
                        "--quarter-h": "24px",
                        "--hour-h": "96px",
                      } as React.CSSProperties
                    }
                  >
                    <div className="cell-stack-list">
                      {stackBlock.bookings.map((bk) => (
                        // biome-ignore lint/a11y/useKeyWithClickEvents: ligne réservation (clic = éditer)
                        <div
                          key={bk.id}
                          className={`planning-name-tag ${bk.validated ? "is-validated" : "is-pending"}${bk.pointage != null ? " is-locked" : ""}`}
                          style={{
                            ...badgeStyle(bk.validated),
                            cursor: "pointer",
                            position: "relative",
                          }}
                          data-tip={`${bk.demandeur} — ${bk.name}`}
                          onClick={() => {
                            onBlockQuickAction(bk);
                          }}
                        >
                          <PointagePill pointage={bk.pointage} />
                          {/* Réservation pointée OU validée-bloquée → verrouillée : pas de
                              suppression rapide (cf. legacy isLockedBadge, croix masquée). */}
                          {bk.pointage == null && !bookingLocked(bk) && (
                            <button
                              type="button"
                              className="planning-name-tag-close"
                              data-tip="Supprimer"
                              aria-label="Supprimer"
                              style={{
                                position: "absolute",
                                top: 1,
                                right: 3,
                                border: "none",
                                background: "transparent",
                                color: "inherit",
                                cursor: "pointer",
                                fontSize: ".8rem",
                                lineHeight: 1,
                                padding: 0,
                                opacity: 0.6,
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                // Usager : on n'annule que SA propre réservation.
                                if (bk.mine && window.confirm("Annuler cette réservation ?")) {
                                  run(cancelMyBookingAction(service.id, bk.id));
                                }
                              }}
                            >
                              ×
                            </button>
                          )}
                          {(bk.structure || bk.demandeur) && (
                            <span style={{ fontWeight: 700 }}>{bk.structure || bk.demandeur}</span>
                          )}
                          <span style={{ fontSize: ".65rem", color: "var(--muted)" }}>
                            {bk.name}
                          </span>
                          {modes.themeMode && bk.theme && (
                            <span
                              style={{
                                fontSize: ".62rem",
                                fontWeight: 600,
                                color: bk.validated ? "var(--accent)" : "rgba(232, 164, 90, .95)",
                              }}
                            >
                              {bk.theme}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div id="csm-cap-info">
                  {showGauge ? (
                    <span className="csm-gauge-info">
                      <span>Jauge</span>
                      <span
                        style={{
                          display: "inline-block",
                          width: 80,
                          height: 6,
                          borderRadius: 3,
                          background: "rgba(0,0,0,.18)",
                          overflow: "hidden",
                        }}
                      >
                        <span
                          style={{
                            display: "block",
                            height: "100%",
                            width: `${gaugePct}%`,
                            background: gaugeColor,
                          }}
                        />
                      </span>
                      <span>
                        {gaugeSum}/{gaugeTotal}
                      </span>
                    </span>
                  ) : (
                    <span>
                      {stackBlock.used}/{stackBlock.capacity}
                    </span>
                  )}
                </div>
              </>
            );
          })()}
        </ModalOverlay>
      )}

      {/* Modale récapitulative (legacy reservation-confirm-modal) : liste les
          ajouts (+ thème si demandeur en mode thèmes) et les annulations, puis
          « Confirmer » valide tout d'un coup. */}
      {recapOpen && (
        <ModalOverlay onClose={() => !committing && setRecapOpen(false)}>
          <button
            type="button"
            className="modal-close"
            onClick={() => setRecapOpen(false)}
            aria-label="Fermer"
          >
            ×
          </button>
          <div className="modal-title">✅ Confirmer mes réservations</div>

          {/* Récapitulatif usager (cf. legacy #recap-user). */}
          <div className="panel">
            <div className="panel-title" style={{ justifyContent: "space-between" }}>
              <span style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
                <span className="dot" />
                Récapitulatif
              </span>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => window.print()}
                style={{ padding: ".4rem .9rem", fontSize: ".78rem" }}
              >
                🖨️ Imprimer
              </button>
            </div>
            <div className="recap-grid">
              <div className="recap-item">
                <div className="recap-key">Nom</div>
                <div className="recap-val">{userInfo.nom || "—"}</div>
              </div>
              <div className="recap-item">
                <div className="recap-key">Prénom</div>
                <div className="recap-val">{userInfo.prenom || "—"}</div>
              </div>
              <div className="recap-item">
                <div className="recap-key">E-mail</div>
                <div className="recap-val">{userInfo.email || "—"}</div>
              </div>
              <div className="recap-item">
                <div className="recap-key">Niveau</div>
                <div className="recap-val">{userInfo.niveau || "—"}</div>
              </div>
              {/* Enfants/Adultes globaux seulement hors mode jauge (sinon par créneau). */}
              {!(modes.gaugeRec || modes.gaugePonct) && (
                <>
                  <div className="recap-item">
                    <div className="recap-key">Enfants</div>
                    <div className="recap-val">{userInfo.enfants || "—"}</div>
                  </div>
                  <div className="recap-item">
                    <div className="recap-key">Adultes</div>
                    <div className="recap-val">{userInfo.accompagnants || "—"}</div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Liste des réservations (cf. legacy #recap-bookings). */}
          <div className="panel">
            <div className="panel-title">
              <span className="dot" />
              Mes réservations
            </div>
            {pendingAdds.length === 0 &&
            pendingRemovals.length === 0 &&
            Object.keys(pendingMoves).length === 0 ? (
              <p className="no-booking-msg">Aucune modification.</p>
            ) : (
              <div className="recap-period-entries">
                {pendingAdds.map((a) => {
                  const slot = a.ponctuel
                    ? uniqueSlots.find((s) => s.id === a.slotId)
                    : slots.find((s) => s.id === a.slotId);
                  const allDay = !slot?.startTime || !slot?.endTime;
                  const timeStr = allDay
                    ? "Journée entière"
                    : `${slot?.startTime} – ${slot?.endTime}`;
                  const dayOrDate = a.ponctuel
                    ? ponctuelDateLabel(a.slotId)
                    : (DAY_NAMES[a.dayKey] ?? a.dayKey);
                  const period = periods.find((p) => p.id === a.periodId);
                  const gaugeOn = modes.gaugeRec || modes.gaugePonct;
                  return (
                    <div key={a.key} className="recap-period-entry">
                      <div
                        className="recap-period-dot"
                        style={a.ponctuel ? undefined : { background: period?.color }}
                      />
                      <div className="recap-period-info" style={{ flex: 1 }}>
                        <div className="key">
                          {a.ponctuel ? "Séance ponctuelle" : (period?.label ?? "")}{" "}
                          <span style={{ color: "var(--accent)", fontWeight: 700 }}>+</span>
                        </div>
                        <div className="val">
                          {dayOrDate} : {timeStr}
                          {a.theme ? ` · ${a.theme}` : ""}
                        </div>
                        {gaugeOn && (
                          <div
                            className="val"
                            style={{ fontSize: ".72rem", color: "var(--accent)" }}
                          >
                            Enfants : {a.enfants} · Adultes : {a.accompagnants}
                          </div>
                        )}
                        {modes.themeMode && (
                          <div style={{ marginTop: ".25rem" }}>
                            {service.themesMode === "liste" ? (
                              <select
                                value={a.theme}
                                onChange={(e) =>
                                  setPendingAdds((prev) =>
                                    prev.map((x) =>
                                      x.key === a.key ? { ...x, theme: e.target.value } : x,
                                    ),
                                  )
                                }
                                style={{ fontSize: ".72rem" }}
                              >
                                <option value="">— thème —</option>
                                {themes.map((t) => (
                                  <option key={t} value={t}>
                                    {t}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                value={a.theme}
                                onChange={(e) =>
                                  setPendingAdds((prev) =>
                                    prev.map((x) =>
                                      x.key === a.key ? { ...x, theme: e.target.value } : x,
                                    ),
                                  )
                                }
                                placeholder="thème"
                                style={{ fontSize: ".72rem", width: 160 }}
                              />
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {pendingRemovals.map((r) => (
                  <div key={r.bookingId} className="recap-period-entry">
                    <div
                      className="recap-period-dot"
                      style={{ background: "var(--danger)", opacity: 0.5 }}
                    />
                    <div className="recap-period-info" style={{ flex: 1 }}>
                      <div className="key" style={{ color: "var(--danger)" }}>
                        Supprimée
                      </div>
                      <div className="val" style={{ textDecoration: "line-through", opacity: 0.6 }}>
                        {r.label}
                      </div>
                    </div>
                  </div>
                ))}
                {Object.entries(pendingMoves).map(([id, m]) => (
                  <div key={`move-${id}`} className="recap-period-entry">
                    <div className="recap-period-dot" style={{ background: "var(--warn)" }} />
                    <div className="recap-period-info" style={{ flex: 1 }}>
                      <div className="key" style={{ color: "var(--warn)" }}>
                        Déplacée
                      </div>
                      <div className="val">→ {m.label}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {commitError && (
            <p className="field-error" style={{ display: "block", marginTop: ".4rem" }}>
              {commitError}
            </p>
          )}
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setRecapOpen(false)}
              disabled={committing}
            >
              ← Modifier
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={commitPending}
              disabled={committing}
            >
              {committing ? "Enregistrement…" : "Enregistrer mes réservations ✓"}
            </button>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}

/**
 * Overlay de modale : clic sur le fond ou touche Échap = fermeture. Encapsule les
 * handlers clavier/souris pour rester accessible (et éviter de dupliquer les ignores).
 */
function ModalOverlay({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
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
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {children}
      </dialog>
    </div>
  );
}
