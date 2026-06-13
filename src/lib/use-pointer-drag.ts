"use client";

import { type MutableRefObject, useCallback, useEffect, useRef, useState } from "react";

// Drag « pointer events » unifié souris + tactile + stylet, en remplacement du HTML5
// Drag and Drop (qui ne se déclenche PAS au doigt sur mobile). Schéma :
//   - `start(item, e)` au pointerdown ARME le drag (mémorise l'item + l'origine) ;
//   - au-delà d'un seuil de déplacement le drag s'ACTIVE (onActivate) — en deçà c'est un
//     simple tap/clic, les handlers de clic suivent leur cours normalement ;
//   - onMove à chaque déplacement, onDrop au relâché (onCancel si interrompu).
// Les écouteurs sont posés sur window → le drag suit le pointeur hors de l'élément source.
// IMPORTANT : poser `touch-action: none` sur l'élément source, sinon le navigateur scrolle
// au lieu d'émettre les pointermove (et le drag tactile ne démarre jamais).
export function usePointerDrag<T>(handlers: {
  /** Déplacement minimal (px) avant d'activer le drag (anti-tap). Défaut 5. */
  threshold?: number;
  onActivate?: (item: T) => void;
  onMove: (item: T, e: PointerEvent) => void;
  onDrop: (item: T, e: PointerEvent) => void;
  onCancel?: (item: T) => void;
}): {
  start: (item: T, e: React.PointerEvent) => void;
  active: boolean;
} {
  const [active, setActive] = useState(false);
  const stateRef = useRef<{ item: T; x: number; y: number; activated: boolean } | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const start = useCallback((item: T, e: React.PointerEvent) => {
    // Bouton principal (souris) / contact tactile-stylet uniquement.
    if (e.button > 0) return;
    stateRef.current = { item, x: e.clientX, y: e.clientY, activated: false };
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const st = stateRef.current;
      if (!st) return;
      if (!st.activated) {
        const threshold = handlersRef.current.threshold ?? 5;
        if (Math.hypot(e.clientX - st.x, e.clientY - st.y) < threshold) return;
        st.activated = true;
        setActive(true);
        handlersRef.current.onActivate?.(st.item);
      }
      e.preventDefault();
      handlersRef.current.onMove(st.item, e);
    };
    const finish = (e: PointerEvent, cancelled: boolean) => {
      const st = stateRef.current;
      stateRef.current = null;
      if (!st) return;
      setActive(false);
      // Pas activé = simple tap → on ne fait rien (le clic suit son cours).
      if (!st.activated) return;
      if (cancelled) handlersRef.current.onCancel?.(st.item);
      else handlersRef.current.onDrop(st.item, e);
    };
    const onUp = (e: PointerEvent) => finish(e, false);
    const onCancel = (e: PointerEvent) => finish(e, true);
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, []);

  return { start, active };
}
