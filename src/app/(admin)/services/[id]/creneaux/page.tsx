import { getCreneauxData } from "@/server/services/slots";
import { notFound } from "next/navigation";
import { CreneauxPanel } from "./creneaux-panel";

export default async function CreneauxPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getCreneauxData(id);
  if (!data) notFound();
  return <CreneauxPanel serviceId={id} data={data} />;
}
