"use client";

import { type MutableRefObject, useCallback, useEffect, useRef, useState } from "react";

// Hook mutualisant le schéma des glisser-déposer « souris » de l'agenda admin
// (créer, journée entière, déplacer, redimensionner V, étendre H). Chaque drag
// suivait le MÊME boilerplate, dupliqué 5× :
//   - un state + un ref miroir (les écouteurs window lisent la valeur À JOUR) ;
//   - un useEffect qui (dé)branche mousemove/mouseup sur l'activité du drag,
//     met à jour state+ref au déplacement, nettoie + finalise au relâché.
// Le hook encapsule ce triplet ; le calcul propre à chaque drag reste dans les
// callbacks `onMove` (renvoie l'état suivant, ou null si rien ne change) et
// `onUp` (finalisation, avec ses propres conditions). Les callbacks sont lus via
// un ref → toujours frais, sans re-(dé)brancher les écouteurs à chaque rendu.
export function useDragInteraction<T>(handlers: {
  onMove: (drag: T, e: MouseEvent) => T | null;
  onUp: (drag: T) => void;
}): {
  /** État courant du drag (null = inactif). À lire au rendu pour l'aperçu. */
  drag: T | null;
  /** Démarre le drag (à appeler sur mousedown). */
  start: (drag: T) => void;
  /** Annule le drag en cours SANS finaliser (onUp non appelé). Ex. touche ÉCHAP. */
  cancel: () => void;
  /** Ref miroir de l'état courant (rarement nécessaire hors du hook). */
  ref: MutableRefObject<T | null>;
} {
  const [drag, setDrag] = useState<T | null>(null);
  const ref = useRef<T | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const set = useCallback((v: T | null) => {
    ref.current = v;
    setDrag(v);
  }, []);
  const start = useCallback((d: T) => set(d), [set]);
  // Annulation : on remet ref ET state à null. Le ref nullifié rend tout `onUp` en
  // vol inoffensif (`if (cur)` → skip), et le passage à inactif débranche les écouteurs.
  const cancel = useCallback(() => set(null), [set]);

  const active = drag !== null;
  useEffect(() => {
    if (!active) return;
    const onMove = (e: MouseEvent) => {
      const cur = ref.current;
      if (!cur) return;
      const next = handlersRef.current.onMove(cur, e);
      if (next) set(next);
    };
    const onUp = () => {
      const cur = ref.current;
      ref.current = null;
      setDrag(null);
      if (cur) handlersRef.current.onUp(cur);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [active, set]);

  return { drag, start, cancel, ref };
}
