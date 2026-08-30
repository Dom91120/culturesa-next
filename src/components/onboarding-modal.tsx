"use client";

import { type ReactNode, useEffect, useState } from "react";
import { ModalOverlay } from "@/components/agenda-shared";
import { markOnboardedAction } from "./onboarding-actions";

/** Événement global pour ré-ouvrir l'onboarding (« Revoir la présentation » du user-menu). */
export const ONBOARDING_REPLAY_EVENT = "culturesa:onboarding-replay";

// `image` (optionnel) : illustration de fin d'étape, rendue sous le texte dans un
// conteneur extensible qui la CENTRE verticalement dans l'espace restant du corps.
type Step = { title: string; body: ReactNode; image?: ReactNode };
type ServiceLite = { label: string };

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

/** Capture de l'agenda en mode création : un créneau tracé (bloc orangé pointillé « 10:00–11:00 »)
 *  avec le curseur main illustrant le geste. public/onboarding/slot-create.png. */
function SlotCreateShot() {
  return (
    <div style={{ display: "flex", justifyContent: "center", margin: ".5rem 0 0" }}>
      {/* Capture statique d'illustration (pas next/image : taille fixe, pas d'optimisation utile). */}
      <img
        src="/onboarding/slot-create.png"
        alt="Un créneau 10:00–11:00 tracé sur l'agenda en mode création"
        style={{
          display: "block",
          width: "100%",
          maxWidth: 260,
          height: "auto",
          borderRadius: 8,
          border: "1px solid var(--border)",
        }}
      />
    </div>
  );
}

/** Barre d'options de l'agenda avec « Mode validation » coché. public/onboarding/validation-mode.png. */
function ValidationModeShot() {
  return (
    <div style={{ display: "flex", justifyContent: "center", margin: ".5rem 0 0" }}>
      {/* Capture statique d'illustration (pas next/image : taille fixe, pas d'optimisation utile). */}
      <img
        src="/onboarding/validation-mode.png"
        alt="Barre d'options de l'agenda, « Mode validation » activé"
        style={{
          display: "block",
          width: "100%",
          maxWidth: 280,
          height: "auto",
          borderRadius: 8,
          border: "1px solid var(--border)",
        }}
      />
    </div>
  );
}

/** Modale « Nouvelle réservation » (réserver pour un usager). public/onboarding/reservation-create.png. */
function ReservationCreateShot() {
  return (
    <div style={{ display: "flex", justifyContent: "center", margin: ".5rem 0 0" }}>
      {/* Capture statique d'illustration (pas next/image : taille fixe, pas d'optimisation utile). */}
      <img
        src="/onboarding/reservation-create.png"
        alt="Modale de création d'une réservation pour un usager"
        // Capture détourée à coins arrondis (fond transparent autour) : pas de bordure/borderRadius
        // ajoutés, qui déborderaient des coins (cf. SidebarShot).
        style={{ display: "block", width: "100%", maxWidth: 320, height: "auto" }}
      />
    </div>
  );
}

/** Barre d'options de l'agenda avec « Mode pointage » coché. public/onboarding/pointage-mode.png. */
function PointageModeShot() {
  return (
    <div style={{ display: "flex", justifyContent: "center", margin: ".5rem 0 0" }}>
      {/* Capture statique d'illustration (pas next/image : taille fixe, pas d'optimisation utile). */}
      <img
        src="/onboarding/pointage-mode.png"
        alt="Barre d'options de l'agenda, « Mode pointage » activé"
        style={{
          display: "block",
          width: "100%",
          maxWidth: 280,
          height: "auto",
          borderRadius: 8,
          border: "1px solid var(--border)",
        }}
      />
    </div>
  );
}

/** Badge « ma réservation » SANS jauge : capture détourée du badge réel (⏳ + « Demande en
 *  attente de validation »), fond transparent → s'intègre en thème clair comme sombre. */
function ReservationShot() {
  return (
    <div style={{ display: "flex", justifyContent: "center", margin: ".5rem 0 0" }}>
      {/* Capture statique d'illustration (pas next/image : taille fixe, pas d'optimisation utile). */}
      <img
        src="/onboarding/reservation-badge.png"
        alt="Badge de réservation : demande en attente de validation"
        width={266}
        height={63}
        style={{ display: "block", width: "100%", maxWidth: 215, height: "auto" }}
      />
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

/** Icône imprimante — mêmes tracés que le bouton d'impression de l'écran Réservations. */
function PrinterIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      // display:inline-block écrase le preflight Tailwind (svg { display:block }), sinon
      // l'icône passe seule sur sa ligne au lieu de suivre le flux du texte.
      style={{ display: "inline-block", verticalAlign: "-2px", margin: "0 1px" }}
    >
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  );
}

/** Bouton « Mode création » de l'agenda gestionnaire : crayon (couleur danger) dans son contour,
 *  reproduit à l'identique (bordure, rayon, padding) pour être reconnaissable dans le texte. */
