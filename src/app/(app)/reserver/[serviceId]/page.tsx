import Link from "next/link";
import { notFound } from "next/navigation";
import { getServiceWithAvailability } from "@/server/services/bookings";
import { requireUser } from "@/server/guards";
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

      {availability.length === 0 ? (
        <div className="panel">
          <p style={{ fontSize: ".85rem", color: "var(--muted)" }}>
            Aucun créneau ponctuel à venir pour cette activité.
          </p>
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
