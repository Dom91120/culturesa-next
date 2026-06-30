"use client";

import { type ReactNode, useEffect, useState } from "react";
import { ModalOverlay } from "@/components/agenda-shared";
import { markOnboardedAction } from "./onboarding-actions";

/** Événement global pour ré-ouvrir l'onboarding (« Revoir la présentation » du user-menu). */
export const ONBOARDING_REPLAY_EVENT = "culturesa:onboarding-replay";

type Step = { title: string; body: ReactNode };
type ServiceLite = { label: string; icon: string | null };

/** Énumération française : « A », « A et B », « A, B et C ». */
function listFr(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} et ${items[items.length - 1]}`;
}

/* ── Illustrations ────────────────────────────────────────────────────────────────────
   Le menu de gauche est une vraie capture (public/onboarding/services-sidebar.png) : la barre
   est toujours sombre (thèmes clair et sombre), donc cohérente partout. Les autres visuels
   sont reproduits en HTML/CSS (suivent le thème). */

/** Capture (recadrée) de la barre de gauche listant les services. */
function SidebarShot() {
  return (
    // Capture statique d'illustration (pas next/image : taille fixe, pas d'optimisation utile).
    <img
      src="/onboarding/services-sidebar.png"
      alt="Le menu de gauche listant les services disponibles"
      width={319}
      height={300}
      // La capture est déjà une carte aux coins arrondis (fond transparent autour) :
      // pas de bordure/borderRadius ajoutés, qui déborderaient des coins.
      style={{
        display: "block",
        width: "100%",
        maxWidth: 205,
        height: "auto",
        margin: ".55rem auto 0",
      }}
    />
  );
}

/** Petit compteur « − N + » + libellé, comme sur le badge de réservation. */
function CounterMock({ n, label }: { n: number; label: string }) {
  const round: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 18,
    height: 18,
    borderRadius: "50%",
    fontSize: ".8rem",
    fontWeight: 700,
    color: "#9a7b3a",
  };
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: ".15rem" }}>
        <span style={round}>−</span>
        <span style={{ fontSize: ".95rem", fontWeight: 700, color: "#7a6326", minWidth: 12 }}>
          {n}
        </span>
        <span style={round}>+</span>
      </span>
      <span style={{ fontSize: ".58rem", color: "#9a7b3a", fontWeight: 700 }}>{label}</span>
    </span>
  );
}

/** Badge « ma réservation » miniature (jauge participants), pour l'étape « Réserver ». */
function GaugeMock() {
  return (
    <div style={{ display: "flex", justifyContent: "center", margin: ".5rem 0 0" }}>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: ".7rem",
          background: "rgba(232,164,90,.16)",
          border: "1px solid rgba(232,164,90,.5)",
          borderRadius: 12,
          padding: ".35rem .7rem",
        }}
      >
        <CounterMock n={2} label="Enfants" />
        <span aria-hidden style={{ fontSize: "1rem" }}>
          ⏳
        </span>
        <CounterMock n={1} label="Adulte" />
      </div>
    </div>
  );
}

/** Créneau libre cliquable (réservation SANS jauge : pas de compteurs de participants). */
function FreeSlotMock() {
  return (
    <div style={{ display: "flex", justifyContent: "center", margin: ".5rem 0 0" }}>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: ".5rem",
          background: "rgba(232,164,90,.12)",
          border: "1.5px dashed rgba(232,164,90,.65)",
          borderRadius: 10,
          padding: ".45rem .85rem",
          fontSize: ".85rem",
          color: "var(--text)",
        }}
      >
        <span aria-hidden style={{ fontSize: "1.1rem" }}>
          📅
        </span>
        <span>
          Créneau libre · <strong>10 places</strong>
        </span>
      </div>
    </div>
  );
}

/** Légende des statuts (en attente / validée), comme sous l'agenda. */
function LegendMock() {
  const chip = (bg: string, fg: string): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 20,
    height: 20,
    borderRadius: 6,
    background: bg,
    color: fg,
    fontSize: ".8rem",
    flexShrink: 0,
  });
  const row: React.CSSProperties = { display: "flex", alignItems: "center", gap: ".5rem" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: ".4rem", margin: ".5rem 0 0" }}>
      <div style={row}>
        <span style={chip("rgba(232,164,90,.2)", "#9a7b3a")} aria-hidden>
          ⏳
        </span>
        <span style={{ fontSize: ".82rem" }}>Demande en attente de validation</span>
      </div>
      <div style={row}>
        <span
          style={chip("color-mix(in srgb, var(--accent) 22%, transparent)", "var(--accent)")}
          aria-hidden
        >
          ✓
        </span>
        <span style={{ fontSize: ".82rem" }}>Réservation validée</span>
      </div>
    </div>
  );
}

/* ── Contenu des étapes ──────────────────────────────────────────────────────────────── */

const P: React.CSSProperties = { margin: "0 0 .55rem" };

/** Étapes « usager » : enrichies (multi-services + illustrations). Dépend des services et de
 *  la présence d'une jauge (créneau AVEC ou SANS compteurs de participants). */
function usagerSteps(services: ServiceLite[], hasGauge: boolean): Step[] {
  const names = services.map((s) => s.label);
  return [
    {
      title: "Bienvenue sur CultuRésa 👋",
      body: "Réservez vos activités culturelles en quelques clics. Voici l'essentiel pour démarrer.",
    },
    {
      title: "Plusieurs services à votre disposition 🏛️",
      body: (
        <>
          <p style={P}>
            Vous pouvez réserver des activités auprès de{" "}
            <strong>{names.length > 1 ? "plusieurs services" : "votre service"}</strong>
            {names.length ? (
              <>
                {" "}
                : <strong>{listFr(names)}</strong>
              </>
            ) : null}
            .
          </p>
          <p style={{ ...P, marginBottom: 0 }}>
            Pour commencer, choisissez celui qui vous intéresse dans le{" "}
            <strong>menu de gauche</strong> :
          </p>
          <SidebarShot />
        </>
      ),
    },
    {
      title: "Réserver un créneau 📆",
      body: hasGauge ? (
        <>
          <p style={P}>
            Sur l'agenda du service, cliquez sur un <strong>créneau libre</strong>, ajustez le
            nombre de participants avec les boutons <strong>−</strong> et <strong>+</strong>, puis
            enregistrez votre sélection.
          </p>
          <GaugeMock />
        </>
      ) : (
        <>
          <p style={P}>
            Sur l'agenda du service, cliquez sur un <strong>créneau libre</strong>, puis enregistrez
            votre réservation.
          </p>
          <FreeSlotMock />
        </>
      ),
    },
    {
      title: "Suivre vos réservations ✅",
      body: (
        <>
          <p style={P}>Vos réservations apparaissent directement sur l'agenda :</p>
          <LegendMock />
          <p style={{ ...P, margin: ".55rem 0 0" }}>
            Vous pouvez les annuler si besoin, et imprimer votre liste 🖨 depuis l'écran
            Réservations.
          </p>
        </>
      ),
    },
  ];
}

// Étapes des rôles à périmètre étendu (texte simple, pas d'illustration).
const STAFF_STEPS: Record<"gestionnaire" | "administrateur", Step[]> = {
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
  services = [],
  hasGauge = true,
}: {
  variant: "usager" | "gestionnaire" | "administrateur";
  open: boolean;
  // Services réservables (variant « usager ») : cités et illustrés dans la présentation.
  services?: ServiceLite[];
  // Le demandeur a-t-il une jauge ? Adapte l'étape « Réserver » (avec/sans compteurs).
  hasGauge?: boolean;
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

  const steps = variant === "usager" ? usagerSteps(services, hasGauge) : STAFF_STEPS[variant];
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
        <div
          style={{
            fontSize: ".88rem",
            lineHeight: 1.6,
            color: "var(--text)",
            minHeight: 150,
          }}
        >
          {cur.body}
        </div>

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
