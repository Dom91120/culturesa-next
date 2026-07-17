"use client";

import { type MouseEvent, type RefObject, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Format court des dates de l'info-bulle « Journées concernées » (ex. « 12 mars »).
const TIP_DATE_FMT = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" });

export type AgendaTip =
  | { text: string }
  // Survol d'un créneau récurrent : dates concrètes + (côté admin) capacité et
  // demandeurs autorisés. `demandeurs` absent = service sans demandeurs (ligne
  // masquée) ; tableau vide = aucune restriction (« Ouvert à tous »).
  // `recurInfo` (côté admin) : résumé période + jour/heures du créneau parent,
  // affiché À LA PLACE de la liste de dates.
  | {
      dates: string[];
      capacity?: number | null;
      demandeurs?: string[];
      // « A une jauge » du créneau (slots.jauge) — absent = ligne masquée.
      jauge?: boolean;
      recurInfo?: { period: string; dayHours: string };
    }
  | null;

/**
 * Info-bulle flottante unique de l'agenda (remplace les `title` natifs au survol),
 * pilotée par délégation depuis le conteneur. Un seul tooltip à la fois : soit un
 * texte simple (élément porteur d'un attribut `data-tip`), soit l'info-bulle de
 * créneau (dates « Journées concernées » et/ou capacité + demandeurs autorisés ;
 * élément `data-slot-tip` + `data-slotid`/`data-daykey`). Repositionne sans
 * re-render tant que le contenu ne change pas.
 *
 * Partagé entre l'agenda admin et l'agenda usager (cf. useAgendaTooltip ci-dessous).
 */
export function useAgendaTooltip(opts: {
  // Dates concrètes d'un créneau récurrent (vide = pas d'info-bulle dates).
  getDates: (slotId: string, dayKey: string) => string[];
  // Métadonnées optionnelles du créneau récurrent (côté admin) : capacité +
  // demandeurs autorisés, ajoutées à l'info-bulle « Journées concernées ».
  getMeta?: (
    slotId: string,
    dayKey: string,
  ) => {
    capacity?: number | null;
    demandeurs?: string[];
    jauge?: boolean;
    recurInfo?: { period: string; dayHours: string };
  };
  // Quand true, aucune info-bulle (ex. saisie de thème en cours côté usager).
  suppressed?: () => boolean;
}) {
  const [tip, setTip] = useState<AgendaTip>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const tipPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  // Clé du contenu courant : évite de re-render à chaque mousemove.
  const tipKeyRef = useRef<string>("");

  const positionTip = () => {
    const el = tipRef.current;
    if (!el) return;
    const offset = 12;
    const r = el.getBoundingClientRect();
    let x = tipPos.current.x + offset;
    let y = tipPos.current.y + offset;
    if (x + r.width > window.innerWidth) x = window.innerWidth - r.width - 4;
    if (y + r.height > window.innerHeight) y = window.innerHeight - r.height - 4;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  };

  const clearTip = () => {
    tipKeyRef.current = "";
    setTip(null);
  };

  const onAgendaTip = (e: MouseEvent) => {
    if (opts.suppressed?.()) {
      if (tipKeyRef.current) clearTip();
      return;
    }
    const target = e.target as HTMLElement;
    tipPos.current = { x: e.clientX, y: e.clientY };
    let key = "";
    let next: AgendaTip = null;
    const tipEl = target.closest<HTMLElement>("[data-tip]");
    if (tipEl?.dataset.tip) {
      key = `t:${tipEl.dataset.tip}`;
      next = { text: tipEl.dataset.tip };
    } else {
      const recEl = target.closest<HTMLElement>("[data-slot-tip]");
      const slotId = recEl?.dataset.slotid;
      const dayKey = recEl?.dataset.daykey;
      if (slotId && dayKey) {
        const dates = opts.getDates(slotId, dayKey);
        const meta = opts.getMeta?.(slotId, dayKey) ?? {};
        if (dates.length || meta.capacity != null || meta.demandeurs != null || meta.recurInfo) {
          key = `d:${slotId}|${dayKey}`;
          next = {
            dates,
            capacity: meta.capacity,
            demandeurs: meta.demandeurs,
            jauge: meta.jauge,
            recurInfo: meta.recurInfo,
          };
        }
      }
    }
    if (key === tipKeyRef.current) {
      if (key) positionTip();
      return;
    }
    tipKeyRef.current = key;
    setTip(next);
  };

  // Repositionne après changement de contenu (la taille dépend du texte/des dates).
  // biome-ignore lint/correctness/useExhaustiveDependencies: positionTip lit tipPos (ref)
  useEffect(() => {
    if (tip) positionTip();
  }, [tip]);

  return { tip, tipRef, onAgendaTip, clearTip };
}

/** Rendu (en portail) de l'info-bulle flottante. */
export function AgendaTooltip({
  tip,
  tipRef,
}: {
  tip: AgendaTip;
  tipRef: RefObject<HTMLDivElement | null>;
}) {
  if (!tip) return null;
  return createPortal(
    <div
      ref={tipRef}
      style={{
        display: "block",
        position: "fixed",
        top: 0,
        left: 0,
        zIndex: 10001,
        pointerEvents: "none",
        background: "var(--surface1, #1f2430)",
        color: "var(--text, #e8e8e8)",
        border: "1px solid var(--border, rgba(255,255,255,.15))",
        borderRadius: 6,
        padding: "6px 8px",
        fontSize: ".62rem",
        lineHeight: 1.2,
        boxShadow: "0 6px 18px rgba(0,0,0,.35)",
        maxWidth: 520,
        whiteSpace: "pre-line",
      }}
    >
      {"text" in tip ? (
        tip.text
      ) : (
        <>
          {tip.recurInfo ? (
            // Côté admin : période en cours (en-tête) + jour/heures du créneau parent.
            <div style={{ marginBottom: 4 }}>
              {tip.recurInfo.period && (
                <div style={{ fontWeight: 600, marginBottom: 2 }}>{tip.recurInfo.period}</div>
              )}
              <div style={{ textTransform: "capitalize" }}>{tip.recurInfo.dayHours}</div>
            </div>
          ) : (
            tip.dates.length > 0 && (
              <div style={{ marginBottom: 4 }}>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>
                  {tip.dates.length > 1 ? "Journées concernées :" : "Journée concernée :"}
                </div>
                {/* Colonnes adaptées au contenu : autant que de dates (4 max), chacune à la
                    largeur de son texte — l'info-bulle d'un ponctuel (1 date) reste compacte. */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${Math.min(4, tip.dates.length)}, max-content)`,
                    gap: "0 12px",
                  }}
                >
                  {tip.dates.map((d) => (
                    <div key={d}>• {TIP_DATE_FMT.format(new Date(`${d}T12:00:00`))}</div>
                  ))}
                </div>
              </div>
            )
          )}
          {tip.demandeurs && (
            <div style={{ marginBottom: 2 }}>
              <span style={{ fontWeight: 600 }}>Demandeurs autorisés :</span>{" "}
              {tip.demandeurs.length ? tip.demandeurs.join(", ") : "Ouvert à tous"}
            </div>
          )}
          {typeof tip.capacity === "number" && (
            <div>
              <span style={{ fontWeight: 600 }}>Capacité :</span> {tip.capacity}
            </div>
          )}
          {typeof tip.jauge === "boolean" && (
            <div>
              <span style={{ fontWeight: 600 }}>Jauge :</span> {tip.jauge ? "active" : "inactive"}
            </div>
          )}
        </>
      )}
    </div>,
    document.body,
  );
}
