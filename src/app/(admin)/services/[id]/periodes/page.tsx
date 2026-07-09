import { notFound } from "next/navigation";
import { getServiceOpeningConfig, listServicePeriods, parseActiveDays } from "@/server/services/periods";
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
    disponibilite: toISODate(p.disponibilite),
    color: p.color,
    state: p.state,
    exerciceId: p.exerciceId,
  }));

  // Défauts d'ouverture du service (repli quand l'exercice n'a pas de surcharge,
  // ou quand le service n'a aucun exercice).
  const svcOpening = opening ?? {
    activeDays: [],
    openOnHolidays: false,
    openOnSchoolHolidays: false,
    morningStart: "09:00",
    morningEnd: "12:00",
    afternoonStart: "14:00",
    afternoonEnd: "18:00",
  };

  const uiExercices = exercices.map((e) => ({
    id: e.id,
    label: e.label,
    type: e.type,
    dateStart: toISODate(e.dateStart),
    dateEnd: toISODate(e.dateEnd),
    // Réglages d'ouverture RÉSOLUS de l'exercice (surcharge ?? défaut service).
    opening: {
      activeDays: e.activeDays != null ? parseActiveDays(e.activeDays) : svcOpening.activeDays,
      openOnHolidays: e.openOnHolidays ?? svcOpening.openOnHolidays,
      openOnSchoolHolidays: e.openOnSchoolHolidays ?? svcOpening.openOnSchoolHolidays,
      morningStart: e.morningStart ?? svcOpening.morningStart,
      morningEnd: e.morningEnd ?? svcOpening.morningEnd,
      afternoonStart: e.afternoonStart ?? svcOpening.afternoonStart,
      afternoonEnd: e.afternoonEnd ?? svcOpening.afternoonEnd,
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
        opening={svcOpening}
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
