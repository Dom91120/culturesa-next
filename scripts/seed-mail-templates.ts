import { setConfigMany } from "@/server/config";
import { prisma } from "@/server/db";
import { DEFAULT_TEMPLATES } from "@/server/services/mail-templates";

// Enregistre en base (app_config) des modèles d'e-mail à partir de leurs valeurs par
// défaut → surcharges éditables via Administration › Échanges. Passer les types en
// arguments ; sans argument, les deux modèles de réservation.
//   tsx scripts/seed-mail-templates.ts email_verification booking_confirmed ...
//   tsx scripts/seed-mail-templates.ts --all   (tous les modèles)

async function main() {
  const all = Object.keys(DEFAULT_TEMPLATES);
  const flagAll = process.argv.includes("--all");
  const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const kinds = flagAll ? all : args.length > 0 ? args : ["booking_confirmed", "booking_pending"];

  const invalid = kinds.filter((k) => !all.includes(k));
  if (invalid.length > 0) {
    console.error(`Type(s) inconnu(s) : ${invalid.join(", ")}`);
    console.error(`Disponibles : ${all.join(", ")}`);
    process.exit(1);
  }

  const entries: Record<string, string> = {};
  for (const k of kinds) {
    const tpl = DEFAULT_TEMPLATES[k as keyof typeof DEFAULT_TEMPLATES];
    entries[`mail.tpl.${k}.subject`] = tpl.subject;
    entries[`mail.tpl.${k}.html`] = tpl.html;
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
