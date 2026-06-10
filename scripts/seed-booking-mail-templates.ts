import { setConfigMany } from "@/server/config";
import { prisma } from "@/server/db";
import { DEFAULT_TEMPLATES } from "@/server/services/mail-templates";

// Enregistre en base (app_config) les modèles « Réservation confirmée » (booking_confirmed)
// et « Demande de réservation enregistrée » (booking_pending) à partir de leurs valeurs par
// défaut actuelles — ils deviennent des surcharges éditables via Administration › Échanges.
//   tsx scripts/seed-booking-mail-templates.ts

async function main() {
  const kinds = ["booking_confirmed", "booking_pending"] as const;
  const entries: Record<string, string> = {};
  for (const k of kinds) {
    entries[`mail.tpl.${k}.subject`] = DEFAULT_TEMPLATES[k].subject;
    entries[`mail.tpl.${k}.html`] = DEFAULT_TEMPLATES[k].html;
  }
  await setConfigMany(entries);
  console.log("Modèles enregistrés en base :");
  for (const key of Object.keys(entries)) console.log("  -", key);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
