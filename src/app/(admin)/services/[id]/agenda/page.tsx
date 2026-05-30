import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { AgendaGrid } from "./agenda-grid";

export default async function AgendaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = await prisma.service.findUnique({
    where: { id },
    select: {
      id: true,
      label: true,
      activeDays: true,
      morningStart: true,
      afternoonEnd: true,
      recurCapacity: true,
    },
  });
  if (!service) notFound();

  const [periods, slots, bookings, users] = await Promise.all([
    prisma.period.findMany({
      where: { OR: [{ serviceId: null }, { serviceId: id }], state: "actif" },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { id: true, label: true, color: true },
    }),
    prisma.slot.findMany({
      where: { serviceId: id, slotType: "recurring", state: "actif" },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        capacity: true,
        capLun: true,
        capMar: true,
        capMer: true,
        capJeu: true,
        capVen: true,
        capSam: true,
        capDim: true,
      },
    }),
    prisma.booking.findMany({
      where: { serviceId: id, bookingType: "recurring" },
      select: {
        id: true,
        slotId: true,
        periodId: true,
        dayKey: true,
        enfants: true,
        themeLabel: true,
        validated: true,
        pointage: true,
        user: { select: { nom: true, prenom: true, demandeur: { select: { label: true } } } },
      },
    }),
    prisma.user.findMany({
      where: { role: "utilisateur" },
      orderBy: [{ nom: "asc" }, { prenom: "asc" }],
      select: { id: true, nom: true, prenom: true, demandeur: { select: { label: true } } },
    }),
  ]);

  const usersData = users.map((u) => ({
    id: u.id,
    label: `${u.nom} ${u.prenom}`.trim() + (u.demandeur ? ` — ${u.demandeur.label}` : ""),
  }));

  const bookingsData = bookings.map((b) => ({
    id: b.id,
    slotId: b.slotId,
    periodId: b.periodId,
    dayKey: b.dayKey,
    enfants: b.enfants,
    theme: b.themeLabel,
    validated: b.validated,
    pointage: b.pointage,
    name: `${b.user.nom} ${b.user.prenom}`.trim() || "—",
    demandeur: b.user.demandeur?.label ?? "",
  }));

  return (
    <AgendaGrid
      service={service}
      periods={periods}
      slots={slots}
      bookings={bookingsData}
      users={usersData}
    />
  );
}
