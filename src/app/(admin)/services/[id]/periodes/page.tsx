import { notFound } from "next/navigation";
import { getServiceOpeningConfig, listServicePeriods } from "@/server/services/periods";
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

  const [{ periods, exercices }, opening] = await Promise.all([
    listServicePeriods(id),
    getServiceOpeningConfig(id),
  ]);

  const initialPeriods = periods.map((p) => ({
    id: p.id,
    label: p.label,
    etiquette: p.etiquette,
    dateStart: toISODate(p.dateStart),
    dateEnd: toISODate(p.dateEnd),
    color: p.color,
    state: p.state,
    exerciceId: p.exerciceId,
  }));

  const uiExercices = exercices.map((e) => ({
    id: e.id,
    label: e.label,
    type: e.type,
    dateStart: toISODate(e.dateStart),
    dateEnd: toISODate(e.dateEnd),
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
        opening={
          opening ?? {
            activeDays: [],
            openOnHolidays: false,
            openOnSchoolHolidays: false,
            morningStart: "09:00",
            morningEnd: "12:00",
            afternoonStart: "14:00",
            afternoonEnd: "18:00",
          }
        }
      />
      {/* Panneau « Réservations » déplacé sous les périodes (onglet « Périodes et réservations »). */}
      <ReservationsPanel
        serviceId={id}
        exerciceLabel={currentExercice}
        maxReservations={service.maxReservations}
        maxReservationsPeriod={service.maxReservationsPeriod}
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
