import { requireUser } from "@/server/guards";
import { getUserServiceAgenda } from "@/server/services/bookings";
import { notFound } from "next/navigation";
import { UserAgendaGrid } from "./user-agenda-grid";

export default async function ReservationsServicePage({
  params,
}: {
  params: Promise<{ serviceId: string }>;
}) {
  const { serviceId } = await params;
  const session = await requireUser();
  const data = await getUserServiceAgenda(serviceId, session.user.id);
  if (!data) notFound();

  return (
    <UserAgendaGrid
      service={data.service}
      periods={data.periods}
      slots={data.slots}
      uniqueSlots={data.uniqueSlots}
      bookings={data.bookings}
      themes={data.themes}
      modes={data.modes}
      exercices={data.exercices}
      showPrevious={data.service.showPreviousExercices}
      demandeurLabel={data.demandeurLabel}
      userInfo={data.user}
    />
  );
}
