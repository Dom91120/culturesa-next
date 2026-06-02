import { getExercicePaneData } from "@/server/services/exercice";
import { getService } from "@/server/services/services";
import { notFound } from "next/navigation";
import { ParamsSubnav } from "../params-subnav";
import { ExercicePanel } from "./exercice-panel";

export default async function ExercicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const service = await getService(id);
  if (!service) notFound();

  const data = await getExercicePaneData(id);

  return (
    <div>
      <ParamsSubnav serviceId={id} />
      <ExercicePanel serviceId={id} data={data} />
    </div>
  );
}
