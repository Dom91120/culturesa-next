"use client";

import { useEffect, useRef } from "react";
import { INPUT_CHROME } from "@/components/ui-styles";

const DEFAULT_MAX = 23 * 60 + 45;

/**
 * Incrémente/décrémente une heure « HH:MM » d'un delta (minutes), calé sur une grille et
 * borné à [min, max] (en minutes). Les heures peuvent dépasser 23 (ex. intervalle « 168:00 »).
 */
export function stepTime(
  value: string,
  deltaMin: number,
  opts: { grid?: number; min?: number; max?: number } = {},
): string {
  const grid = opts.grid ?? 15;
  const minMin = opts.min ?? 0;
  const maxMin = opts.max ?? DEFAULT_MAX;
  const m = /^(\d{1,3}):(\d{2})$/.exec(value.trim());
  let total = m ? Number(m[1]) * 60 + Math.min(59, Number(m[2])) : 0;
  const onGrid = total % grid === 0;
  if (onGrid) total += deltaMin;
  else total = deltaMin > 0 ? Math.ceil(total / grid) * grid : Math.floor(total / grid) * grid;
  total = Math.max(minMin, Math.min(maxMin, total));
  const h = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/**
 * Champ horaire « HH:MM » avec flèches ▲/▼ (clic-maintenu : 1er pas immédiat puis répétition
 * après 400 ms). Composant partagé : plages horaires (Matin/Après-midi) et champs heures des
 * réglages de réservation utilisent EXACTEMENT le même rendu.
 *
 * `step` = delta par clic (minutes) ; `grid` = grille de calage (défaut = step) ; `min`/`max`
 * bornes en minutes ; `maxLength` longueur de saisie ; `disabled`.
 */
export function TimeStepper({
  value,
  onChange,
  step = 15,
  grid = step,
  min = 0,
  max = DEFAULT_MAX,
  maxLength = 5,
  disabled = false,
  compact = false,
}: {
  value: string;
  onChange: (v: string) => void;
  step?: number;
  grid?: number;
  min?: number;
  max?: number;
  maxLength?: number;
  disabled?: boolean;
  /** Variante réduite EN HAUTEUR seulement (plages horaires du panneau Périodes) :
   * champ 17px au lieu de 21 (largeur et police inchangées), flèches raccourcies via
   * .time-step-wrap.compact (2 × 8px + 1px de gap = 17px). */
  compact?: boolean;
}) {
  const valueRef = useRef(value);
  valueRef.current = value;
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stop() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);
    timeoutRef.current = null;
    intervalRef.current = null;
  }

  function startHold(delta: number) {
    stop();
    onChange(stepTime(valueRef.current, delta, { grid, min, max })); // 1er pas immédiat
    timeoutRef.current = setTimeout(() => {
      intervalRef.current = setInterval(
        () => onChange(stepTime(valueRef.current, delta, { grid, min, max })),
        90,
      );
    }, 400);
  }

  // Nettoyage à l'unmount (refs stables uniquement).
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return (
    <span className={`time-step-wrap${compact ? " compact" : ""}`}>
      <input
        type="text"
        value={value}
        maxLength={maxLength}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: 50,
          // Hauteur calée sur la pile des flèches ▲/▼ : 2 × 10px + 1px de gap = 21px
          // (compact : 2 × 8px + 1px = 17px).
          height: compact ? 17 : 21,
          boxSizing: "border-box",
          // flexShrink:0 indispensable : dans un conteneur flex (ex. lignes radio du panneau
          // Réservations) l'input serait sinon comprimé et le « HH:MM » rogné.
          flexShrink: 0,
          // Compact : même taille que les lignes du tableau des périodes (.periods-table td).
          fontSize: compact ? ".75rem" : ".78rem",
          fontWeight: 400,
          // letter-spacing:normal indispensable : la règle globale `label { letter-spacing:.1em }`
          // est héritée dans les lignes radio (panneau Notifications) et élargit « HH:MM » → rognage.
          letterSpacing: "normal",
          padding: "0 .35rem",
          ...INPUT_CHROME,
          textAlign: "center",
        }}
      />
      <span className="time-step-btns">
        <button
          type="button"
          className="time-step-btn"
          tabIndex={-1}
          aria-label="Augmenter"
          disabled={disabled}
          onPointerDown={(e) => {
            e.preventDefault();
            startHold(step);
          }}
          onPointerUp={stop}
          onPointerLeave={stop}
          onPointerCancel={stop}
        >
          ▲
        </button>
        <button
          type="button"
          className="time-step-btn"
          tabIndex={-1}
          aria-label="Diminuer"
          disabled={disabled}
          onPointerDown={(e) => {
            e.preventDefault();
            startHold(-step);
          }}
          onPointerUp={stop}
          onPointerLeave={stop}
          onPointerCancel={stop}
        >
          ▼
        </button>
      </span>
    </span>
  );
}
