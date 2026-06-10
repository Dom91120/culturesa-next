import { PrismaClient } from "@prisma/client";

// Nettoyage unique (modèle « 1 créneau = 1 semaine ») : supprime les créneaux RÉCURRENTS
// « A & B » (qui tournent les deux semaines) des services en mode A/B — désormais
// interdits (cf. slots.ts abWeekError). Leurs miroirs et réservations sont supprimés en
// cascade (comme deleteSlots). NE touche PAS aux services NON A/B, où weeks="A,B" signifie
// « toutes les semaines » et reste valide.
//
//   Rapport (dry-run) : tsx scripts/delete-ab-slots.ts
//   Suppression réelle : tsx scripts/delete-ab-slots.ts --apply

const prisma = new PrismaClient();

/** Un créneau « A&B » = ni « A » ni « B » seul (donc "A,B", "", null, ...). */
function isBothWeeks(weeks: string | null): boolean {
  const w = (weeks ?? "").trim();
  return w !== "A" && w !== "B";
}

async function main() {
  const apply = process.argv.includes("--apply");

  const abRows = await prisma.serviceDemandeurSettings.findMany({
    where: { semaineAb: true },
    select: { serviceId: true },
    distinct: ["serviceId"],
  });
  const abServiceIds = abRows.map((r) => r.serviceId);
  if (abServiceIds.length === 0) {
    console.log("Aucun service en mode A/B — rien à faire.");
    return;
  }

  const slots = await prisma.slot.findMany({
    where: { serviceId: { in: abServiceIds }, slotType: "recurring" },
    select: {
      id: true,
      serviceId: true,
      weeks: true,
      slotDay: true,
      startTime: true,
      endTime: true,
      periodId: true,
    },
  });
  const offending = slots.filter((s) => isBothWeeks(s.weeks));

  if (offending.length === 0) {
    console.log(
      `Services A/B : ${abServiceIds.length}. Aucun créneau récurrent « A&B » à supprimer.`,
    );
    return;
  }

  const ids = offending.map((s) => s.id);
  const mirrors = await prisma.slot.findMany({
    where: { parentSlotId: { in: ids } },
    select: { id: true },
  });
  const mirrorIds = mirrors.map((m) => m.id);
  const allSlotIds = [...ids, ...mirrorIds];
  const bookingCount = await prisma.booking.count({ where: { slotId: { in: allSlotIds } } });

  console.log(`Services en mode A/B : ${abServiceIds.length}`);
  console.log(`Créneaux récurrents « A&B » à supprimer : ${offending.length}`);
  console.log(`  + miroirs liés : ${mirrorIds.length}`);
  console.log(`  + réservations supprimées (cascade) : ${bookingCount}`);
  for (const s of offending) {
    console.log(
      `  - ${s.id} (service ${s.serviceId}, ${s.slotDay} ${s.startTime}-${s.endTime}, ` +
        `weeks="${s.weeks}", période ${s.periodId})`,
    );
  }

  if (!apply) {
    console.log("\nDRY RUN — relancer avec --apply pour supprimer.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.booking.deleteMany({ where: { slotId: { in: allSlotIds } } });
    if (mirrorIds.length) await tx.slot.deleteMany({ where: { id: { in: mirrorIds } } });
    await tx.slot.deleteMany({ where: { id: { in: ids } } });
  });
  console.log(
    `\n✅ Supprimé : ${offending.length} créneaux A&B, ${mirrorIds.length} miroirs, ` +
      `${bookingCount} réservations.`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
