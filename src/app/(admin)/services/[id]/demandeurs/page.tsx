import { prisma } from "@/server/db";
import { getServiceDemandeurSettings } from "@/server/services/demandeur-settings";
import { getService } from "@/server/services/services";
import { notFound } from "next/navigation";
import { ParamsSubnav } from "../params-subnav";
import { DemandeurSettingsPanel } from "./demandeur-settings-panel";

export default async function DemandeursPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const service = await getService(id);
  if (!service) notFound();

  const [initialRows, allDemandeurs] = await Promise.all([
    getServiceDemandeurSettings(id),
    prisma.demandeur.findMany({
      orderBy: { label: "asc" },
      select: { id: true, label: true },
    }),
  ]);

  return (
    <div>
      <ParamsSubnav serviceId={id} />
      <DemandeurSettingsPanel
        serviceId={id}
        allDemandeurs={allDemandeurs}
        initialRows={initialRows}
      />
    </div>
  );
}
