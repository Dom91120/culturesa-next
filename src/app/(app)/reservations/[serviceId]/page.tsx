import { getConfigMany } from "@/server/config";
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

  // Intervalle d'auto-rafraîchissement (Administration > Configuration). Défaut 60 s.
  const cfg = await getConfigMany(["reservations.autoRefreshSeconds"]);
  const raw = Number.parseInt(cfg["reservations.autoRefreshSeconds"], 10);
  const autoRefreshSeconds = Number.isFinite(raw) ? raw : 60;

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
      openOnSchoolHolidays={data.openOnSchoolHolidays}
      schoolHolidays={data.schoolHolidays}
      userInfo={data.user}
      autoRefreshSeconds={autoRefreshSeconds}
    />
  );
}
