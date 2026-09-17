"use client";

import dynamic from "next/dynamic";
import { type ComponentProps, useEffect, useState } from "react";
import type { OnboardingModal as OnboardingModalType } from "@/components/onboarding-modal";
import { ONBOARDING_REPLAY_EVENT } from "@/components/onboarding-replay-event";

// Chargement PARESSEUX de la modale de bienvenue (audit perf 2026-09-17). Le composant
// (~1 000 lignes d'étapes, illustrations et maquettes) était importé statiquement par les
// trois layouts et rendu `open={false}` pour la quasi-totalité des usagers : son code
// partait dans le bundle initial de chaque page connectée sans jamais servir. Il est
// désormais dans son propre morceau, chargé uniquement quand il doit s'afficher.
//
// SSR conservé (pas de `ssr: false`) : pour un NOUVEL usager (open = true), la modale est
// rendue côté serveur comme avant — pas de délai ni de « saut » à l'hydratation.
const OnboardingModal = dynamic(() =>
  import("@/components/onboarding-modal").then((m) => m.OnboardingModal),
);

type Props = ComponentProps<typeof OnboardingModalType>;

/**
 * Enveloppe client des layouts : ne MONTE la modale que lorsqu'elle doit apparaître —
 * 1re connexion (`open`) ou « Revoir la présentation » (événement global). La modale
 * elle-même n'est pas montée tant que rien ne la demande : c'est donc cette enveloppe
 * qui écoute l'événement de rejeu et qui, une fois la modale montée, lui passe `open`
 * vrai (son listener interne prend ensuite le relais pour les rejeux suivants, la modale
 * restant montée fermée après « Terminer »). Chunk absent → l'événement est perdu ?
 * Non : `replayed` reste vrai, la modale se monte ouverte dès que le morceau arrive.
 */
export function OnboardingModalLazy(props: Props) {
  const [replayed, setReplayed] = useState(false);
  useEffect(() => {
    const onReplay = () => setReplayed(true);
    window.addEventListener(ONBOARDING_REPLAY_EVENT, onReplay);
    return () => window.removeEventListener(ONBOARDING_REPLAY_EVENT, onReplay);
  }, []);
  if (!props.open && !replayed) return null;
  return <OnboardingModal {...props} open={props.open || replayed} />;
}
