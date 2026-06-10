import { todayParisISO } from "@/lib/booking-delay";
import { getSchoolZone, syncRecurringChildren } from "@/server/services/recurring-children";
import { PrismaClient } from "@prisma/client";

// Back-fill unique : matérialise les réservations-enfants datées pour TOUTES les
// réservations récurrentes existantes (qui n'en avaient pas dans l'ancien modèle).
// Idempotent — peut être relancé sans dommage. À lancer une fois après
// `prisma migrate deploy` : `tsx scripts/backfill-recurring-children.ts`.

const prisma = new PrismaClient();

async function main() {
  const zone = await getSchoolZone();
  const parents = await prisma.booking.findMany({
    where: { bookingType: "recurring", parentBookingId: null },
    select: {
      id: true,
      userId: true,
      serviceId: true,
      slotId: true,
      periodId: true,
      week: true,
      themeLabel: true,
      enfants: true,
      accompagnants: true,
      validated: true,
    },
  });

  let created = 0;
  let updated = 0;
  let deleted = 0;
  let failed = 0;
  for (const p of parents) {
    try {
      const r = await prisma.$transaction((tx) =>
        // Reconstruction d'occurrences existantes → on borne au présent (le délai de
        // réservation ne s'applique qu'aux nouvelles réservations usager).
        syncRecurringChildren(tx, p, { schoolZone: zone, cutoffISO: todayParisISO() }),
      );
      created += r.created;
      updated += r.updated;
      deleted += r.deleted;
    } catch (e) {
      failed += 1;
      console.error(`[backfill] réservation #${p.id} échouée:`, e instanceof Error ? e.message : e);
    }
  }

  console.log(
    `Back-fill terminé : ${parents.length} récurrentes traitées → enfants créés=${created}, mis à jour=${updated}, supprimés=${deleted}, échecs=${failed}.`,
  );
}

main()
  .catch((e) => {
    console.error("ERREUR :", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
