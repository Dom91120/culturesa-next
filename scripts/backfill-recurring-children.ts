import { todayParisISO } from "@/lib/booking-delay";
import {
  getSchoolZone,
  PARENT_FOR_SYNC_SELECT,
  syncRecurringChildren,
} from "@/server/services/recurring-children";
import "dotenv/config";
import { prisma } from "@/server/db";

// Back-fill unique : matérialise les réservations-enfants datées pour TOUTES les
// réservations récurrentes existantes (qui n'en avaient pas dans l'ancien modèle).
// Idempotent — peut être relancé sans dommage. À lancer une fois après
// `prisma migrate deploy` : `tsx scripts/backfill-recurring-children.ts`.

async function main() {
  const zone = await getSchoolZone();
  const parents = await prisma.booking.findMany({
    where: { bookingType: "recurring", parentBookingId: null },
    // Source unique des champs attendus par syncRecurringChildren (ParentForSync).
    select: PARENT_FOR_SYNC_SELECT,
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
