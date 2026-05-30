import { prisma } from "@/server/db";
import { DemandeursEditor } from "./demandeurs-editor";

export default async function DemandeursPage() {
  const demandeurs = await prisma.demandeur.findMany({
    orderBy: { label: "asc" },
    select: { id: true, label: true, openOnSchoolHolidays: true },
  });

  return <DemandeursEditor initial={demandeurs} />;
}
