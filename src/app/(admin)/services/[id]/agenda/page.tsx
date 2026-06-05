import { AdminDemInfo } from "@/components/admin-dem-info";
import { toDateInput } from "@/lib/format";
import { prisma } from "@/server/db";
import { getServiceDemandeurSettingsLabeled } from "@/server/services/demandeur-settings";
import { deriveServiceModes } from "@/server/services/service-modes";
import { notFound } from "next/navigation";
import { AgendaGrid } from "./agenda-grid";

export default async function AgendaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = await prisma.service.findUnique({
    where: { id },
    select: {
      id: true,
      label: true,
      activeDays: true,
      morningStart: true,
      morningEnd: true,
      afternoonStart: true,
      afternoonEnd: true,
      capacity: true,
      semaineAb: true,
      themesMode: true,
      openOnHolidays: true,
      showPreviousExercices: true,
      gaugeAccompagnants: true,
    },
  });
  if (!service) notFound();

  // Les modes d'affichage (A/B, thème, jauge…) sont DÉRIVÉS de la matrice
  // service × demandeur, pas des colonnes du service (qui ne la reflètent pas).
  // Les lignes (avec libellé) servent aussi au bandeau debug admin.
  const demRows = await getServiceDemandeurSettingsLabeled(id);
  const modes = deriveServiceModes(demRows);

  // Fallback legacy : si le service a ses propres périodes actives, n'afficher QUE
  // celles-là ; sinon retomber sur les périodes globales (serviceId null). Sans ce
  // fallback, l'agenda mélangeait les périodes globales du seed et celles du service.
  const periodSelect = {
    id: true,
    label: true,
    color: true,
    dateStart: true,
    dateEnd: true,
    exerciceId: true,
  } as const;
  const periodOrder = [{ position: "asc" as const }, { id: "asc" as const }];
  // Avec « Afficher les exercices précédents », on inclut aussi les périodes
  // désactivées (celles des exercices passés) pour permettre la nav ◀ exercice.
  const periodStates = service.showPreviousExercices
    ? (["actif", "desactive"] as const)
    : (["actif"] as const);
  let periods = await prisma.period.findMany({
    where: { serviceId: id, state: { in: [...periodStates] } },
    orderBy: periodOrder,
    select: periodSelect,
  });
  if (periods.length === 0) {
    periods = await prisma.period.findMany({
      where: { serviceId: null, state: { in: [...periodStates] } },
      orderBy: periodOrder,
      select: periodSelect,
    });
  }

  const [slots, uniqueSlots, bookings, users] = await Promise.all([
    prisma.slot.findMany({
      where: { serviceId: id, slotType: "recurring", state: "actif" },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        capacity: true,
        slotDay: true,
        periodId: true,
        weeks: true,
      },
    }),
    // Créneaux ponctuels (datés) : affichés dans l'agenda en mode « Semaine réelle »
    // sur le jour de leur date (cf. legacy renderAgendaWeekly, branche realweek).
    prisma.slot.findMany({
      where: { serviceId: id, slotType: "unique", state: "actif" },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        capacity: true,
        slotDate: true,
        parentSlotId: true,
      },
    }),
    prisma.booking.findMany({
      // Récurrentes ET ponctuelles : les ponctuelles (bookingType "unique") sont
      // rattachées à leur bloc ponctuel daté dans l'agenda « Semaine réelle ».
      where: { serviceId: id, bookingType: { in: ["recurring", "unique"] } },
      select: {
        id: true,
        slotId: true,
        periodId: true,
        week: true,
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
    prisma.user.findMany({
      where: { role: "utilisateur" },
      orderBy: [{ nom: "asc" }, { prenom: "asc" }],
      select: { id: true, nom: true, prenom: true, demandeur: { select: { label: true } } },
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

  const usersData = users.map((u) => ({
    id: u.id,
    label: `${u.nom} ${u.prenom}`.trim() + (u.demandeur ? ` — ${u.demandeur.label}` : ""),
  }));

  const bookingsData = bookings.map((b) => ({
    id: b.id,
    slotId: b.slotId,
    periodId: b.periodId,
    week: b.week,
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
  }));

  const uniqueSlotsData = uniqueSlots.map((s) => ({
    id: s.id,
    startTime: s.startTime,
    endTime: s.endTime,
    capacity: s.capacity,
    slotDate: toDateInput(s.slotDate),
    parentSlotId: s.parentSlotId,
  }));

  const periodsData = periods.map((p) => ({
    id: p.id,
    label: p.label,
    color: p.color,
    dateStart: toDateInput(p.dateStart),
    dateEnd: toDateInput(p.dateEnd),
    exerciceId: p.exerciceId,
  }));

  // Exercices distincts présents parmi les périodes → navigation ◀ label ▶
  // (charte legacy exercice-nav-inline). Triés par libellé (= années scolaires).
  const exerciceIds = [
    ...new Set(periods.map((p) => p.exerciceId).filter((x): x is number => x != null)),
  ];
  const exercices = (
    exerciceIds.length
      ? await prisma.exercice.findMany({
          where: { id: { in: exerciceIds } },
          select: { id: true, label: true },
        })
      : []
  ).sort((a, b) => a.label.localeCompare(b.label));

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

  return (
    <>
      <AgendaGrid
        service={service}
        periods={periodsData}
        slots={slotsData}
        uniqueSlots={uniqueSlotsData}
        bookings={bookingsData}
        users={usersData}
        themes={themes}
        modes={modes}
        exercices={exercices}
        showPrevious={service.showPreviousExercices}
        slotDemandeurs={slotDemandeurs}
        serviceDemandeurs={serviceDemandeurs}
      />
      <AdminDemInfo rows={demRows} />
    </>
  );
}
