import { notFound } from "next/navigation";
import { requireServiceManager } from "@/server/guards";
import { getExercicePaneData } from "@/server/services/exercice";
import { getService } from "@/server/services/services";
import { ParamsSubnav } from "../params-subnav";
import { ExercicePanel } from "./exercice-panel";

export default async function ExercicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Paramétrage = gestion uniquement : un rattachement en consultation s'arrête à l'agenda,
  // aux éditions et aux statistiques (le layout du service n'exige que la consultation).
  await requireServiceManager(id);
  // Service et données de l'onglet : indépendants → chargés en parallèle.
  const [service, data] = await Promise.all([getService(id), getExercicePaneData(id)]);
  if (!service) notFound();

  return (
    <div>
      <ParamsSubnav serviceId={id} />
      <ExercicePanel serviceId={id} serviceLabel={service.label} data={data} />
    </div>
  );
}
