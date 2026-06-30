"use client";

import { type ReactNode, useEffect, useState } from "react";
import { ModalOverlay } from "@/components/agenda-shared";
import { markOnboardedAction } from "./onboarding-actions";

/** Événement global pour ré-ouvrir l'onboarding (« Revoir la présentation » du user-menu). */
export const ONBOARDING_REPLAY_EVENT = "culturesa:onboarding-replay";

type Step = { title: string; body: ReactNode };

// Contenu adapté au rôle. Volontairement court (3 étapes) — modale de bienvenue.
const STEPS: Record<"usager" | "gestionnaire" | "administrateur", Step[]> = {
  usager: [
    {
      title: "Bienvenue sur CultuRésa 👋",
      body: "Réservez vos activités culturelles en quelques clics. Voici l'essentiel pour démarrer.",
    },
    {
      title: "Réserver un créneau 📆",
      body: "Choisissez un service dans le menu, cliquez sur un créneau libre, ajustez le nombre de participants, puis enregistrez votre sélection.",
    },
    {
      title: "Suivre vos réservations ✅",
      body: "Retrouvez vos réservations validées et vos demandes en attente de validation, annulez-les si besoin, et imprimez votre liste depuis l'écran Réservations.",
    },
  ],
  // Gestionnaire : périmètre LIMITÉ aux services qui lui sont confiés. Pas d'accès au
  // menu Administration (réservé aux administrateurs).
  gestionnaire: [
    {
      title: "Bienvenue 👋",
      body: "Vous gérez les services qui vous sont confiés et les réservations de leurs usagers. Voici l'essentiel.",
    },
    {
      title: "Vos créneaux et réservations 📆",
      body: "Depuis l'agenda d'un service, créez les créneaux, validez ou ajustez les réservations des usagers et renseignez les pointages.",
    },
    {
      title: "Paramétrer et suivre 📊",
      body: "L'onglet « Paramètres » de chaque service gère ses périodes, e-mails et options ; « Éditions » et « Statistiques » en donnent le suivi détaillé.",
    },
  ],
  // Administrateur : périmètre GLOBAL (en plus de la gestion des services).
  administrateur: [
    {
      title: "Bienvenue dans l'administration 👋",
      body: "Vous administrez l'ensemble de l'application : services, comptes et paramètres généraux, en plus de la gestion de chaque service.",
    },
    {
      title: "Configuration et référentiels ⚙️",
      body: "Depuis « Administration », réglez les paramètres généraux et les référentiels : services, demandeurs, structures et niveaux.",
    },
    {
      title: "Comptes, messagerie et RGPD 🛡️",
      body: "Gérez les utilisateurs et leurs rôles, la messagerie (e-mails) et la conservation des données personnelles (RGPD).",
    },
  ],
};

/**
 * Modale de bienvenue affichée à la PREMIÈRE connexion (open = `onboardedAt` null).
 * Contenu selon le rôle. La fermeture (Terminer, Passer, clic-fond, Échap) marque
 * l'onboarding comme vu en base (markOnboardedAction) → ne réapparaît plus.
 */
export function OnboardingModal({
  variant,
  open,
}: {
  variant: "usager" | "gestionnaire" | "administrateur";
  open: boolean;
}) {
  const [visible, setVisible] = useState(open);
  const [step, setStep] = useState(0);

  // Ré-ouverture à la demande depuis le user-menu (« Revoir la présentation ») : on
  // repart de la 1re étape. Le listener reste actif même quand la modale est masquée.
  useEffect(() => {
    const onReplay = () => {
      setStep(0);
      setVisible(true);
    };
    window.addEventListener(ONBOARDING_REPLAY_EVENT, onReplay);
    return () => window.removeEventListener(ONBOARDING_REPLAY_EVENT, onReplay);
  }, []);

  if (!visible) return null;

  const steps = STEPS[variant];
  const cur = steps[step];
  const isLast = step >= steps.length - 1;
  const finish = () => {
    setVisible(false);
    void markOnboardedAction();
  };

  return (
    <ModalOverlay onClose={finish} boxStyle={{ maxWidth: 440 }}>
      <div>
        <div className="modal-title" style={{ marginBottom: ".6rem" }}>
          {cur.title}
        </div>
        <p
          style={{
            fontSize: ".88rem",
            lineHeight: 1.6,
            color: "var(--text)",
            margin: 0,
            minHeight: 78,
          }}
        >
          {cur.body}
        </p>

        {/* Indicateur de progression */}
        <div style={{ display: "flex", justifyContent: "center", gap: 6, margin: ".7rem 0 1rem" }}>
          {steps.map((s, i) => (
            <span
              key={s.title}
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: i === step ? "var(--accent)" : "var(--border)",
              }}
            />
          ))}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: ".6rem",
          }}
        >
          <button
            type="button"
            className="btn btn-ghost"
            onClick={finish}
            style={{ fontSize: ".72rem" }}
          >
            Passer
          </button>
          <div style={{ display: "flex", gap: ".5rem" }}>
            {step > 0 && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setStep((s) => s - 1)}
                style={{ fontSize: ".75rem" }}
              >
                Précédent
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => (isLast ? finish() : setStep((s) => s + 1))}
              style={{ fontSize: ".75rem" }}
            >
              {isLast ? "Commencer" : "Suivant"}
            </button>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}
