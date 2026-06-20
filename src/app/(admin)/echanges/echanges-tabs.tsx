"use client";

import { useState } from "react";
import { EchangesConfig, type KindData } from "./echanges-config";
import { MailRoutingTable } from "./mail-routing-table";
import type { RoutingRow } from "./mail-rows";

/**
 * Onglet « Échanges » (ADMINISTRATION), GLOBAL, scindé en deux sous-onglets :
 *  - « Échanges par mail » : routage action → type d'e-mail + destinataire + envoi (par action),
 *    réglages COMMUNS à tous les services ;
 *  - « Modèles d'e-mails » : contenu (objet + corps) de tous les e-mails au niveau global
 *    (surchargeable par service dans les Paramètres de chaque service).
 */
export function EchangesAdminTabs({
  routingRows,
  kindOptions,
  modeleRows,
}: {
  routingRows: RoutingRow[];
  kindOptions: { value: string; label: string }[];
  modeleRows: KindData[];
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
              Échanges par mail
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
            Pour chaque action, choisissez le type d&apos;e-mail envoyé, son destinataire et
            activez/désactivez son envoi. Ces réglages sont{" "}
            <strong>communs à tous les services</strong>. Le contenu de chaque type se règle dans
            «&nbsp;Modèles d&apos;e-mails&nbsp;».
          </p>
          <MailRoutingTable rows={routingRows} kindOptions={kindOptions} />
        </div>
      ) : (
        <EchangesConfig
          // Remonte le composant quand l'ensemble des types change (création/suppression).
          key={modeleRows.map((r) => r.kind).join(",")}
          rows={modeleRows}
          showSystem
          showRecipient
          showSend={false}
          allowCreate
          title="Modèles d'e-mails"
          panelId="admin-modeles-panel"
          intro={
            <>
              Contenu (objet + corps) de tous les e-mails au niveau <strong>global</strong>. Les
              e-mails <strong>système</strong> (compte/sécurité, test) sont{" "}
              <strong>toujours envoyés</strong> ; les e-mails de <strong>réservation</strong>{" "}
              servent de base à <strong>tous les services</strong> (surchargeable par service) —
              leur destinataire et leur envoi se règlent dans «&nbsp;Échanges par mail&nbsp;». Vous
              pouvez aussi créer des types <strong>personnalisés globaux</strong>, routables
              partout.
            </>
          }
        />
      )}
    </>
  );
}