function EditIcon() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        verticalAlign: "bottom",
        margin: "0 2px",
        // Mêmes dimensions que le bouton « Mode création » d'origine (agenda gestionnaire).
        padding: ".28rem .38rem",
        border: "1px solid var(--border)",
        borderRadius: "var(--rad-sm)",
        color: "var(--danger)",
      }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        style={{ display: "block" }}
      >
        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
        <path d="m15 5 4 4" />
      </svg>
    </span>
  );
}

/** Maquette du bandeau MOBILE (menu sandwich + avatar) : repère visuel de l'étape
 *  « services » dans la version mobile de la présentation — la capture de la sidebar
 *  desktop n'y correspond à rien. HTML/CSS (suit le thème), comme les autres mocks. */
function BurgerMock({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", margin: ".5rem 0 0" }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: ".5rem", width: "100%", maxWidth: 250 }}
      >
        <span
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: ".5rem",
            background: "var(--surface2)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: ".3rem .7rem",
            fontSize: ".82rem",
            fontWeight: 600,
          }}
        >
          <span aria-hidden>☰</span>
          <span style={{ flex: 1, textAlign: "left", whiteSpace: "nowrap", overflow: "hidden" }}>
            {label}
          </span>
          <span style={{ color: "var(--muted)", fontSize: ".7rem" }} aria-hidden>
            ▾
          </span>
        </span>
        <span
          aria-hidden
          style={{
            width: 26,
            height: 26,
            borderRadius: "50%",
            background:
              "linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 55%, #123c2a))",
            color: "#fff",
            fontWeight: 700,
            fontSize: ".6rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          AB
        </span>
      </div>
    </div>
  );
}

/* ── Contenu des étapes ──────────────────────────────────────────────────────────────── */

const P: React.CSSProperties = { margin: "0 0 .55rem" };

/** Note : quota de réservations par période / an, variable selon le service. */
function QuotaNote() {
  return (
    <p style={{ margin: ".55rem 0 0", fontSize: ".82rem", color: "var(--muted)" }}>
      Selon le service, votre nombre de réservations est <strong>limité par période</strong> (et par
      an) — la limite est rappelée sous l'agenda.
    </p>
  );
}

/** Étapes « usager » : enrichies (multi-services + illustrations). Dépend des services et de
 *  la présence d'une jauge (créneau AVEC ou SANS compteurs de participants).
 *  `isMobile` = VERSION MOBILE de la présentation (demande Dom 2026-08-30) : les repères
 *  desktop (menu de gauche, impression — options masquées sur smartphone) laissent place
 *  aux repères mobiles (menu ☰, maquette du bandeau). */
