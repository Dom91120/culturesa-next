"use client";

import { useEffect, useState } from "react";

/**
 * Logique de repli de la sidebar, PARTAGÉE par le shell admin et le shell usager.
 *
 * - Préférence `collapsed` persistée sous la clé `sidebar-collapsed` (commune aux deux
 *   shells). État initial = déplié, comme le rendu serveur (aucun mismatch d'hydratation) ;
 *   la restauration se fait post-montage. Le visuel replié AVANT ce point est assuré par
 *   `html.sb-collapsed`, posée par le script <head> de layout.tsx dès avant le premier paint.
 * - Fenêtre ÉTROITE (≤ 1000px) : sidebar réduite D'OFFICE, indépendamment de la préférence.
 * - `mobileBreakpoint` (optionnel, shell usager) : en dessous, la sidebar devient une barre
 *   horizontale pleine largeur → l'état replié (toggle desktop) ne doit JAMAIS s'y appliquer.
 * - La classe html `sb-collapsed` (alias CSS pré-hydratation) suit l'état EFFECTIF.
 */
export function useSidebarCollapse(opts?: { mobileBreakpoint?: number }) {
  const mobileBreakpoint = opts?.mobileBreakpoint;
  const [collapsed, setCollapsed] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem("sidebar-collapsed") === "1") setCollapsed(true);
    } catch {}
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1000px)");
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (mobileBreakpoint == null) return;
    const mq = window.matchMedia(`(max-width: ${mobileBreakpoint}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [mobileBreakpoint]);

  // État EFFECTIF : préférence utilisateur OU fenêtre étroite — jamais en mobile.
  const effCollapsed = (collapsed || narrow) && !isMobile;

  useEffect(() => {
    try {
      document.documentElement.classList.toggle("sb-collapsed", effCollapsed);
    } catch {}
  }, [effCollapsed]);

  function toggleSidebar() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem("sidebar-collapsed", next ? "1" : "0");
    } catch {}
    // (Classe html synchronisée par l'effet sur l'état effectif ci-dessus.)
  }

  return { effCollapsed, narrow, isMobile, toggleSidebar };
}
