"use client";

import { useEffect, useRef, useState } from "react";
import { ModalOverlay, PointagePill } from "@/components/agenda-shared";
import { type AgendaBlockBase, badgeStyle, DAY_NAMES, toMinutes } from "@/lib/agenda-core";
import { gaugeColor, gaugeUnits } from "@/lib/gauge";
import { badgeTitle } from "./agenda-format";
import type { Booking } from "./agenda-grid";

type Block = AgendaBlockBase<Booking>;

/**
 * Modale « pile » : liste des réservations d'un créneau (port legacy
 * cell-stack-modal) — pastille date/jour, bascules validation/pointage,
 * mini-grille horaire (csm-time-col + csm-slot-block) contenant les badges
 * (cell-stack-list), puis bandeau capacité/jauge.
 *
 * Composant CONTRÔLÉ : le bloc/créneau affichés et toutes les actions (création,
 * édition, suppression, drag, copier/couper, pointage/validation) restent pilotés
 * par la grille parente via les callbacks — la modale ne porte aucun état.
 */
export function BookingStackModal({
  stackKey,
  block,
  slot,
  isPonctuel,
  ponctuelDate,
  periodLabel,
  validation,
  pointageMode,
  creationMode,
  creatable,
  themeMode,
  gaugeAccompagnants,
  draggingId,
  copiedBooking,
  lockedByPointage,
  onToggleValidation,
  onTogglePointage,
  onCreateClick,
  onQuickAction,
  onOpenDetail,
  onDelete,
  onContextMenu,
  onDragStartBooking,
  onDragEndBooking,
  onClose,
}: {
  stackKey: { slotId: string; dayKey: string };
  block: Block;
  slot: { startTime: string; endTime: string } | null;
  isPonctuel: boolean;
  ponctuelDate: string | null | undefined; // date (YYYY-MM-DD) d'un créneau ponctuel
  periodLabel: string; // libellé de la période active (pastille, récurrent)
  validation: boolean;
  pointageMode: boolean;
  creationMode: boolean;
  // Clic sur le FOND du créneau → création (mêmes conditions que la grille :
  // pas complet, pas un récurrent en semaine réelle, période active) — calculé
  // par le parent qui connaît la période effective.
  creatable: boolean;
  themeMode: boolean;
  gaugeAccompagnants: boolean;
  draggingId: number | null;
  copiedBooking: { id: number; mode: "copy" | "cut" } | null;
  lockedByPointage: (bk: Booking) => boolean;
  onToggleValidation: (v: boolean) => void;
  onTogglePointage: (v: boolean) => void;
  onCreateClick: () => void;
  onQuickAction: (bk: Booking) => boolean;
  onOpenDetail: (bk: Booking) => void;
  onDelete: (bk: Booking) => void;
  onContextMenu: (bk: Booking, x: number, y: number) => void;
  onDragStartBooking: (bk: Booking) => void;
  onDragEndBooking: () => void;
  onClose: () => void;
}) {
  // ── Glisser-déplacer d'un badge vers la grille ──
  // La pile RESTE affichée tant que le glissé survole sa boîte ; quand le pointeur en
  // SORT, elle est MASQUÉE (visibility) et non démontée : la grille derrière devient
  // cible de dépôt (un élément hidden ne capte plus rien), mais le badge SOURCE reste
  // monté — condition pour que son dragend tire TOUJOURS, y compris sur une annulation
  // (Échap, dépôt hors cible, voire hors fenêtre). Démonter la modale à la sortie
  // laissait l'estompage draggingId en place sur ces annulations, dragend ne tirant
  // jamais sur un nœud retiré du DOM. La fermeture réelle n'a lieu qu'au dragend.
  // Sortie détectée par un écouteur document `dragover` (il tire en continu pendant un
  // drag HTML5) comparant le pointeur au rect du <dialog> — plus robuste qu'un comptage
  // dragenter/dragleave, sensible aux éléments enfants.
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!dragActive) return;
    const dialog = boxRef.current?.closest("dialog");
    if (!dialog) return;
    // Constante rétrécie (non nullable) pour la closure — évite le non-null assertion.
    const box = dialog;
    function onDocDragOver(e: DragEvent) {
      const r = box.getBoundingClientRect();
      const outside =
        e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      if (outside) setHidden(true);
    }
    document.addEventListener("dragover", onDocDragOver);
    return () => document.removeEventListener("dragover", onDocDragOver);
  }, [dragActive]);
  // Masquage posé sur l'OVERLAY (le parent de la boîte, rendu par ModalOverlay) en DOM
  // direct — même approche que dimBadges côté grille : le composant ne contrôle pas cet
  // élément. visibility (≠ display) : la boîte garde son rect, encore lu par l'écouteur.
  useEffect(() => {
    const overlay = boxRef.current?.closest<HTMLElement>(".modal-overlay");
    if (overlay) overlay.style.visibility = hidden ? "hidden" : "";
  }, [hidden]);

  // Récurrent affiché en Semaine réelle : la gestion des RÉSERVATIONS (valider / supprimer
  // / déplacer / copier / pointer) y est autorisée — les gestes portent sur la réservation
  // parente, résolue côté grille via les callbacks.
  const ponctDateLabel =
    isPonctuel && ponctuelDate
      ? new Date(`${ponctuelDate}T00:00:00`).toLocaleDateString("fr-FR", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : "";
  // Pastille : libellé de période (récurrent) ou date (ponctuel), cf. legacy.
  const pillLabel = isPonctuel ? ponctDateLabel : periodLabel;
  const dayLabel = DAY_NAMES[stackKey.dayKey] ?? stackKey.dayKey;
  // Jauge = somme enfants (+ accompagnants si comptés) / capacité.
  const gaugeSum = block.bookings.reduce(
    (s, bk) => s + gaugeUnits(bk.enfants, bk.accompagnants, gaugeAccompagnants),
    0,
  );
  const gaugeTotal = block.capacity;
  const gaugePct = gaugeTotal > 0 ? Math.min(100, Math.round((gaugeSum / gaugeTotal) * 100)) : 0;
  const gaugeFill = gaugeColor(gaugePct);
  const showGauge = block.jauge;
  // Créneau « JOURNÉE ENTIÈRE » (sans horaires) : pas de mini-grille horaire
  // (les repères seraient calculés sur les replis 00:00 → 01:00) ni d'horaire
  // dans le sous-titre — libellé « Journée entière » à la place.
  const allday = block.isAllDay;
  const sMin = slot ? toMinutes(slot.startTime, 0) : 0;
  const eMin = slot ? toMinutes(slot.endTime, sMin + 60) : sMin + 60;
  const hasRange = !allday && eMin > sMin;
  const pxPerMinModal = 24 / 15; // 24 px par quart d'heure (legacy)
  const blockMinH = hasRange ? Math.max(56, (eMin - sMin) * pxPerMinModal) : 56;
  const marks: number[] = [];
  if (hasRange) for (let m = sMin; m <= eMin; m += 15) marks.push(m);
  const timeLabel = (s: { startTime: string; endTime: string }) =>
    allday ? "Journée entière" : `${s.startTime} – ${s.endTime}`;

  return (
    <ModalOverlay onClose={onClose}>
      <button type="button" className="modal-close" onClick={onClose} aria-label="Fermer">
        ×
      </button>
      <div
        ref={boxRef}
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
              ? slot
                ? timeLabel(slot)
                : ""
              : `${dayLabel}${slot ? ` · ${timeLabel(slot)}` : ""}`}
          </span>
        </div>
        {/* Droite : bascules. « Mode validation » est toujours affiché ;
            « Mode pointage » seulement en « Semaine réelle » (le pointage n'a
            de sens que sur une semaine datée — cf. legacy). La croix de
            fermeture est positionnée en haut à droite de la modale (modal-close). */}
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          {/* Validation (porte sur la réservation parente pour un récurrent) + pointage
              (par occurrence). */}
          <label className="planning-option" style={{ margin: 0 }}>
            Mode validation{" "}
            <input
              type="checkbox"
              checked={validation}
              onChange={(e) => onToggleValidation(e.target.checked)}
            />
          </label>
          <label className="planning-option" style={{ margin: 0 }}>
            Mode pointage{" "}
            <input
              type="checkbox"
              checked={pointageMode}
              onChange={(e) => onTogglePointage(e.target.checked)}
            />
          </label>
        </div>
      </div>
      <div className="csm-grid-wrap">
        {/* Colonne horaire masquée pour un créneau « journée entière ». */}
        {!allday && (
          <div className="csm-time-col" style={{ height: blockMinH }}>
            {marks.map((m) => (
              <div key={m} className="csm-time-mark" style={{ top: (m - sMin) * pxPerMinModal }}>
                {`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`}
              </div>
            ))}
          </div>
        )}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: fond du créneau (clic = créer une réservation) */}
        <div
          className={`csm-slot-block${isPonctuel ? " is-uniq" : ""}`}
          // Info-bulle au survol du créneau, identique à celle de la grille :
          // récurrent → période + jour/heures + demandeurs + capacité ;
          // ponctuel → demandeurs + capacité. Le handler délégué onAgendaTip
          // (sur #tab-content-agenda, qui englobe la modale) lit ces attributs
          // et réutilise recMetaForBlock/concernedDatesForBlock, comme la grille.
          data-slot-tip=""
          data-slotid={stackKey.slotId}
          data-daykey={stackKey.dayKey}
          onClick={(e) => {
            // Clic sur le FOND uniquement : un clic sur un badge (édition,
            // validation, pointage, ✕…) garde son comportement propre.
            if (!creatable) return;
            if (
              (e.target as HTMLElement).closest(".planning-name-tag, button, input, select, label")
            )
              return;
            // La pile reste ouverte derrière : fermer la création y ramène
            // (même patron que la modale détail).
            onCreateClick();
          }}
          style={
            {
              minHeight: blockMinH,
              "--quarter-h": "24px",
              "--hour-h": "96px",
              cursor: creatable ? "pointer" : undefined,
            } as React.CSSProperties
          }
        >
          <div className="cell-stack-list">
            {[...block.bookings]
              // Tri des badges par date de DÉPÔT (créées en premier en haut) — ISO 8601,
              // comparable en chaîne. Départage par id : deux réservations peuvent
              // partager la même date, un coller reprenant celle de sa source.
              .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id)
              .map((bk) => (
                // biome-ignore lint/a11y/useKeyWithClickEvents: ligne réservation (clic = éditer)
                <div
                  key={bk.id}
                  className={`planning-name-tag ${bk.validated ? "is-validated" : "is-pending"}${lockedByPointage(bk) ? " is-locked" : ""}`}
                  // Glisser-déplacer depuis la pile : sauf si verrouillée (pointée / occurrence
                  // pointée). Récurrent en Semaine réelle inclus (déplace la parente).
                  draggable={!lockedByPointage(bk)}
                  style={{
                    ...badgeStyle(bk.validated),
                    cursor: !lockedByPointage(bk) ? "grab" : "default",
                    position: "relative",
                    opacity:
                      draggingId === bk.id ||
                      (copiedBooking?.mode === "cut" && copiedBooking.id === bk.id)
                        ? 0.4
                        : 1,
                  }}
                  data-tip={badgeTitle(bk)}
                  onDragStart={
                    lockedByPointage(bk)
                      ? undefined
                      : (e) => {
                          // On amorce le drag ; la pile reste ouverte et ne se fermera
                          // qu'à la SORTIE de la boîte (cf. effet dragActive plus haut),
                          // libérant alors la grille comme cible de dépôt.
                          e.stopPropagation();
                          setDragActive(true);
                          onDragStartBooking(bk);
                        }
                  }
                  onDragEnd={
                    lockedByPointage(bk)
                      ? undefined
                      : () => {
                          // Tire TOUJOURS (la source reste montée, la pile n'étant que
                          // masquée) : lève l'estompage, puis — si le glissé était sorti
                          // de la boîte (dépôt sur la grille, Échap, dépôt hors cible) —
                          // ferme la pile pour de bon.
                          setDragActive(false);
                          onDragEndBooking();
                          if (hidden) onClose();
                        }
                  }
                  onClick={() => {
                    // Action rapide (valider = parente, pointer = occurrence) si un mode est
                    // actif ; sinon la modale détail s'empile par-dessus (fermeture y ramène).
                    if (onQuickAction(bk)) return;
                    onOpenDetail(bk);
                  }}
                  // Clic droit → menu « Copier » (récurrent en Semaine réelle inclus ; pas en
                  // création ni sur une réservation verrouillée par un pointage).
                  onContextMenu={(e) => {
                    if (creationMode || lockedByPointage(bk)) return;
                    e.preventDefault();
                    e.stopPropagation();
                    onContextMenu(bk, e.clientX, e.clientY);
                  }}
                >
                  <PointagePill pointage={bk.pointage} />
                  {/* Croix masquée si verrouillée (pointée / occurrence pointée). Récurrent
                      en Semaine réelle : supprime la réservation récurrente (via la parente). */}
                  {!lockedByPointage(bk) && (
                    <button
                      type="button"
                      className="planning-name-tag-close"
                      data-tip="Supprimer"
                      style={{ border: "none", padding: 0 }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(bk);
                      }}
                    >
                      ×
                    </button>
                  )}
                  {(bk.structure || bk.demandeur) && (
                    <span style={{ fontWeight: 700 }}>{bk.structure || bk.demandeur}</span>
                  )}
                  <span style={{ fontSize: ".65rem", color: "var(--muted)" }}>{bk.name}</span>
                  {themeMode && bk.theme && (
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
                  background: gaugeFill,
                }}
              />
            </span>
            <span>
              {gaugeSum}/{gaugeTotal}
            </span>
          </span>
        ) : (
          <span>
            {block.used}/{block.capacity}
          </span>
        )}
      </div>
    </ModalOverlay>
  );
}
