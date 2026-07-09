import { notFound } from "next/navigation";
import { getConfigMany } from "@/server/config";
import { requireUser } from "@/server/guards";
import { getUserServiceAgenda } from "@/server/services/bookings";
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

  // Réglages lus côté serveur (Administration > Configuration).
  const cfg = await getConfigMany(["reservations.autoRefreshSeconds", "debug.mode"]);
  const raw = Number.parseInt(cfg["reservations.autoRefreshSeconds"], 10);
  const autoRefreshSeconds = Number.isFinite(raw) ? raw : 60;
  // Mode debug : source de vérité serveur (lue à chaque requête) → pas d'état client « collé ».
  const debugMode = cfg["debug.mode"] === "1";

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
      demandeurLabel={data.demandeurLabel}
      demandeurOpenOnSchoolHolidays={data.demandeurOpenOnSchoolHolidays}
      schoolHolidays={data.schoolHolidays}
      userInfo={data.user}
      autoRefreshSeconds={autoRefreshSeconds}
      debugMode={debugMode}
    />
  );
}
