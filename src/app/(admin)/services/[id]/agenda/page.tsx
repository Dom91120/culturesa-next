import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminDemInfo } from "@/components/admin-dem-info";
import { toDateInput } from "@/lib/format";
import { getConfigMany } from "@/server/config";
import { prisma } from "@/server/db";
import { getSession } from "@/server/guards";
import { getServiceDemandeurSettingsLabeled } from "@/server/services/demandeur-settings";
import { currentExerciceIdForService, eligiblePeriodsWhere } from "@/server/services/exercice";
import { deriveServiceModes } from "@/server/services/service-modes";
import { AgendaGrid } from "./agenda-grid";

export default async function AgendaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // (Les réglages d'ouverture sont portés par chaque exercice, cf. plus bas.)
  const service = await prisma.service.findUnique({
    where: { id },
    select: {
      id: true,
      label: true,
      capacity: true,
      recurrentMode: true,
      semaineAb: true,
      themesMode: true,
      showPreviousExercices: true,
      gaugeAccompagnants: true,
    },
  });
  if (!service) notFound();

  // Modes : récurrent et A/B sont GLOBAUX au service (Service.recurrentMode/semaineAb) ;
  // validation/thèmes sont dérivés de la matrice service × demandeur.
  // Les lignes (avec libellé) servent aussi au bandeau debug admin.
  const demRows = await getServiceDemandeurSettingsLabeled(id);
  const modes = deriveServiceModes(service, demRows);

  // Champs de période chargés pour les onglets/bornes de l'agenda.
  const periodSelect = {
    id: true,
    label: true,
    etiquette: true,
    color: true,
    dateStart: true,
    dateEnd: true,
    exerciceId: true,
  } as const;
  // Onglets de périodes triés par DATE de début (nulls en dernier), puis id.
  const periodOrder = [
    { dateStart: { sort: "asc" as const, nulls: "last" as const } },
    { id: "asc" as const },
  ];
  // Périmètre par défaut = l'exercice COURANT (le plus récent) ; avec « Afficher les
  // exercices précédents », TOUTES les périodes du service (tous exercices) pour la
  // nav ◀ exercice.
  const currentExoId = await currentExerciceIdForService(id);
  const periods = await prisma.period.findMany({
    where: eligiblePeriodsWhere(id, service.showPreviousExercices, currentExoId),
    orderBy: periodOrder,
    select: periodSelect,
  });
  // Aucune période à afficher → l'agenda n'a rien à montrer : on invite le gestionnaire
  // à agir (au lieu d'une grille vide et muette). Trois cas, du plus en amont au plus
  // proche : « le service n'a AUCUN exercice » (créer l'exercice avant toute période),
  // « le service n'a AUCUNE période », et « l'exercice courant est vide » (des périodes
  // existent sous un autre exercice, masquées car « Afficher les exercices précédents »
  // est désactivé) — pour ne pas afficher un message faux après une bascule d'exercice.
  if (periods.length === 0) {
    const noExercice = currentExoId == null;
    const totalPeriods = noExercice ? 0 : await prisma.period.count({ where: { serviceId: id } });
    const noneAtAll = totalPeriods === 0;
    return (
      <div className="panel" style={{ textAlign: "center", padding: "2.5rem 1.5rem" }}>
        <div className="panel-title" style={{ justifyContent: "center", marginBottom: ".75rem" }}>
          <span className="dot" />
          Agenda — {service.label}
        </div>
        <p style={{ color: "var(--muted)", margin: "0 0 1.25rem", fontSize: ".85rem" }}>
          {noExercice
            ? "Aucun exercice n'est configuré pour ce service. Créez d'abord un exercice, puis ses périodes, pour pouvoir gérer l'agenda et les créneaux."
            : noneAtAll
              ? "Aucune période n'est configurée pour ce service. Créez au moins une période pour pouvoir gérer l'agenda et les créneaux."
              : "Aucune période dans l'exercice courant. Créez-en une, ou activez « Afficher les exercices précédents » dans les paramètres du service pour retrouver les périodes des exercices passés."}
        </p>
        <Link className="btn btn-primary" href={`/services/${id}/periodes`}>
          {noExercice ? "Créer un exercice" : "Créer une période"}
        </Link>
      </div>
    );
  }

  // Borne de chargement : UNIQUEMENT les créneaux/réservations des périodes
  // affichées (exercice courant, + exercices passés si showPreviousExercices).
  // Sans cette borne, l'agenda chargeait TOUS les exercices accumulés — payload
  // et requêtes croissant sans limite à chaque bascule d'exercice (audit perf).
  const periodIds = periods.map((p) => p.id);

  const [slots, uniqueSlots, bookings] = await Promise.all([
    prisma.slot.findMany({
      where: { serviceId: id, slotType: "recurring", periodId: { in: periodIds } },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        capacity: true,
        slotDay: true,
        periodId: true,
        weeks: true,
        jauge: true,
      },
    }),
    // Créneaux ponctuels (datés) : affichés dans l'agenda en mode « Semaine réelle »
    // sur le jour de leur date (cf. legacy renderAgendaWeekly, branche realweek).
    prisma.slot.findMany({
      where: { serviceId: id, slotType: "unique", periodId: { in: periodIds } },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        capacity: true,
        slotDate: true,
        parentSlotId: true,
        jauge: true,
      },
    }),
    prisma.booking.findMany({
      // Récurrentes ET ponctuelles : les ponctuelles (bookingType "unique") sont
      // rattachées à leur bloc ponctuel daté dans l'agenda « Semaine réelle ».
      // Bornées via leur créneau : seules celles d'un créneau affiché sont rendues.
      where: {
        serviceId: id,
        bookingType: { in: ["recurring", "unique"] },
        slot: { periodId: { in: periodIds } },
      },
      select: {
        id: true,
        slotId: true,
        periodId: true,
        week: true,
        bookingType: true,
        parentBookingId: true,
        enfants: true,
        accompagnants: true,
        themeLabel: true,
        validated: true,
        pointage: true,
        user: {
          select: {
            nom: true,
            prenom: true,
            tel: true,
            email: true,
            demandeur: { select: { label: true } },
            structure: { select: { label: true } },
          },
        },
      },
    }),
  ]);

  // Demandeurs autorisés par créneau (SlotDemandeur) + liste des demandeurs du service,
  // pour la modale « configuration de créneau » du mode création de l'agenda.
  const slotIds = [...slots.map((s) => s.id), ...uniqueSlots.map((s) => s.id)];
  const slotDemRows = slotIds.length
    ? await prisma.slotDemandeur.findMany({
        where: { slotId: { in: slotIds } },
        select: { slotId: true, demandeurId: true },
      })
    : [];
  const slotDemandeurs: Record<string, number[]> = {};
  for (const r of slotDemRows) {
    const list = slotDemandeurs[r.slotId] ?? [];
    list.push(r.demandeurId);
    slotDemandeurs[r.slotId] = list;
  }
  const serviceDemandeurs = demRows.map((r) => ({ id: r.demandeurId, label: r.label }));

  const bookingsData = bookings.map((b) => ({
    id: b.id,
    slotId: b.slotId,
    // DTO client : convention 0 = aucune période (la grille admin raisonne en number).
    periodId: b.periodId ?? 0,
    week: b.week,
    bookingType: b.bookingType,
    parentBookingId: b.parentBookingId,
    enfants: b.enfants,
    accompagnants: b.accompagnants,
    theme: b.themeLabel ?? "",
    validated: b.validated,
    pointage: b.pointage,
    name: `${b.user.nom} ${b.user.prenom}`.trim() || "—",
    tel: b.user.tel ?? "",
    email: b.user.email ?? "",
    demandeur: b.user.demandeur?.label ?? "",
    structure: b.user.structure?.label ?? "",
  }));

  const slotsData = slots.map((s) => ({
    id: s.id,
    startTime: s.startTime,
    endTime: s.endTime,
    capacity: s.capacity,
    slotDay: s.slotDay,
    periodId: s.periodId,
    weeks: s.weeks ?? null,
    jauge: s.jauge,
  }));

  const uniqueSlotsData = uniqueSlots.map((s) => ({
    id: s.id,
    startTime: s.startTime,
    endTime: s.endTime,
    capacity: s.capacity,
    slotDate: toDateInput(s.slotDate),
    parentSlotId: s.parentSlotId,
    jauge: s.jauge,
  }));

  const periodsData = periods.map((p) => ({
    id: p.id,
    label: p.label,
    etiquette: p.etiquette ?? "",
    color: p.color,
    dateStart: toDateInput(p.dateStart),
    dateEnd: toDateInput(p.dateEnd),
    exerciceId: p.exerciceId,
  }));

  // Exercices distincts présents parmi les périodes → navigation ◀ label ▶
  // (charte legacy exercice-nav-inline). Triés par libellé (= années scolaires).
  // Chaque exercice publie ses réglages d'ouverture RÉSOLUS (surcharge ?? service,
  // cf. opening.ts) : la grille les applique à l'exercice couvrant chaque jour.
  const exerciceIds = [
    ...new Set(periods.map((p) => p.exerciceId).filter((x): x is number => x != null)),
  ];
  const exerciceRows = (
    exerciceIds.length
      ? await prisma.exercice.findMany({
          where: { id: { in: exerciceIds } },
          select: {
            id: true,
            label: true,
            dateStart: true,
            dateEnd: true,
            morningStart: true,
            morningEnd: true,
            afternoonStart: true,
            afternoonEnd: true,
            activeDays: true,
            openOnHolidays: true,
            openOnSchoolHolidays: true,
          },
        })
      : []
  ).sort((a, b) => a.label.localeCompare(b.label));
  const exercices = exerciceRows.map((e) => ({
    id: e.id,
    label: e.label,
    dateStart: toDateInput(e.dateStart),
    dateEnd: toDateInput(e.dateEnd),
    opening: {
      activeDays: e.activeDays,
      openOnHolidays: e.openOnHolidays,
      openOnSchoolHolidays: e.openOnSchoolHolidays,
      morningStart: e.morningStart,
      morningEnd: e.morningEnd,
      afternoonStart: e.afternoonStart,
      afternoonEnd: e.afternoonEnd,
    },
  }));

  // En mode thèmes "liste", la modale d'édition propose un <select> des thèmes du
  // service (sinon champ libre). On ne charge la liste qu'au besoin.
  const themes =
    service.themesMode === "liste"
      ? (
          await prisma.serviceTheme.findMany({
            where: { serviceId: id },
            orderBy: [{ position: "asc" }, { id: "asc" }],
            select: { label: true },
          })
        ).map((t) => t.label)
      : [];

  // Intervalle d'auto-rafraîchissement de l'agenda (Administration > Configuration). Défaut 60 s.
  // + zone de vacances scolaires (pour filtrer les occurrences des demandeurs « fermés »).
  const refreshCfg = await getConfigMany(["agenda.autoRefreshSeconds", "school.zone"]);
  const rawAgendaRefresh = Number.parseInt(refreshCfg["agenda.autoRefreshSeconds"], 10);
  const autoRefreshSeconds = Number.isFinite(rawAgendaRefresh) ? rawAgendaRefresh : 60;
  const schoolHolidays = (
    await prisma.schoolHoliday.findMany({
      where: { zone: refreshCfg["school.zone"] || "A" },
      select: { dateStart: true, dateEnd: true },
    })
  ).map((h) => ({
    dateStart: h.dateStart.toISOString().slice(0, 10),
    dateEnd: h.dateEnd.toISOString().slice(0, 10),
  }));

  return (
    <>
      <AgendaGrid
        service={service}
        periods={periodsData}
        slots={slotsData}
        uniqueSlots={uniqueSlotsData}
        bookings={bookingsData}
        themes={themes}
        modes={modes}
        exercices={exercices}
        showPrevious={service.showPreviousExercices}
        slotDemandeurs={slotDemandeurs}
        serviceDemandeurs={serviceDemandeurs}
        schoolHolidays={schoolHolidays}
        autoRefreshSeconds={autoRefreshSeconds}
        viewerEmail={(await getSession())?.user.email ?? ""}
      />
      <AdminDemInfo rows={demRows} />
    </>
  );
}
