import { notFound } from "next/navigation";
import { listServicePeriods, parseActiveDays } from "@/server/services/periods";
import { getService } from "@/server/services/services";
import { ParamsSubnav } from "../params-subnav";
import { ReservationsPanel } from "../reservations/reservations-panel";
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

  // Exercice EN COURS = celui dont l'intervalle [dateStart, dateEnd] contient la date
  // du jour (affiché à droite du titre du panneau Réservations). Aucun si hors plage.
  const today = new Date().toISOString().slice(0, 10);
  const currentExercice =
    uiExercices.find((e) => e.dateStart && e.dateEnd && e.dateStart <= today && today <= e.dateEnd)
      ?.label ?? null;

  return (
    <div>
      <ParamsSubnav serviceId={id} />
      <PeriodesPanel
        serviceId={id}
        initialPeriods={initialPeriods}
        exercices={uiExercices}
        showPreviousExercices={service.showPreviousExercices}
      />
      {/* Panneau « Réservations » déplacé sous les périodes (onglet « Périodes et réservations »). */}
      <ReservationsPanel
        serviceId={id}
        exerciceLabel={currentExercice}
        bookingDelay={service.bookingDelay}
        autoValidationDelay={service.autoValidationDelay}
        validationBloquante={service.validationBloquante}
        mgrNoticeMode={service.mgrNoticeMode}
        mgrNoticeIntervalHours={service.mgrNoticeIntervalHours}
        mgrNoticeHour={service.mgrNoticeHour}
        mgrNoticeWeekday={service.mgrNoticeWeekday}
      />
    </div>
  );
}
