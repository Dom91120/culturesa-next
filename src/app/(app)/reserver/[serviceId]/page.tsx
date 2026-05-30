import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { getServiceWithAvailability } from "@/server/services/bookings";
import { requireUser } from "@/server/guards";
import { RecurringBooking } from "./recurring-booking";
import { ReserveSlot } from "./reserve-slot";

const dateFmt = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

export default async function ServiceReservePage({
  params,
}: {
  params: Promise<{ serviceId: string }>;
}) {
  const session = await requireUser();
  const { serviceId } = await params;
  const data = await getServiceWithAvailability(serviceId, session.user.id);
  if (!data) notFound();
  const { service, availability } = data;

  const [allRecurSlots, recurBookings, periods, profile] = await Promise.all([
    prisma.slot.findMany({
      where: { serviceId, slotType: "recurring", state: "actif" },
      orderBy: { startTime: "asc" },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        capacity: true,
        demandeurs: { select: { demandeurId: true } },
      },
    }),
    prisma.booking.findMany({
      where: { serviceId, bookingType: "recurring" },
      select: { id: true, slotId: true, periodId: true, dayKey: true, enfants: true, userId: true },
    }),
    prisma.period.findMany({
      where: { OR: [{ serviceId: null }, { serviceId }], state: "actif" },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { id: true, label: true, color: true },
    }),
    prisma.user.findUnique({ where: { id: session.user.id }, select: { enfants: true, demandeurId: true } }),
  ]);

  // Masque les créneaux réservés à d'autres demandeurs (liste vide = ouvert à tous).
  const recurSlots = allRecurSlots
    .filter(
      (s) =>
        s.demandeurs.length === 0 ||
        s.demandeurs.some((d) => d.demandeurId === (profile?.demandeurId ?? -1)),
    )
    .map((s) => ({ id: s.id, startTime: s.startTime, endTime: s.endTime, capacity: s.capacity }));

  const days = service.activeDays.split(",").map((d) => d.trim()).filter(Boolean);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: ".75rem", flexWrap: "wrap" }}>
        <div className="panel-title" style={{ marginBottom: ".5rem" }}>
          <span className="dot" />
          {service.label}
        </div>
        <Link href="/reserver" style={{ fontSize: ".8rem", color: "var(--muted)", textDecoration: "none" }}>
          ← Activités
        </Link>
      </div>

      <div className="panel">
        <div className="panel-title" style={{ fontSize: ".82rem" }}>
          <span className="dot" />
          Créneaux récurrents
        </div>
        <RecurringBooking
          serviceId={service.id}
          days={days}
          recurCapacity={service.recurCapacity}
          slots={recurSlots}
          periods={periods}
          bookings={recurBookings}
          userId={session.user.id}
          myEnfants={profile?.enfants ?? 0}
        />
      </div>

      <div className="panel-title" style={{ fontSize: ".82rem", marginTop: "1rem" }}>
        <span className="dot" />
        Créneaux ponctuels
      </div>
      {availability.length === 0 ? (
        <div className="panel">
          <p style={{ fontSize: ".85rem", color: "var(--muted)" }}>Aucun créneau ponctuel à venir.</p>
        </div>
      ) : (
        availability.map((slot) => (
          <ReserveSlot
            key={slot.id}
            serviceId={service.id}
            slotId={slot.id}
            dateLabel={slot.slotDate ? dateFmt.format(slot.slotDate) : "Date à définir"}
            timeLabel={`${slot.startTime} – ${slot.endTime}`}
            remaining={slot.remaining}
            capacity={slot.capacity}
            mine={slot.mine}
          />
        ))
      )}
    </div>
  );
}
