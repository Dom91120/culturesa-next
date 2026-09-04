import type { Prisma } from "@/generated/prisma/client";
import { BookingError } from "@/server/services/bookings";

// ─── Absence PRÉVENUE À L'AVANCE sur une séance datée ──────────────────────
// L'usager (depuis son agenda) ou le gestionnaire (prévenu par ailleurs) signale
// qu'une séance À VENIR ne sera pas honorée. Distinct du pointage : la réservation
// reste en place (jauge inchangée, pas de verrou), le pointage posé après la séance
// reste la référence des statistiques — le signalement ne fait que pré-remplir le
// pointage « absent » (premier clic en mode pointage) et informer par e-mail.

export type AbsenceSource = "usager" | "gestionnaire";

/** Données minimales d'une réservation pour juger si une absence y est déclarable. */
export type AbsenceCandidate = {
  bookingType: string;
  pointage: string | null;
  slot: { slotDate: Date | null };
};

/** Sélection Prisma correspondant à `AbsenceCandidate` (+ id). */
export const ABSENCE_CANDIDATE_SELECT = {
  id: true,
  bookingType: true,
  pointage: true,
  slot: { select: { slotDate: true } },
} as const;

export const MAX_ABSENCE_MOTIF = 255;

/**
 * Règles (pures, partagées usager/gestionnaire) : une absence se signale sur une
 * SÉANCE DATÉE (occurrence d'une récurrente ou ponctuelle autonome — jamais sur la
 * parente récurrente, dont le pointage est aussi par occurrence) et NON POINTÉE (le
 * pointage constate le réel, il prime sur le signalement). Côté USAGER, la séance doit
 * en outre être À VENIR (jour même inclus : on n'est pas à l'heure près) — il ne
 * « prévient » pas après coup. Le GESTIONNAIRE (`allowPast`) peut au contraire
 * consigner a posteriori qu'il avait été prévenu, tant que la séance n'est pas pointée :
 * c'est ce qui distingue ensuite « Absent (prévenu) » d'une absence sèche (retour Dom
 * 2026-09-04). Le retrait obéit aux mêmes règles. Lève `BookingError`.
 */
export function assertAbsenceDeclarable(
  b: AbsenceCandidate,
  todayYmd: string,
  opts?: { allowPast?: boolean },
): void {
  if (b.bookingType === "recurring" || b.slot.slotDate == null) {
    throw new BookingError("Une absence se signale sur une séance datée.");
  }
  if (b.pointage != null) {
    throw new BookingError("Séance déjà pointée : le signalement d'absence n'est plus modifiable.");
  }
  if (!opts?.allowPast && b.slot.slotDate.toISOString().slice(0, 10) < todayYmd) {
    throw new BookingError("Cette séance est passée : son absence relève du pointage.");
  }
}

/** « YYYY-MM-DD » strict (date de signalement saisie par le gestionnaire). */
export const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Horodatage d'un signalement daté par le gestionnaire : midi (heure de Paris, UTC+1/+2)
 * du jour choisi → l'affichage « le JJ/MM/AAAA » en heure de Paris retombe sur ce jour
 * quelle que soit la saison.
 */
export function absencePrevenueAtFromYmd(ymd: string): Date {
  return new Date(`${ymd}T12:00:00+02:00`);
}

/**
 * Données d'écriture Prisma pour poser (`absent` = true) ou retirer une absence
 * prévenue. Le motif (facultatif) est écrit dans `pointageMotif` — même champ que le
 * motif d'une absence pointée, qui réapparaît ainsi au pointage. `undefined` = ne pas
 * toucher au motif stocké ; au retrait, le motif est CONSERVÉ (même convention que le
 * pointage : il réapparaît si l'absence est réactivée). `prevenuAt` : date du
 * signalement choisie (gestionnaire, saisie a posteriori) — sinon maintenant.
 */
export function absenceWriteData(
  absent: boolean,
  par: AbsenceSource,
  motif: string | undefined,
  prevenuAt?: Date,
): Prisma.BookingUpdateInput {
  const motifData =
    motif !== undefined ? { pointageMotif: motif.trim().slice(0, MAX_ABSENCE_MOTIF) } : {};
  return absent
    ? { absencePrevenueAt: prevenuAt ?? new Date(), absencePrevenuePar: par, ...motifData }
    : { absencePrevenueAt: null, absencePrevenuePar: null, ...motifData };
}
