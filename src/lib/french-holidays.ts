// Jours fériés légaux français — SOURCE UNIQUE de l'app (serveur ET client).
// Déplacé depuis server/services/exercice.ts pour être partagé avec les grilles
// agenda (qui en avaient chacune une copie locale, cf. audit duplication 2026-06) :
// la génération des miroirs (serveur) et le grisage des jours (client) doivent
// exclure exactement les mêmes dates.

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function pad4(n: number): string {
  return String(n).padStart(4, "0");
}

/** Dimanche de Pâques (algorithme de Meeus/Jones/Butcher), en UTC. */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = mars, 4 = avril
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function addDaysUtc(d: Date, days: number): Date {
  const r = new Date(d.getTime());
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

/** Jours fériés légaux français (fixes + mobiles liés à Pâques) d'une année. */
function frenchHolidays(year: number): { date: string; label: string }[] {
  const fmt = (d: Date) =>
    `${pad4(d.getUTCFullYear())}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  const easter = easterSunday(year);
  const list: { date: string; label: string }[] = [
    { date: `${pad4(year)}-01-01`, label: "Jour de l'an" },
    { date: `${pad4(year)}-05-01`, label: "Fête du Travail" },
    { date: `${pad4(year)}-05-08`, label: "Victoire 1945" },
    { date: `${pad4(year)}-07-14`, label: "Fête nationale" },
    { date: `${pad4(year)}-08-15`, label: "Assomption" },
    { date: `${pad4(year)}-11-01`, label: "Toussaint" },
    { date: `${pad4(year)}-11-11`, label: "Armistice 1918" },
    { date: `${pad4(year)}-12-25`, label: "Noël" },
    { date: fmt(addDaysUtc(easter, 1)), label: "Lundi de Pâques" },
    { date: fmt(addDaysUtc(easter, 39)), label: "Ascension" },
    { date: fmt(addDaysUtc(easter, 50)), label: "Lundi de Pentecôte" },
  ];
  return list;
}

/** Jours fériés français sur l'intervalle [start, end] (bornes incluses). */
export function holidaysInRange(start: string, end: string): { date: string; label: string }[] {
  const ys = Number.parseInt(start.slice(0, 4), 10);
  const ye = Number.parseInt(end.slice(0, 4), 10);
  const out: { date: string; label: string }[] = [];
  for (let y = ys; y <= ye; y++) {
    for (const h of frenchHolidays(y)) {
      if (h.date >= start && h.date <= end) out.push(h);
    }
  }
  return out;
}

/** Une date « YYYY-MM-DD » est-elle un jour férié français ? (port legacy _isFrenchHoliday) */
export function isFrenchHoliday(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const year = Number.parseInt(dateStr.slice(0, 4), 10);
  return frenchHolidays(year).some((h) => h.date === dateStr);
}
