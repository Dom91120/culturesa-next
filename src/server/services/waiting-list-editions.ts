import { DATE_FMT_FR as dateFmt } from "@/lib/format";
import { formatSlotLabel, waitlistDeletionLabel } from "@/lib/slot-label";
import { dispoLabels, parsePeriodIds, waitlistDeadline } from "@/lib/waiting-list";
import {
  type DayDemand,
  type DemandEntry,
  daysBetween,
  demandByHalfDay,
  demandByPeriod,
  type PeriodDemand,
} from "@/lib/waiting-list-editions";
import { OUTCOME_LABELS_ROW, type WaitlistOutcome } from "@/lib/waiting-list-stats";
import { prisma } from "@/server/db";

// ─── Éditions de la liste d'attente (onglet Éditions, Dom 2026-09-07) ─────────────
// Cinq éditions : liste d'attente en cours, demande par demi-journée, historique des
// inscriptions, placements, adresses des inscrits. Les deux éditions d'HISTORIQUE sont
// scopées à l'exercice sélectionné par la DATE D'INSCRIPTION (comme les statistiques) ;
// les trois autres décrivent l'ÉTAT DU JOUR.

const toYmd = (d: Date) => d.toISOString().slice(0, 10);

/** Plage de dates d'un exercice (bornes incluses) pour filtrer `inscritAt`. */
export type InscritRange = { from: Date | null; to: Date | null };

function inscritAtWhere(range: InscritRange | undefined) {
  if (!range || (!range.from && !range.to)) return {};
  const to = range.to ? new Date(range.to.getTime() + 86_400_000 - 1) : undefined;
  return { inscritAt: { ...(range.from ? { gte: range.from } : {}), ...(to ? { lte: to } : {}) } };
}

async function periodLabels(serviceId: string): Promise<Map<number, string>> {
  const rows = await prisma.period.findMany({
    where: { serviceId },
    select: { id: true, label: true },
  });
  return new Map(rows.map((p) => [p.id, p.label]));
}

// ─── 2. Demande par demi-journée ───────────────────────────────────────────────────

export type WaitingDemand = {
  inscrits: number;
  auto: number;
  byHalfDay: DayDemand[];
  byPeriod: PeriodDemand[];
};

/**
 * Demande du jour : disponibilités des inscrits par demi-journée (jours d'ouverture de
 * l'exercice visible + jours déclarés) et par période souhaitée (exercice visible).
 */
export async function waitingDemand(serviceId: string): Promise<WaitingDemand> {
  const [entries, exo] = await Promise.all([
    prisma.waitingListEntry.findMany({
      where: { serviceId },
      select: { disponibilites: true, periodIds: true, autoInscription: true },
    }),
    prisma.exercice.findFirst({
      where: { serviceId, visibleToUsers: true },
      select: {
        activeDays: true,
        periods: { orderBy: { dateStart: "asc" }, select: { id: true, label: true } },
      },
    }),
  ]);
  const demand: DemandEntry[] = entries.map((e) => ({
    dispos: e.disponibilites,
    periodIds: parsePeriodIds(e.periodIds),
    autoInscription: e.autoInscription,
  }));
  const openDays = (exo?.activeDays ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    inscrits: entries.length,
    auto: entries.filter((e) => e.autoInscription).length,
    byHalfDay: demandByHalfDay(demand, openDays),
    byPeriod: demandByPeriod(demand, exo?.periods ?? []),
  };
}

// ─── 3. Historique des inscriptions ────────────────────────────────────────────────

export type WaitingHistoryRow = {
  id: number;
  usager: string; // « NOM Prénom » ou « Compte anonymisé »
  email: string;
  structure: string; // figée à la clôture (repli catégorie)
  dispos: string[];
  periodes: string[];
  autoInscription: boolean;
  inscritLe: string;
  inscritYmd: string;
  clotureLe: string;
  clotureYmd: string;
  delaiJours: number;
  issue: WaitlistOutcome;
  issueLabel: string;
  reservation: string; // créneau (+ période) de la réservation obtenue, figé à la clôture, sinon ""
  // « annulée par l'usager le … », « supprimée par le service le … (NOM Prénom) »… ; "" sinon.
  suppression: string;
};

