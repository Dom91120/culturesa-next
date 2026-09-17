"use client";

import { useEffect, useState } from "react";

/**
 * Suivi RÉACTIF d'une media query CSS (« (max-width: 640px) » = seuil mobile de l'app).
 * SSR-safe : `false` au premier rendu (serveur et hydratation, pas de `window`), puis la
 * valeur réelle dès le montage et à chaque changement (rotation, redimensionnement).
 * Source unique des trois copies grille usager / liste d'attente / onboarding (audit D9).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return matches;
}
