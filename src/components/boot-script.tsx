"use client";

import { useSyncExternalStore } from "react";

// Script anti-FOUC du layout racine : applique le thème sombre et l'état replié
// de la sidebar AVANT le premier paint (lecture localStorage + matchMedia).
const BOOT_CODE =
  "try{if(localStorage.getItem('theme')==='dark')document.documentElement.classList.remove('light');if(!matchMedia('(max-width: 640px)').matches&&(localStorage.getItem('sidebar-collapsed')==='1'||matchMedia('(max-width: 1000px)').matches))document.documentElement.classList.add('sb-collapsed');}catch(e){}";

const noopSubscribe = () => () => {};

/**
 * Rend le script anti-FOUC UNIQUEMENT côté serveur : il sort dans le HTML initial
 * (inline, bloquant → exécuté par le parseur avant le premier paint), puis React le
 * RETIRE au premier rendu client — sans avertissement de mismatch, grâce au double
 * instantané serveur/client de useSyncExternalStore (pattern documenté React).
 *
 * Pourquoi : un <script> inline rendu côté client déclenche l'avertissement React 19
 * « Encountered a script tag while rendering React component » à chaque re-rendu de
 * l'arbre (récupération d'erreur en dev, notamment pendant les pannes de base ou les
 * rechargements massifs). En ne rendant JAMAIS le script côté client (y compris après
 * un remontage par error boundary), l'avertissement devient impossible. Le retrait du
 * nœud après hydratation est sans effet : le script a déjà été exécuté au parsing, et
 * les classes qu'il pose vivent sur <html>.
 */
export function BootScript() {
  const isServer = useSyncExternalStore(
    noopSubscribe,
    () => false,
    () => true,
  );
  if (!isServer) return null;
  return (
    <script
      // biome-ignore lint/security/noDangerouslySetInnerHtml: script inline statique, sans donnée externe.
      dangerouslySetInnerHTML={{ __html: BOOT_CODE }}
    />
  );
}
