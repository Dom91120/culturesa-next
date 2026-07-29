"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Ramène l'usager sur l'écran de connexion QUAND sa session expire, au lieu de le
 * laisser découvrir la déconnexion à son geste suivant (devant une page devenue
 * inerte, avec le risque de perdre une saisie en cours).
 *
 * Fonctionnement — l'échéance n'est qu'un RÉVEIL, jamais une décision :
 *   1. `expiresAt` (calculé au rendu serveur) programme un réveil ;
 *   2. au réveil, /api/session-status tranche — cette route lit la session SANS la
 *      prolonger (cf. getSessionNoTouch) ;
 *   3. session éteinte → écran de connexion ; encore valide → on se reprogramme sur
 *      la nouvelle échéance renvoyée.
 *
 * Ce détour par le serveur évite de déconnecter à tort : l'horodatage d'activité
 * étant throttlé (TOUCH_THROTTLE_MS), l'échéance rendue peut être légèrement
 * décalée. Seul le serveur fait foi.
 *
 * `setTimeout` ne suffit pas : il ne se déclenche pas de façon fiable quand l'onglet
 * passe en arrière-plan, ni pendant la veille de la machine. On revérifie donc au
 * retour d'onglet et à la reprise du focus.
 */
export function SessionWatchdog({ expiresAt }: { expiresAt: number }) {
  const router = useRouter();
  // L'échéance évolue : celle du serveur au rendu, puis celles renvoyées par la sonde.
  const [deadline, setDeadline] = useState(expiresAt);
  useEffect(() => setDeadline(expiresAt), [expiresAt]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Une seule sonde en vol à la fois (le réveil et le retour d'onglet peuvent
    // coïncider), et plus rien après le départ vers l'écran de connexion.
    let probing = false;

    const probe = async () => {
      if (cancelled || probing) return;
      probing = true;
      try {
        const r = await fetch("/api/session-status", { cache: "no-store" });
        if (cancelled) return;
        // Sonde injoignable (réseau coupé, serveur qui redémarre) : on ne déconnecte
        // PAS sur un doute — on retentera au prochain réveil.
        if (!r.ok) return;
        const j = (await r.json()) as { active?: unknown; expiresAt?: unknown };
        if (cancelled) return;
        if (j.active === true && typeof j.expiresAt === "number") {
          setDeadline(j.expiresAt);
          return;
        }
        if (j.active === false) {
          cancelled = true;
          router.replace("/auth/login?expired=1");
          router.refresh();
        }
      } catch {
        // idem : un échec réseau ne doit jamais provoquer de déconnexion.
      } finally {
        probing = false;
      }
    };

    const onWake = () => {
      if (document.visibilityState === "visible" && Date.now() >= deadline) void probe();
    };

    timer = setTimeout(() => void probe(), Math.max(0, deadline - Date.now()));
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, [deadline, router]);

  return null;
}