function usagerSteps(services: ServiceLite[], hasGauge: boolean, isMobile: boolean): Step[] {
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
            Vous pouvez réserver des activités auprès {names.length > 1 ? "de " : "du "}
            <strong>{names.length > 1 ? "plusieurs services" : "service"}</strong>
            {names.length ? "\u00A0:" : "."}
          </p>
          {/* Un service PAR LIGNE (mobile comme desktop — demande Dom 2026-08-30),
              plutôt que l'énumération en ligne qui formait un pavé. */}
          {names.length > 0 && (
            <ul style={{ margin: "0 0 .55rem", paddingLeft: "1.15rem" }}>
              {names.map((n) => (
                <li key={n} style={{ margin: "0 0 .15rem" }}>
                  <strong>{n}</strong>
                </li>
              ))}
            </ul>
          )}
          <p style={{ margin: 0 }}>
            {/* Espace INSÉCABLE avant les deux-points : le « : » ne part plus seul à
                la ligne (typographie française, demande Dom 2026-08-30). */}
            Pour commencer, choisissez le service qui vous intéresse{" "}
            {isMobile ? (
              <>
                via le <strong>menu ☰</strong> en haut de l'écran{"\u00A0"}:
              </>
            ) : (
              <>
                dans le <strong>menu de gauche</strong>{"\u00A0"}:
              </>
            )}
          </p>
        </>
      ),
      image: isMobile ? <BurgerMock label={names[0] ?? "Médiathèque"} /> : <SidebarShot />,
    },
    {
      title: "Créer une réservation 📆",
      body: hasGauge ? (
        <>
          <p style={P}>
            Choisissez une <strong>période</strong> en haut de l'agenda, cliquez sur un{" "}
            <strong>créneau libre</strong>, ajustez le nombre de participants avec les boutons{" "}
            <strong>−</strong> et <strong>+</strong>, puis enregistrez votre sélection.
          </p>
          <GaugeMock />
          <QuotaNote />
        </>
      ) : (
        <>
          <p style={P}>
            Choisissez une <strong>période</strong> en haut de l'agenda, cliquez sur un{" "}
            <strong>créneau libre</strong>, puis enregistrez votre{" "}
            <strong>demande de réservation</strong>.
          </p>
          <ReservationShot />
          <QuotaNote />
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
            {isMobile ? (
              // Mobile : pas de mention de l'impression, ses options sont masquées.
              <>Vous pouvez les annuler si besoin.</>
            ) : (
              <>
                Vous pouvez les annuler si besoin, et imprimer votre liste <PrinterIcon /> depuis
                l'écran Réservations.
              </>
            )}
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
      body: (
        <>
          <p style={P}>
            Vous gérez les services qui vous sont confiés et les réservations de leurs usagers.
          </p>
          <p style={{ margin: 0 }}>
            La première étape <strong>indispensable</strong> consiste à paramétrer votre service.
            Vous renseignez ses périodes et son mode de fonctionnement à partir des onglets{" "}
            <strong>« 🔧 Paramètres »</strong>, <strong>« 🗓️ Périodes et réservations »</strong> et{" "}
            <strong>« ✨ Configuration »</strong>.
          </p>
        </>
      ),
    },
    {
      // La bascule « Modèle de période » / « Semaine réelle » a été retirée : l'agenda
      // n'a plus qu'une vue, la semaine datée (cf. agenda-grid, vue unique).
      title: "Un agenda unique, semaine par semaine 🗓️",
      body: (
        <>
          <p style={P}>
            L'agenda de chaque service affiche une <strong>semaine datée</strong> : créneaux
            récurrents et ponctuels, réservations et pointages s'y gèrent au même endroit,
            semaine après semaine. Naviguez avec les flèches ◀ ▶ et les onglets de période.
          </p>
        </>
      ),
    },
    {
      title: "Créer les créneaux 🗓️",
      body: (
        <>
          <p style={P}>
            Depuis l'agenda d'un service, activez le <strong>« Mode création »</strong> <EditIcon />{" "}
            :
            <br />
            <strong>Commencez par</strong> définir la capacité, la jauge et les demandeurs. Puis
            dessinez un créneau sur le planning, ajustez sa durée en glissant ses bords, ou
            supprimez-le avec la croix. Vous{" "}
            <strong>définissez ainsi l'offre réservable de chaque période</strong>.
          </p>
        </>
      ),
      image: <SlotCreateShot />,
    },
    {
      title: "Réserver pour un utilisateur ✅",
      body: (
        <p style={{ margin: 0 }}>
          Vous pouvez réserver à la place d'un usager : cliquez sur un{" "}
          <strong>créneau libre</strong>, choisissez l'usager, ajustez le nombre de participants,
          puis enregistrez la réservation.
        </p>
      ),
      image: <ReservationCreateShot />,
    },
    {
      title: "Valider les demandes ✅",
      body: (
        <>
          <p style={P}>
            En <strong>« Mode validation »</strong>, validez ou dévalidez les demandes des usagers.
          </p>
        </>
      ),
      image: <ValidationModeShot />,
    },
    {
      title: "Renseigner les pointages 🖊️",
      body: (
        <>
          <p style={P}>
            Dans l'agenda, activez le <strong>« Mode pointage »</strong> pour marquer la
            présence ou l'absence à chaque réservation, semaine après semaine.
          </p>
          <p style={{ margin: 0 }}>
            En cas d'absence, cliquez sur le macaron <strong>A</strong> du badge pour ouvrir la
            fiche et saisir un <strong>motif d'absence</strong> — il est repris dans l'infobulle
            du badge et sur la feuille de pointage.
          </p>
        </>
      ),
      image: <PointageModeShot />,
    },
    {
      title: "Éditions 📋 et Statistiques 📈",
      body: (
        <>
          <p style={P}>
            Une fois vos réservations en place, deux onglets vous aident à les suivre et à les
            exploiter.
          </p>
          <p style={{ margin: 0 }}>
            <strong>« Éditions 📋 »</strong> imprime et exporte la liste des inscrits, la liste des
            réservations, le planning et les feuilles de pointage. <strong>« Statistiques 📈 »</strong> synthétise la
            fréquentation de votre service, exportable en CSV.
          </p>
        </>
      ),
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
  // Version MOBILE de la présentation (même seuil que le reste de l'app) : textes et
  // illustrations adaptés — le contenu suit si l'écran change en cours de route.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

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

  const steps =
    variant === "usager" ? usagerSteps(services, hasGauge, isMobile) : STAFF_STEPS[variant];
  const cur = steps[step];
  const isLast = step >= steps.length - 1;
  const finish = () => {
    setVisible(false);
    void markOnboardedAction();
  };

  return (
    <ModalOverlay onClose={finish} boxStyle={{ maxWidth: 580 }}>
      <div>
        <div className="modal-title" style={{ marginBottom: ".6rem" }}>
          {cur.title}
        </div>
        <div
          style={{
            fontSize: ".88rem",
            // 1,15 : l'interligne par défaut de Microsoft Word (Dom 2026-08-30 —
            // le 1,6 d'origine puis le 1,45 restaient trop aérés à son goût).
            lineHeight: 1.15,
            color: "var(--text)",
            minHeight: 150,
            display: "flex",
            flexDirection: "column",
            // Corps justifié (titres exclus : ils sont dans .modal-title). Les images sont
            // dans des conteneurs flex centrés → non affectées par text-align.
            textAlign: "justify",
          }}
        >
          <div>{cur.body}</div>
          {cur.image && (
            // Conteneur extensible : occupe tout l'espace restant sous le texte et centre
            // l'image verticalement entre le texte (au-dessus) et l'élément suivant (dessous).
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                minHeight: 0,
              }}
            >
              {cur.image}
            </div>
          )}
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