/** Historique des inscriptions closes (date d'inscription dans la plage), plus récentes d'abord. */
export async function listWaitingHistory(
  serviceId: string,
  range?: InscritRange,
): Promise<WaitingHistoryRow[]> {
  const [rows, labels] = await Promise.all([
    prisma.waitingListLog.findMany({
      where: { serviceId, ...inscritAtWhere(range) },
      orderBy: [{ inscritAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        demandeurLabel: true,
        structureLabel: true,
        disponibilites: true,
        periodIds: true,
        autoInscription: true,
        inscritAt: true,
        clotureAt: true,
        issue: true,
        creneauLabel: true,
        periodeLabel: true,
        reservationSupprimeeAt: true,
        reservationSupprimeePar: true,
        reservationSupprimeeMode: true,
        user: { select: { nom: true, prenom: true, email: true, anonymizedAt: true } },
        booking: {
          select: {
            period: { select: { label: true } },
            slot: { select: { startTime: true, endTime: true, slotDate: true, slotDay: true } },
          },
        },
      },
    }),
    periodLabels(serviceId),
  ]);
  return rows.map((r) => {
    const anon = !r.user || r.user.anonymizedAt !== null || r.issue === "ANONYMIZED";
    // Libellé figé à la clôture ; repli sur la réservation vivante (lignes antérieures).
    const slot = r.booking?.slot;
    const reservation = r.creneauLabel
      ? [r.creneauLabel, r.periodeLabel].filter(Boolean).join(" · ")
      : slot
        ? [formatSlotLabel(slot), r.booking?.period?.label].filter(Boolean).join(" · ")
        : "";
    const suppression = waitlistDeletionLabel(
      r.reservationSupprimeeMode,
      r.reservationSupprimeeAt?.toISOString() ?? null,
      r.reservationSupprimeePar,
    );
    return {
      id: r.id,
      usager: anon ? "Compte anonymisé" : `${r.user?.nom ?? ""} ${r.user?.prenom ?? ""}`.trim(),
      email: anon ? "" : (r.user?.email ?? ""),
      structure: r.structureLabel || r.demandeurLabel,
      dispos: dispoLabels(r.disponibilites),
      periodes: parsePeriodIds(r.periodIds).map((id) => labels.get(id) ?? `#${id}`),
      autoInscription: r.autoInscription,
      inscritLe: dateFmt.format(r.inscritAt),
      inscritYmd: toYmd(r.inscritAt),
      clotureLe: dateFmt.format(r.clotureAt),
      clotureYmd: toYmd(r.clotureAt),
      delaiJours: daysBetween(r.inscritAt.toISOString(), r.clotureAt.toISOString()),
      issue: r.issue,
      issueLabel: OUTCOME_LABELS_ROW[r.issue],
      reservation,
      suppression,
    };
  });
}

// ─── 4. Placements ─────────────────────────────────────────────────────────────────

export type WaitingPlacementRow = WaitingHistoryRow & { mode: string };

/** Inscriptions ayant abouti à une réservation (auto ou obtenue), avec le délai et le créneau. */
export async function listWaitingPlacements(
  serviceId: string,
  range?: InscritRange,
): Promise<WaitingPlacementRow[]> {
  const rows = await listWaitingHistory(serviceId, range);
  return rows
    .filter((r) => r.issue === "AUTO_BOOKED" || r.issue === "BOOKED")
    .map((r) => ({ ...r, mode: r.issue === "AUTO_BOOKED" ? "Automatique" : "Obtenue" }));
}

// ─── 5. Adresses des inscrits ──────────────────────────────────────────────────────

export type WaitingContactRow = {
  id: number;
  nom: string;
  prenom: string;
  structure: string;
  email: string;
  tel: string;
  dispos: string[];
  periodes: string[];
  autoInscription: boolean;
  inscritLe: string;
  echeance: string | null; // AAAA-MM-JJ
};

/** Inscrits du jour avec leurs coordonnées (publipostage), dans l'ordre d'inscription. */
export async function listWaitingContacts(serviceId: string): Promise<WaitingContactRow[]> {
  const [rows, labels, visible] = await Promise.all([
    prisma.waitingListEntry.findMany({
      where: { serviceId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        disponibilites: true,
        periodIds: true,
        autoInscription: true,
        createdAt: true,
        user: {
          select: {
            nom: true,
            prenom: true,
            email: true,
            tel: true,
            structure: { select: { label: true } },
            demandeur: { select: { label: true } },
          },
        },
      },
    }),
    periodLabels(serviceId),
    prisma.period.findMany({
      where: { serviceId, exercice: { visibleToUsers: true } },
      select: { id: true, dateEnd: true },
    }),
  ]);
  const periods = visible.map((p) => ({ id: p.id, dateEnd: p.dateEnd ? toYmd(p.dateEnd) : null }));
  return rows.map((r) => {
    const ids = parsePeriodIds(r.periodIds);
    return {
      id: r.id,
      nom: r.user.nom,
      prenom: r.user.prenom,
      structure: r.user.structure?.label ?? r.user.demandeur?.label ?? "",
      email: r.user.email ?? "",
      tel: r.user.tel ?? "",
      dispos: dispoLabels(r.disponibilites),
      periodes: ids.map((id) => labels.get(id) ?? `#${id}`),
      autoInscription: r.autoInscription,
      inscritLe: dateFmt.format(r.createdAt),
      echeance: waitlistDeadline(ids, periods),
    };
  });
}
