import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { AgendaGrid } from "./agenda-grid";

export default async function AgendaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = await prisma.service.findUnique({
    where: { id },
    select: { id: true, label: true, activeDays: true, morningStart: true, afternoonEnd: true },
  });
  if (!service) notFound();

  const periods = await prisma.period.findMany({
    where: { OR: [{ serviceId: null }, { serviceId: id }], state: "actif" },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { id: true, label: true, color: true },
  });

  return <AgendaGrid service={service} periods={periods} />;
}
