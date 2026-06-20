"use client";

import { useState } from "react";
import { EchangesConfig, type KindData } from "./echanges-config";
import { MailRoutingTable } from "./mail-routing-table";
import type { RoutingRow } from "./mail-rows";

/**
 * Onglet « Échanges » d'un service, scindé en deux sous-onglets :
 *  - « Échanges par mail » : routage action → type d'e-mail + activation (par action) ;
 *  - « Modèles d'e-mails » : contenu (objet + corps) de chaque type d'e-mail.
 */
export function EchangesTabs({
  serviceId,
  serviceLabel,
  routingRows,
  kindOptions,
  modeleRows,
  canManage = false,
}: {
  serviceId: string;
  serviceLabel: string;
  routingRows: RoutingRow[];
  kindOptions: { value: string; label: string }[];
  modeleRows: KindData[];
  // Création/suppression de types personnalisés (propres au service) : gestionnaire du service ou admin.
  canManage?: boolean;
}) {
  const [tab, setTab] = useState<"routage" | "modeles">("routage");

  return (
    <>
      <nav id="params-subnav" aria-label="Sous-navigation des échanges">
        <button
          type="button"
          className={`params-tab${tab === "routage" ? " active" : ""}`}
          aria-current={tab === "routage" ? "page" : undefined}
          onClick={() => setTab("routage")}
        >
          <span aria-hidden="true">📨</span> Échanges par mail
        </button>
        <button
          type="button"
          className={`params-tab${tab === "modeles" ? " active" : ""}`}
          aria-current={tab === "modeles" ? "page" : undefined}
          onClick={() => setTab("modeles")}
        >
          <span aria-hidden="true">✏️</span> Modèles d&apos;e-mails
        </button>
      </nav>

      {tab === "routage" ? (
        <div className="panel">
          <div className="panel-title">
            <span style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
              <span className="dot" style={{ background: "var(--accent)" }} />
              Échanges par mail — {serviceLabel}
            </span>
          </div>
          <p
            style={{
              fontSize: ".85rem",
              lineHeight: 1.5,
              color: "var(--muted)",
              margin: "0 0 1rem",
            }}
          >
            Pour chaque action, choisissez le type d&apos;e-mail envoyé et activez/désactivez son
            envoi (propre à ce service). Le contenu de chaque type se règle dans «&nbsp;Modèles
            d&apos;e-mails&nbsp;».
          </p>
          <MailRoutingTable rows={routingRows} kindOptions={kindOptions} serviceId={serviceId} />
        </div>
      ) : (
        <EchangesConfig
          // Remonte le composant quand l'ensemble des types change (création/suppression)
          // pour réinitialiser l'état d'édition interne sur les nouvelles lignes.
          key={modeleRows.map((r) => r.kind).join(",")}
          rows={modeleRows}
          serviceId={serviceId}
          showSend={false}
          allowCreate={canManage}
          title="Modèles d'e-mails"
          panelId="modeles-panel"
          intro={
            canManage
              ? "Contenu (objet + corps) de chaque type d'e-mail, propre à ce service. Vous pouvez aussi créer des types personnalisés propres à ce service, routables vers une action dans « Échanges par mail »."
              : "Contenu (objet + corps) de chaque type d'e-mail de réservation, propre à ce service. À défaut de personnalisation, le gabarit par défaut intégré est utilisé."
          }
        />
      )}
    </>
  );
}
