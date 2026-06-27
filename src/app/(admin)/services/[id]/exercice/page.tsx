import { notFound } from "next/navigation";
import { getExercicePaneData } from "@/server/services/exercice";
import { getService } from "@/server/services/services";
import { ParamsSubnav } from "../params-subnav";
import { ExercicePanel } from "./exercice-panel";

export default async function ExercicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Service et données de l'onglet : indépendants → chargés en parallèle.
  const [service, data] = await Promise.all([getService(id), getExercicePaneData(id)]);
  if (!service) notFound();

  return (
    <div>
      <ParamsSubnav serviceId={id} />
      <ExercicePanel serviceId={id} data={data} />
    </div>
  );
}
