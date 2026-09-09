import { notFound } from "next/navigation";
import { EchangesConfig } from "@/app/(admin)/echanges/echanges-config";
import { getModeleRows } from "@/app/(admin)/echanges/mail-rows";
import { getService } from "@/server/services/services";
import { ParamsSubnav } from "../params-subnav";

// Onglet « Échanges » des Paramètres d'un service : CONTENU (objet + corps) des e-mails de
// réservation, propre au service (surcharge du contenu global). Le routage / le destinataire /
// l'envoi des actions sont GLOBAUX (Administration › Échanges › « Échanges par mail ») ; la
// création de types personnalisés est centralisée en administration (types globaux).
export default async function ServiceEchangesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = await getService(id);
  if (!service) notFound();

  const modeleRows = await getModeleRows(id);

  return (
    <div>
      <ParamsSubnav serviceId={id} />
      <EchangesConfig
        // Remonte le composant si l'ensemble des types change.
        key={modeleRows.map((r) => r.kind).join(",")}
        rows={modeleRows}
        serviceId={id}
        allowCreate={false}
        title="Modèles d'e-mails"
        panelId="modeles-panel"
        intro="Contenu (objet et corps) de chaque e-mail de réservation, propre à ce service. « Par défaut » : le contenu global (Administration › Échanges) est utilisé ; « modifié » : ce service a son propre texte. Le routage, le destinataire et l'envoi des actions sont communs à tous les services (Administration › Échanges › « Échanges par mail »)."
      />
    </div>
  );
}
