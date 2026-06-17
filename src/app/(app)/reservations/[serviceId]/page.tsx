import { getConfigMany } from "@/server/config";
import { isServiceManager, requireUser } from "@/server/guards";
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

  // Gestionnaire du service → autorise l'impression « tous usagers » (liste nominative).
  const role = (session.user as { role?: "utilisateur" | "gestionnaire" | "administrateur" }).role;
  const isManager = await isServiceManager(serviceId, session.user.id, role);

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
      openOnSchoolHolidays={data.openOnSchoolHolidays}
      schoolHolidays={data.schoolHolidays}
      userInfo={data.user}
      isManager={isManager}
      autoRefreshSeconds={autoRefreshSeconds}
      debugMode={debugMode}
    />
  );
}
