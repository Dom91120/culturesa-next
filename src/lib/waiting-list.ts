import { DAY_NAMES } from "@/lib/agenda-core";

// ─── Liste d'attente : demi-journées de disponibilité (pur, partagé client/serveur) ──
// Un usager inscrit sur la liste d'attente d'un service déclare ses disponibilités par
// DEMI-JOURNÉE (« lundi matin », « jeudi après-midi »…). Une clé = « <jour>-<am|pm> »
// (jour = clé lun..dim de l'agenda) ; l'ensemble est stocké en CSV sur l'entrée.

export type HalfDay = "am" | "pm";
export const HALF_DAYS: readonly HalfDay[] = ["am", "pm"];
export const HALF_DAY_LABEL: Record<HalfDay, string> = { am: "Matin", pm: "Après-midi" };

/** Frontière matin / après-midi : un créneau qui COMMENCE avant midi est « matin ». */
const NOON = "12:00";

export const dispoKey = (day: string, half: HalfDay): string => `${day}-${half}`;

const DISPO_RE = /^(lun|mar|mer|jeu|ven|sam|dim)-(am|pm)$/;
export const isDispoKey = (k: string): boolean => DISPO_RE.test(k);

/** CSV → ensemble de clés valides (les clés inconnues sont ignorées). */
export function parseDispos(csv: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const raw of (csv ?? "").split(",")) {
    const k = raw.trim();
    if (isDispoKey(k)) out.add(k);
  }
  return out;
}

/** Ensemble → CSV trié (ordre des jours puis matin/après-midi), stable pour la base. */
export function serializeDispos(keys: Iterable<string>): string {
  const order = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"];
  const set = new Set([...keys].filter(isDispoKey));
  return [...set]
    .sort((a, b) => {
      const [da, ha] = a.split("-");
      const [db, hb] = b.split("-");
      return order.indexOf(da) - order.indexOf(db) || (ha === hb ? 0 : ha === "am" ? -1 : 1);
    })
    .join(",");
}

/** Demi-journée(s) couverte(s) par un créneau : « journée entière » (horaires vides) = les deux. */
export function slotHalfDays(slot: { startTime: string; endTime: string }): HalfDay[] {
  const s = (slot.startTime || "").slice(0, 5);
  const e = (slot.endTime || "").slice(0, 5);
  if (!s || !e) return ["am", "pm"];
  return s < NOON ? ["am"] : ["pm"];
}

/** Le créneau (jour + horaires) tombe-t-il dans une des demi-journées déclarées ? */
export function slotMatchesDispos(
  slot: { dayKey: string; startTime: string; endTime: string },
  dispos: ReadonlySet<string>,
): boolean {
  return slotHalfDays(slot).some((h) => dispos.has(dispoKey(slot.dayKey, h)));
}

/** « Lundi matin » (libellés e-mails, écran gestionnaire). */
export function dispoLabel(key: string): string {
  const [day, half] = key.split("-");
  const d = DAY_NAMES[day] ?? day;
  const h = HALF_DAY_LABEL[half as HalfDay] ?? half;
  return `${d} ${h.toLowerCase()}`;
}

/** Libellés triés d'un ensemble de clés (« Lundi matin, Jeudi après-midi »). */
export function dispoLabels(csv: string | null | undefined): string[] {
  return serializeDispos(parseDispos(csv)).split(",").filter(Boolean).map(dispoLabel);
}
