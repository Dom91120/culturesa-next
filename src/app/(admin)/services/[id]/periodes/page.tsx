import { notFound } from "next/navigation";
import { listServicePeriods, parseActiveDays } from "@/server/services/periods";
import { getService } from "@/server/services/services";
import { ParamsSubnav } from "../params-subnav";
import { PeriodesPanel } from "./periodes-panel";

/** Date (colonne @db.Date) → « YYYY-MM-DD » en UTC ; null → "". */
function toISODate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export default async function PeriodesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = await getService(id);
  if (!service) notFound();

  const { periods, exercices } = await listServicePeriods(id);

  const initialPeriods = periods.map((p) => ({
    id: p.id,
    label: p.label,
    etiquette: p.etiquette,
    dateStart: toISODate(p.dateStart),
    dateEnd: toISODate(p.dateEnd),
    disponibilite: toISODate(p.disponibilite),
    color: p.color,
    exerciceId: p.exerciceId,
  }));

  const uiExercices = exercices.map((e) => ({
    id: e.id,
    label: e.label,
    type: e.type,
    dateStart: toISODate(e.dateStart),
    dateEnd: toISODate(e.dateEnd),
    // « Affiché aux utilisateurs » : l'unique exercice accessible côté usager.
    visibleToUsers: e.visibleToUsers,
    // Maximums de réservation par usager (par période / sur l'exercice).
    maxReservations: e.maxReservations,
    maxReservationsPeriod: e.maxReservationsPeriod,
    // Délai limite de réservation (porté par l'exercice).
    bookingDelay: e.bookingDelay,
    // Réglages d'ouverture DE l'exercice (unique porteur, cf. opening.ts).
    opening: {
      activeDays: parseActiveDays(e.activeDays),
      openOnHolidays: e.openOnHolidays,
      openOnSchoolHolidays: e.openOnSchoolHolidays,
      morningStart: e.morningStart,
      morningEnd: e.morningEnd,
      afternoonStart: e.afternoonStart,
      afternoonEnd: e.afternoonEnd,
    },
  }));

  return (
    <div>
      <ParamsSubnav serviceId={id} />
      {/* Panneau unique « Périodes et réservations » : exercices, plages horaires, jours
          d'ouverture, périodes, réservations maxi et délais avant réservation, empilés. */}
      <PeriodesPanel
        serviceId={id}
        initialPeriods={initialPeriods}
        exercices={uiExercices}
        showPreviousExercices={service.showPreviousExercices}
      />
    </div>
  );
}
