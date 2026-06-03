import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// --- Jours fériés français (auto-contenu, même logique que exercice.ts) ---
function easterSunday(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}
const pad = (n: number) => String(n).padStart(2, "0");
const fmt = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
function frenchHolidays(year: number): { date: string; label: string }[] {
  const e = easterSunday(year);
  return [
    { date: `${year}-01-01`, label: "Jour de l'an" },
    { date: `${year}-05-01`, label: "Fête du Travail" },
    { date: `${year}-05-08`, label: "Victoire 1945" },
    { date: `${year}-07-14`, label: "Fête nationale" },
    { date: `${year}-08-15`, label: "Assomption" },
    { date: `${year}-11-01`, label: "Toussaint" },
    { date: `${year}-11-11`, label: "Armistice 1918" },
    { date: `${year}-12-25`, label: "Noël" },
    { date: fmt(addDays(e, 1)), label: "Lundi de Pâques" },
    { date: fmt(addDays(e, 39)), label: "Ascension" },
    { date: fmt(addDays(e, 50)), label: "Lundi de Pentecôte" },
  ];
}
function holidaysInRange(start: string, end: string) {
  const ys = +start.slice(0, 4), ye = +end.slice(0, 4);
  const out: { date: string; label: string }[] = [];
  for (let y = ys; y <= ye; y++) for (const h of frenchHolidays(y)) if (h.date >= start && h.date <= end) out.push(h);
  return out;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  // 1) Remplir period_holidays pour toutes les périodes datées.
  const periods = await prisma.period.findMany({ select: { id: true, dateStart: true, dateEnd: true } });
  let phInserted = 0;
  for (const p of periods) {
    await prisma.periodHoliday.deleteMany({ where: { periodId: p.id } });
    if (!p.dateStart || !p.dateEnd) continue;
    const rows = holidaysInRange(iso(p.dateStart), iso(p.dateEnd)).map((h) => ({
      periodId: p.id, date: new Date(`${h.date}T00:00:00Z`), label: h.label,
    }));
    if (rows.length) { await prisma.periodHoliday.createMany({ data: rows, skipDuplicates: true }); phInserted += rows.length; }
  }
  console.log(`period_holidays : ${phInserted} jours fériés insérés sur ${periods.length} périodes.`);

  // 2) Supprimer les miroirs actifs tombant un férié (services fermés les fériés),
  //    seulement s'ils n'ont AUCUNE réservation (sinon on alerte sans supprimer).
  const closedServices = await prisma.service.findMany({ where: { openOnHolidays: false }, select: { id: true } });
  const closedIds = closedServices.map((s) => s.id);
  const mirrors = await prisma.slot.findMany({
    where: { serviceId: { in: closedIds }, slotType: "unique", state: "actif", parentSlotId: { not: null } },
    select: { id: true, slotDate: true },
  });
  let deleted = 0; const kept: string[] = [];
  for (const m of mirrors) {
    if (!m.slotDate) continue;
    const ymd = iso(m.slotDate);
    const yearHols = new Set(frenchHolidays(m.slotDate.getUTCFullYear()).map((h) => h.date));
    if (!yearHols.has(ymd)) continue;
    const nbk = await prisma.booking.count({ where: { slotId: m.id } });
    if (nbk > 0) { kept.push(`${m.id} (${ymd}, ${nbk} résa)`); continue; }
    await prisma.slot.delete({ where: { id: m.id } });
    deleted++;
  }
  console.log(`miroirs fériés supprimés (sans résa) : ${deleted}`);
  if (kept.length) console.log(`⚠️ miroirs fériés CONSERVÉS car ils portent des réservations :\n  ${kept.join("\n  ")}`);
}
main().finally(() => prisma.$disconnect());
