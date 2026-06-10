import { PrismaClient } from "@prisma/client";

// Migration unique (convention « weeks ∈ {"", "A", "B"} ») : ramène à "" tout créneau
// RÉCURRENT dont la colonne weeks n'est ni "A" ni "B" (typiquement le legacy "A,B", ou
// null). "" = toutes les semaines (parseWeeks("") → ["A","B"]). "A,B" n'est plus persisté.
// Ne touche pas aux miroirs (slotType "unique").
//
//   Rapport (dry-run) : tsx scripts/normalize-recurring-weeks.ts
//   Migration réelle  : tsx scripts/normalize-recurring-weeks.ts --apply

const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes("--apply");
  const slots = await prisma.slot.findMany({
    where: { slotType: "recurring" },
    select: { id: true, weeks: true },
  });
  // À normaliser : tout ce qui n'est pas exactement "A", "B" ou "" (donc "A,B", null, …).
  const toFix = slots.filter((s) => s.weeks !== "A" && s.weeks !== "B" && s.weeks !== "");

  console.log(`Créneaux récurrents : ${slots.length}`);
  console.log(`À normaliser → "" : ${toFix.length}`);
  const byVal = new Map<string, number>();
  for (const s of toFix) {
    const k = s.weeks === null ? "null" : `"${s.weeks}"`;
    byVal.set(k, (byVal.get(k) ?? 0) + 1);
  }
  for (const [k, n] of byVal) console.log(`  ${k} → "" : ${n}`);

  if (!toFix.length) {
    console.log("Rien à normaliser.");
    return;
  }
  if (!apply) {
    console.log("\nDRY RUN — relancer avec --apply pour migrer.");
    return;
  }
  const res = await prisma.slot.updateMany({
    where: { id: { in: toFix.map((s) => s.id) } },
    data: { weeks: "" },
  });
  console.log(`\n✅ Migré : ${res.count} créneaux récurrents → weeks="".`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
