"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ════════════════════════════════════════════════════════════
//  Hooks péri-grille PARTAGÉS entre l'agenda admin (agenda-grid.tsx) et l'agenda
//  usager (user-agenda-grid.tsx) — extraction du chantier « couche péri-grille »
//  (audit 2026-07-17) : toast, auto-rafraîchissement, verrou de période, persistance
//  de vue. Chaque hook reproduit à l'identique le comportement des deux copies
//  qu'il remplace ; la charge utile (payload du toast, forme de la vue persistée)
//  reste définie par chaque grille.
// ════════════════════════════════════════════════════════════

/**
 * Toast de l'agenda (classes .toast du legacy) : affiché ~4 s puis retiré, centré
 * horizontalement sur la zone .app-main (et non le viewport), bas de page.
 * Générique sur la charge utile : admin y met un ReactNode, usager un couple
 * texte + variante — le rendu reste dans chaque grille.
 */
export function useAgendaToast<P extends object>() {
  const [toast, setToast] = useState<(P & { id: number }) | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastCenterX, setToastCenterX] = useState<number | null>(null);
  const toastIdRef = useRef(0);
  const showToast = useCallback((payload: P) => {
    toastIdRef.current += 1;
    setToast({ ...payload, id: toastIdRef.current });
  }, []);
  // Mesure le centre de .app-main, anime l'apparition, masque à ~4 s et retire à
  // ~4,3 s. Relancé à chaque nouveau toast via son id.
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
  return { toast, toastVisible, toastCenterX, showToast };
}

/**
 * Auto-rafraîchissement de l'agenda : intervalle configurable (0 = désactivé) + au
 * retour sur l'onglet (visibilitychange), suspendu quand `canRefresh()` est faux
 * (modale ouverte côté admin, brouillon en cours côté usager) ou onglet masqué.
 * `canRefresh`/`refresh` sont relus à CHAQUE tick via des refs : les appelants
 * passent des closures sur leurs valeurs de rendu sans se soucier des deps.
 */
export function useAgendaAutoRefresh(
  seconds: number,
  canRefresh: () => boolean,
  refresh: () => void,
) {
  const canRef = useRef(canRefresh);
  canRef.current = canRefresh;
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (!seconds || seconds <= 0) return;
    const refreshIfIdle = () => {
      if (document.visibilityState === "visible" && canRef.current()) refreshRef.current();
    };
    const id = window.setInterval(refreshIfIdle, seconds * 1000);
    document.addEventListener("visibilitychange", refreshIfIdle);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", refreshIfIdle);
    };
  }, [seconds]);
}

/**
 * Verrou de la période active en « Semaine réelle » : dès qu'une période couvrante
 * est dérivée pour la semaine courante, elle est figée dans `rwPeriodId` — la nav
 * ◀/▶ s'appuie sur cette période figée (et non une re-dérivation qui basculerait
 * sur la voisine aux frontières). Re-verrouille si l'ancien verrou ne couvre plus
 * la semaine (ex. après « Aujourd'hui »). Cf. legacy l.6481-6490.
 */
export function useCoveringPeriodLock(
  active: boolean,
  coveringPeriod: { id: number } | null,
  rwPeriodId: number | null,
  setRwPeriodId: (v: number | null) => void,
) {
  useEffect(() => {
    if (!active) return;
    if (coveringPeriod && coveringPeriod.id !== rwPeriodId) setRwPeriodId(coveringPeriod.id);
    else if (!coveringPeriod && rwPeriodId !== null) setRwPeriodId(null);
  }, [active, coveringPeriod, rwPeriodId, setRwPeriodId]);
}

/**
 * Persistance de la vue d'agenda en sessionStorage : restauration UNE fois au
 * montage (client uniquement → pas de mismatch SSR), puis persistance à chaque
 * changement des `deps` — en sautant le tout premier run (montage, AVANT que la
 * restauration n'ait été appliquée) pour ne pas écraser la valeur stockée avec
 * les valeurs par défaut. La validation du contenu restauré (ids encore valides…)
 * reste dans le callback `restore` de chaque grille.
 */
export function usePersistedAgendaView<V extends object>(opts: {
  storageKey: string;
  /** Applique la vue stockée (null = rien en storage / JSON invalide). */
  restore: (stored: Partial<V> | null) => void;
  /** Instantané à persister (relu à chaque déclenchement). */
  snapshot: () => V;
  /** Déclencheurs de persistance (valeurs de la vue). */
  deps: readonly unknown[];
}) {
  const persistSkip = useRef(true);
  const restoreRef = useRef(opts.restore);
  restoreRef.current = opts.restore;
  const snapshotRef = useRef(opts.snapshot);
  snapshotRef.current = opts.snapshot;
  // biome-ignore lint/correctness/useExhaustiveDependencies: restauration au montage uniquement
  useEffect(() => {
    let stored: Partial<V> | null = null;
    try {
      const raw = sessionStorage.getItem(opts.storageKey);
      if (raw) stored = JSON.parse(raw) as Partial<V>;
    } catch {}
    restoreRef.current(stored);
  }, []);
  useEffect(() => {
    if (persistSkip.current) {
      persistSkip.current = false;
      return;
    }
    try {
      sessionStorage.setItem(opts.storageKey, JSON.stringify(snapshotRef.current()));
    } catch {}
  }, [opts.storageKey, ...opts.deps]);
}
