import { requireRole } from "@/server/guards";
import { EchangesConfig } from "./echanges-config";
import { SYSTEM_MAIL_KINDS, getGlobalModeleRows, getMailRows } from "./mail-rows";

// Onglet « Échanges » (administration) : un tableau UNIQUE des gabarits d'e-mails globaux —
//  - e-mails système (compte/sécurité + test) : toujours envoyés, destinataire intrinsèque ;
//  - e-mails de réservation (intégrés, base tous services) + types personnalisés GLOBAUX,
//    dont le destinataire/envoi se règlent PAR ACTION dans « Échanges par mail » de chaque service.
export default async function EchangesAdminPage() {
  // Réservé aux administrateurs (les gestionnaires gèrent les modèles de leurs services).
  await requireRole("administrateur");

  const [autoMailRows, globalModeleRows] = await Promise.all([
    getMailRows(SYSTEM_MAIL_KINDS),
    getGlobalModeleRows(),
  ]);
  // Système d'abord (toujours envoyés), puis réservation (intégrés + globaux personnalisés).
  const rows = [...autoMailRows, ...globalModeleRows];

  return (
    <EchangesConfig
      // Remonte le composant quand l'ensemble des types change (création/suppression).
      key={rows.map((r) => r.kind).join(",")}
      rows={rows}
      title="Modèles d'e-mails"
      panelId="admin-modeles-panel"
      showSystem
      showRecipient
      showSend={false}
      allowCreate
      intro={
        <>
          Contenu (objet + corps) de tous les e-mails au niveau <strong>global</strong>. Les e-mails{" "}
          <strong>système</strong> (compte/sécurité, test) sont <strong>toujours envoyés</strong> ;
          les e-mails de <strong>réservation</strong> servent de base à{" "}
          <strong>tous les services</strong> (surchargeable par service) — leur destinataire et leur
          envoi se règlent <strong>par service</strong> dans « Échanges par mail ». Vous pouvez
          aussi créer des types <strong>personnalisés globaux</strong>, routables partout.
        </>
      }
    />
  );
}
