import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageTitle } from "@/components/ui";
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageTitle>{service.label}</PageTitle>
        <Link href="/reserver" className="text-sm text-neutral-500 hover:text-brand-700">
          ← Activités
        </Link>
      </div>

      <Card>
        {availability.length === 0 ? (
          <p className="text-sm text-neutral-400">Aucun créneau ponctuel à venir pour cette activité.</p>
        ) : (
          <div className="space-y-3">
            {availability.map((slot) => (
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
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
