import { EchangesTabs } from "@/app/(admin)/echanges/echanges-tabs";
import { getKindOptions, getModeleRows, getRoutingRows } from "@/app/(admin)/echanges/mail-rows";
import { canManageService } from "@/server/guards";
import { getService } from "@/server/services/services";
import { notFound } from "next/navigation";
import { ParamsSubnav } from "../params-subnav";

// Onglet « Échanges » des Paramètres d'un service, en deux sous-onglets :
//  - « Échanges par mail » : routage action → type d'e-mail (re-routable) + envoi par action ;
//  - « Modèles d'e-mails » : contenu par type d'e-mail (+ création de types personnalisés).
export default async function ServiceEchangesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const service = await getService(id);
  if (!service) notFound();

  const [canManage, routingRows, modeleRows, kindOptions] = await Promise.all([
    canManageService(id),
    getRoutingRows(id),
    getModeleRows(id),
    getKindOptions(id),
  ]);

  return (
    <div>
      <ParamsSubnav serviceId={id} />
      <EchangesTabs
        serviceId={id}
        serviceLabel={service.label}
        routingRows={routingRows}
        kindOptions={kindOptions}
        modeleRows={modeleRows}
        canManage={canManage}
      />
    </div>
  );
}
