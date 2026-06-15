import { EchangesConfig } from "@/app/(admin)/echanges/echanges-config";
import { SYSTEM_MAIL_KINDS, getMailRows } from "@/app/(admin)/echanges/mail-rows";
import { TEMPLATE_KINDS } from "@/server/services/mail-templates";
import { getService } from "@/server/services/services";
import { notFound } from "next/navigation";
import { ParamsSubnav } from "../params-subnav";

// Sous-onglet « Échanges » des Paramètres d'un service : personnalisation des e-mails liés
// aux réservations, PROPRES À CE SERVICE (gabarits + activation). À défaut de personnalisation,
// le gabarit par défaut intégré est utilisé. Les e-mails système restent globaux (Messagerie).
export default async function ServiceEchangesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const service = await getService(id);
  if (!service) notFound();

  const system = new Set<string>(SYSTEM_MAIL_KINDS);
  const bookingKinds = TEMPLATE_KINDS.filter((k) => !system.has(k));
  const rows = await getMailRows(bookingKinds, id);

  return (
    <div>
      <ParamsSubnav serviceId={id} />
      <EchangesConfig
        rows={rows}
        serviceId={id}
        intro={`Contenu et envoi des e-mails de réservation, propres au service « ${service.label} ». Décocher « Envoyer » désactive ce type d'e-mail pour ce service uniquement (les réservations continuent de fonctionner). À défaut de personnalisation du contenu, le gabarit par défaut est utilisé.`}
      />
    </div>
  );
}
