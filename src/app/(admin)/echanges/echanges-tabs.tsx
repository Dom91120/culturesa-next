"use client";

import { useState } from "react";
import { FileCodeGlyph, InfoGlyph, MailForwardGlyph } from "@/components/ui-glyphs";
import { EchangesConfig, type KindData } from "./echanges-config";
import { MailRoutingTable } from "./mail-routing-table";
import type { RoutingRow } from "./mail-rows";
import { ValidationNoticeDelayField } from "./validation-notice-delay";

/**
 * Onglet « Échanges » (ADMINISTRATION), GLOBAL, scindé en deux sous-onglets :
 *  - « Échanges par mail » : routage action → type d'e-mail + destinataire + envoi (par action),
 *    réglages COMMUNS à tous les services ;
 *  - « Modèles d'e-mails » : contenu (objet + corps) de tous les e-mails au niveau global
 *    (surchargeable par service dans les Paramètres de chaque service).
 * Refonte Dom 2026-09-09 : pictogrammes SVG, en-tête avec pastille de portée, réglage du
 * délai sur une ligne, explication en pied de panneau (plus de paragraphe d'introduction).
 */
export function EchangesAdminTabs({
  routingRows,
  kindOptions,
  modeleRows,
  validationNoticeDelay,
}: {
  routingRows: RoutingRow[];
  kindOptions: { value: string; label: string }[];
  modeleRows: KindData[];
  // Délai de regroupement des notifications de validation (minutes, 0 = immédiat).
  validationNoticeDelay: number;
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
          <MailForwardGlyph size={14} /> Échanges par mail
        </button>
        <button
          type="button"
          className={`params-tab${tab === "modeles" ? " active" : ""}`}
          aria-current={tab === "modeles" ? "page" : undefined}
          onClick={() => setTab("modeles")}
        >
          <FileCodeGlyph size={14} /> Modèles d&apos;e-mails
        </button>
      </nav>

      {tab === "routage" ? (
        <div className="panel">
          <div
            className="panel-title"
            style={{ justifyContent: "space-between", gap: ".75rem", marginBottom: ".5rem" }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
              <span className="rg-ico is-ok">
                <MailForwardGlyph size={16} />
              </span>
              Échanges par mail
            </span>
            <span className="ms-pill is-ok" title="Ces réglages valent pour tous les services">
              commun à tous les services
            </span>
          </div>
          <ValidationNoticeDelayField initial={validationNoticeDelay} />
          <MailRoutingTable rows={routingRows} kindOptions={kindOptions} />
          <div className="rg-foot">
            <InfoGlyph size={13} />
            <span style={{ flex: 1, lineHeight: 1.45 }}>
              La pastille devant chaque action dit qui la déclenche : l&apos;usager (vert), un
              gestionnaire (orange) ou un automatisme (gris). Le destinataire « Le service » désigne
              l&apos;e-mail de contact du service s&apos;il est renseigné dans le référentiel
              Services, sinon les comptes de ses gestionnaires. Le contenu de chaque type se règle
              dans « Modèles d&apos;e-mails ».
            </span>
          </div>
        </div>
      ) : (
        <EchangesConfig
          // Remonte le composant quand l'ensemble des types change (création/suppression).
          key={modeleRows.map((r) => r.kind).join(",")}
          rows={modeleRows}
          allowCreate
          title="Modèles d'e-mails"
          panelId="admin-modeles-panel"
          intro={
            <>
              Contenu (objet et corps) de tous les e-mails au niveau global. « Par défaut » : le
              texte livré avec l&apos;application ; « modifié » : un texte retouché ici, que «
              Réinitialiser » dans l&apos;éditeur ramène au défaut. Les e-mails de compte et de
              sécurité sont toujours envoyés ; ceux de réservation servent de base à tous les
              services (surchargeable dans chaque service) et la pastille compte les actions qui les
              utilisent dans « Échanges par mail ». Un type personnalisé, routable partout, peut
              être supprimé tant qu&apos;aucune action ne l&apos;utilise.
            </>
          }
        />
      )}
    </>
  );
}
