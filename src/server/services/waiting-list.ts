import { Prisma } from "@/generated/prisma/client";
import { ISO_DAY_KEYS } from "@/lib/agenda-core";
import { earliestBookableISO, todayParisISO } from "@/lib/booking-delay";
import { emailButton } from "@/lib/email-theme";
import { greeting } from "@/lib/mail-render";
import {
  dispoLabels,
  isDispoKey,
  parseDispos,
  parsePeriodIds,
  periodAccepted,
  serializeDispos,
  serializePeriodIds,
  slotMatchesDispos,
} from "@/lib/waiting-list";
import { getAppUrl } from "@/server/config";
import { prisma } from "@/server/db";
import { formatSlotLabel, sendBookingConfirmationMail } from "@/server/services/booking-mail";
import { BookingError } from "@/server/services/bookings";
import {
  type BookingTrigger,
  isTriggerEnabled,
  resolveTriggerKind,
  resolveTriggerRecipients,
} from "@/server/services/mail-prefs";
import { sendTemplatedMail } from "@/server/services/mail-send";
import { reservePonctuelInTx, reserveRecurringInTx } from "@/server/services/user-booking";

// ─── Liste d'attente (réglage PAR SERVICE, Paramètres > Configuration) ───────────
// Un usager dépose ses DISPONIBILITÉS par demi-journée (cf. lib/waiting-list) et,
// s'il le souhaite, demande l'INSCRIPTION AUTOMATIQUE. La tâche planifiée
// « Liste d'attente » (/api/cron/waiting-list, toutes les 5 min) parcourt les entrées
// dans l'ORDRE D'INSCRIPTION (premier inscrit servi) et, pour chacune, cherche les
// créneaux RÉSERVABLES par cet usager qui tombent dans ses disponibilités :
//   • réservable = exactement les règles de l'agenda usager (accès du demandeur,
//     période ouverte, délai, vacances, jauge, maximums…) — obtenu en rejouant le cœur
//     de réservation dans une transaction ANNULÉE (« essai à blanc »), source unique ;
//   • auto-inscription → réservation faite en son nom (participants de sa fiche),
//     e-mail de réservation habituel + e-mail « inscrit depuis la liste d'attente »,
//     puis retrait de la liste ;
//   • sinon → e-mail « des créneaux se sont libérés » — uniquement s'il y a du NOUVEAU
//     par rapport au dernier envoi (`notifiedKeys`), pour ne pas répéter le même
//     message toutes les 5 minutes.
// Décision Dom 2026-09-05 : tâche planifiée seule (pas de déclenchement immédiat à
// l'annulation), récurrents (toute la série) ET ponctuels, entrée retirée après une
// inscription automatique.

export const MAX_DISPOS = 14;
/** Créneaux détaillés au maximum dans l'e-mail « créneaux libérés ». */
const MAX_MAIL_SLOTS = 12;

export type WaitingEntryDto = {
  id: number;
  dispos: string[];
  // Périodes acceptées (ids) ; [] = toutes.
  periodIds: number[];
  autoInscription: boolean;
  createdAt: string; // ISO
};

/** Entrée de l'usager sur la liste d'attente d'un service (null si absent). */
export async function getWaitingEntry(
  serviceId: string,
  userId: string,
): Promise<WaitingEntryDto | null> {
  const e = await prisma.waitingListEntry.findUnique({
    where: { serviceId_userId: { serviceId, userId } },
    select: {
      id: true,
      disponibilites: true,
      periodIds: true,
      autoInscription: true,
      createdAt: true,
    },
  });
  return e
    ? {
        id: e.id,
        dispos: [...parseDispos(e.disponibilites)],
        periodIds: parsePeriodIds(e.periodIds),
        autoInscription: e.autoInscription,
        createdAt: e.createdAt.toISOString(),
      }
    : null;
}

/**
 * Inscrit (ou met à jour) l'usager : disponibilités (clés valides, au moins une) +
 * auto-inscription. Renvoie `created` pour n'envoyer l'e-mail de confirmation qu'à la
 * première inscription. Le rang (createdAt) est conservé lors d'une mise à jour.
 */
export async function saveWaitingEntry(
  serviceId: string,
  userId: string,
  dispos: string[],
  autoInscription: boolean,
  // Périodes acceptées : ids de l'exercice visible seulement ; toutes (ou aucune) = pas
  // de restriction, stockée vide.
  periodIds: number[] = [],
): Promise<{ created: boolean }> {
  const keys = serializeDispos(dispos.filter(isDispoKey));
  if (!keys) throw new BookingError("Indiquez au moins une demi-journée de disponibilité.");
  const periods = await prisma.period.findMany({
    where: { serviceId, exercice: { visibleToUsers: true } },
    select: { id: true },
  });
  const known = new Set(periods.map((p) => p.id));
  const wanted = parsePeriodIds(periodIds.join(",")).filter((id) => known.has(id));
  const restriction =
    wanted.length > 0 && wanted.length < known.size ? serializePeriodIds(wanted) : "";
  const existing = await prisma.waitingListEntry.findUnique({
    where: { serviceId_userId: { serviceId, userId } },
    select: { id: true },
  });
  if (existing) {
    // Disponibilités changées → les créneaux déjà signalés ne valent plus : remise à zéro
    // du mémo (on re-signalera ce qui correspond au nouveau périmètre).
    await prisma.waitingListEntry.update({
      where: { id: existing.id },
      data: { disponibilites: keys, periodIds: restriction, autoInscription, notifiedKeys: "" },
    });
    return { created: false };
  }
  await prisma.waitingListEntry.create({
    data: { serviceId, userId, disponibilites: keys, periodIds: restriction, autoInscription },
  });
  return { created: true };
}

/** Issue posée par l'appelant à la clôture (BOOKED est DÉDUIT, jamais passé). */
export type WaitingListClosure = "AUTO_BOOKED" | "LEFT" | "REMOVED" | "ANONYMIZED";

/**
 * CLÔTURE d'inscriptions en liste d'attente : chaque entrée vivante trouvée est copiée
 * dans l'historique (liste_attente_historique, catégorie / structure figées) puis
 * supprimée. Pour un retrait (usager ou gestionnaire), si l'usager a fait une réservation
 * sur le service APRÈS son inscription, l'issue devient « a réservé lui-même » (BOOKED) et
 * la réservation est liée : c'est le cas typique après un e-mail « créneau disponible ».
 * Renvoie le nombre d'entrées clôturées.
 */
export async function closeWaitingEntries(
  db: Prisma.TransactionClient,
  where: Prisma.WaitingListEntryWhereInput,
  outcome: WaitingListClosure,
  bookingId: number | null = null,
): Promise<number> {
  const entries = await db.waitingListEntry.findMany({
    where,
    select: {
      id: true,
      serviceId: true,
      userId: true,
      disponibilites: true,
      periodIds: true,
      autoInscription: true,
      createdAt: true,
      user: {
        select: { demandeur: { select: { label: true } }, structure: { select: { label: true } } },
      },
    },
  });
  for (const e of entries) {
    let issue: Prisma.WaitingListLogCreateInput["issue"] = outcome;
    let linked = bookingId;
    if (outcome === "LEFT" || outcome === "REMOVED") {
      const b = await db.booking.findFirst({
        where: {
          userId: e.userId,
          serviceId: e.serviceId,
          parentBookingId: null,
          createdAt: { gt: e.createdAt },
        },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (b) {
        issue = "BOOKED";
        linked = b.id;
      }
    }
    await db.waitingListLog.create({
      data: {
        serviceId: e.serviceId,
        userId: e.userId,
        demandeurLabel: e.user.demandeur?.label ?? "",
        structureLabel: e.user.structure?.label ?? "",
        disponibilites: e.disponibilites,
        periodIds: e.periodIds,
        autoInscription: e.autoInscription,
        inscritAt: e.createdAt,
        issue,
        bookingId: linked,
      },
    });
    await db.waitingListEntry.delete({ where: { id: e.id } });
  }
  return entries.length;
}

/** Retrait par l'usager lui-même (historisé : « a réservé » si une réservation a suivi). */
export async function deleteWaitingEntry(serviceId: string, userId: string): Promise<boolean> {
  const n = await closeWaitingEntries(prisma, { serviceId, userId }, "LEFT");
  return n > 0;
}

export type WaitingAdminRow = {
  id: number;
  userId: string;
  nom: string;
  prenom: string;
  email: string;
  structure: string;
  demandeur: string;
  dispos: string[]; // libellés « Lundi matin »
  // Libellés des périodes acceptées ; [] = toutes.
  periodes: string[];
  autoInscription: boolean;
  createdAt: string; // ISO
  lastNotifiedAt: string | null;
};

/** Liste d'attente d'un service, dans l'ordre d'inscription (écran gestionnaire). */
export async function listWaitingEntries(serviceId: string): Promise<WaitingAdminRow[]> {
  const rows = await prisma.waitingListEntry.findMany({
    where: { serviceId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      userId: true,
      disponibilites: true,
      periodIds: true,
      autoInscription: true,
      createdAt: true,
      lastNotifiedAt: true,
      user: {
        select: {
          nom: true,
          prenom: true,
          email: true,
          structure: { select: { label: true } },
          demandeur: { select: { label: true } },
        },
      },
    },
  });
  const periodLabel = new Map(
    (await prisma.period.findMany({ where: { serviceId }, select: { id: true, label: true } })).map(
      (p) => [p.id, p.label],
    ),
  );
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    nom: r.user.nom,
    prenom: r.user.prenom,
    email: r.user.email ?? "",
    structure: r.user.structure?.label ?? "",
    demandeur: r.user.demandeur?.label ?? "",
    dispos: dispoLabels(r.disponibilites),
    periodes: parsePeriodIds(r.periodIds).map((id) => periodLabel.get(id) ?? `#${id}`),
    autoInscription: r.autoInscription,
    createdAt: r.createdAt.toISOString(),
    lastNotifiedAt: r.lastNotifiedAt?.toISOString() ?? null,
  }));
}

/** Retrait d'une entrée par le gestionnaire (bornée au service : anti-IDOR). */
export async function deleteWaitingEntryById(serviceId: string, id: number): Promise<boolean> {
  const n = await closeWaitingEntries(prisma, { id, serviceId }, "REMOVED");
  return n > 0;
}

// ─── E-mails ─────────────────────────────────────────────────────────────────────

export type WaitlistTrigger = Extract<
  BookingTrigger,
  "waitlist_join" | "waitlist_available" | "waitlist_autobook"
>;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * E-mail de liste d'attente (inscription / créneaux libérés / inscription automatique) :
 * déclencheur global, destinataires du réglage, variables usager / service /
 * disponibilités / créneaux + bouton vers l'agenda. Best-effort, ne lève jamais.
 */
/**
 * Libellés des périodes souhaitées d'une inscription, dans l'ordre des périodes de
 * l'exercice visible ; aucune restriction (CSV vide) = TOUTES les périodes de l'exercice
 * (variable {{periodes}} des e-mails de liste d'attente — Dom 2026-09-06).
 */
export async function waitlistPeriodLabels(
  serviceId: string,
  periodIds: string | number[],
): Promise<string[]> {
  const periods = await prisma.period.findMany({
    where: { serviceId, exercice: { visibleToUsers: true } },
    orderBy: { dateStart: "asc" },
    select: { id: true, label: true },
  });
  const wanted = new Set(
    parsePeriodIds(Array.isArray(periodIds) ? periodIds.join(",") : periodIds),
  );
  const kept = wanted.size > 0 ? periods.filter((p) => wanted.has(p.id)) : periods;
  return (kept.length > 0 ? kept : periods).map((p) => p.label);
}

export async function sendWaitlistMail(
  trigger: WaitlistTrigger,
  params: {
    userId: string;
    serviceId: string;
    dispos: string; // CSV
    // Périodes souhaitées (CSV d'ids ou ids) ; vide = toutes.
    periodIds?: string | number[];
    creneaux?: string[]; // libellés des créneaux concernés
  },
): Promise<void> {
  try {
    if (!(await isTriggerEnabled(trigger))) return;
    const [recipients, user, service, appUrl, periodes] = await Promise.all([
      resolveTriggerRecipients(trigger, params.serviceId, { userId: params.userId }),
      prisma.user.findUnique({
        where: { id: params.userId },
        select: { prenom: true, nom: true },
      }),
      prisma.service.findUnique({ where: { id: params.serviceId }, select: { label: true } }),
      getAppUrl(),
      waitlistPeriodLabels(params.serviceId, params.periodIds ?? ""),
    ]);
    if (recipients.length === 0) return;
    const url = `${appUrl.replace(/\/$/, "")}/reservations/${params.serviceId}`;
    const creneaux = params.creneaux ?? [];
    const baseVars: Record<string, string> = {
      usager: `${user?.prenom ?? ""} ${user?.nom ?? ""}`.trim(),
      service: service?.label ?? "",
      disponibilites: dispoLabels(params.dispos).join(", "),
      periodes: periodes.join(", "),
      creneaux: creneaux.join(" ; "),
      url,
    };
    const rawVars: Record<string, string> = {
      bouton: emailButton(url, "Voir l'agenda"),
      liste_creneaux: creneaux.length
        ? `<ul>${creneaux.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>`
        : "",
    };
    const kind = await resolveTriggerKind(trigger);
    for (const r of recipients) {
      const prenom = r.personal ? r.prenom : "";
      await sendTemplatedMail({
        to: r.email,
        kind,
        vars: { ...baseVars, salutation: greeting(prenom), prenom },
        rawVars,
        serviceId: params.serviceId,
      });
    }
  } catch (e) {
    console.error(`[sendWaitlistMail ${trigger}] erreur:`, e);
  }
}

// ─── Appariement et traitement planifié ──────────────────────────────────────────

type Candidate = {
  key: string; // « rec:<slotId>:<periodId> » | « uniq:<slotId> »
  kind: "rec" | "uniq";
  slotId: string;
  periodId: number;
  dayKey: string;
  startTime: string;
  endTime: string;
  slotDate: Date | null;
  slotDay: string | null;
  periodLabel: string;
};

/** Sentinelle d'annulation de l'essai à blanc (la transaction est volontairement rejetée). */
class DryRunOk extends Error {}

const toYmd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Créneaux CANDIDATS d'un service : récurrents des périodes ouvertes de l'exercice
 * visible (série entière) + ponctuels autonomes à venir (hors délai de réservation).
 * Le filtre fin (jauge, accès, maximums…) est laissé à l'essai à blanc.
 */
async function serviceCandidates(serviceId: string, now: Date): Promise<Candidate[]> {
  const exo = await prisma.exercice.findFirst({
    where: { serviceId, visibleToUsers: true },
    select: { id: true, activeDays: true, bookingDelay: true },
  });
  if (!exo) return [];
  const periods = await prisma.period.findMany({
    where: { serviceId, exerciceId: exo.id },
    select: { id: true, label: true, dateStart: true, dateEnd: true, disponibilite: true },
  });
  if (periods.length === 0) return [];
  const today = todayParisISO(now);
  const periodLabel = new Map(periods.map((p) => [p.id, p.label]));
  // Récurrents : périodes OUVERTES (disponibilité atteinte) et NON TERMINÉES.
  const openIds = periods
    .filter(
      (p) =>
        (p.disponibilite == null || toYmd(p.disponibilite) <= today) &&
        (p.dateEnd == null || toYmd(p.dateEnd) >= today),
    )
    .map((p) => p.id);
  const activeDays = exo.activeDays
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const earliest = earliestBookableISO(exo.bookingDelay, activeDays, now);
  const [recurring, uniques] = await Promise.all([
    openIds.length
      ? prisma.slot.findMany({
          where: { serviceId, slotType: "recurring", periodId: { in: openIds } },
          select: { id: true, slotDay: true, startTime: true, endTime: true, periodId: true },
        })
      : Promise.resolve([]),
    prisma.slot.findMany({
      where: {
        serviceId,
        slotType: "unique",
        parentSlotId: null, // les miroirs se réservent via la récurrente
        periodId: { in: periods.map((p) => p.id) },
        slotDate: { gte: new Date(`${earliest}T00:00:00Z`) },
      },
      select: { id: true, slotDate: true, startTime: true, endTime: true, periodId: true },
    }),
  ]);
  const out: Candidate[] = [];
  for (const s of recurring) {
    if (!s.slotDay || s.periodId == null) continue;
    out.push({
      key: `rec:${s.id}:${s.periodId}`,
      kind: "rec",
      slotId: s.id,
      periodId: s.periodId,
      dayKey: s.slotDay,
      startTime: s.startTime,
      endTime: s.endTime,
      slotDate: null,
      slotDay: s.slotDay,
      periodLabel: periodLabel.get(s.periodId) ?? "",
    });
  }
  for (const s of uniques) {
    if (!s.slotDate) continue;
    out.push({
      key: `uniq:${s.id}`,
      kind: "uniq",
      slotId: s.id,
      periodId: s.periodId ?? 0,
      dayKey: ISO_DAY_KEYS[s.slotDate.getUTCDay()],
      startTime: s.startTime,
      endTime: s.endTime,
      slotDate: s.slotDate,
      slotDay: null,
      periodLabel: s.periodId != null ? (periodLabel.get(s.periodId) ?? "") : "",
    });
  }
  // Ordre stable : jour de semaine puis heure (l'inscription automatique prend le premier).
  const dayOrder = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"];
  out.sort(
    (a, b) =>
      dayOrder.indexOf(a.dayKey) - dayOrder.indexOf(b.dayKey) ||
      a.startTime.localeCompare(b.startTime) ||
      (a.slotDate?.getTime() ?? 0) - (b.slotDate?.getTime() ?? 0),
  );
  return out;
}

type Participants = { enfants: number; accompagnants: number };

function reserveCandidate(
  tx: Prisma.TransactionClient,
  userId: string,
  serviceId: string,
  c: Candidate,
  p: Participants,
  theme: string,
) {
  return c.kind === "rec"
    ? reserveRecurringInTx(tx, userId, serviceId, {
        slotId: c.slotId,
        periodId: c.periodId,
        theme,
        enfants: p.enfants,
        accompagnants: p.accompagnants,
      })
    : reservePonctuelInTx(tx, userId, serviceId, {
        slotId: c.slotId,
        theme,
        enfants: p.enfants,
        accompagnants: p.accompagnants,
      });
}

/**
 * « Cet usager pourrait-il réserver ce créneau maintenant ? » — rejoue le cœur de
 * réservation dans une transaction volontairement ANNULÉE : toutes les règles de
 * l'agenda usager s'appliquent, sans écrire. Thème factice : un thème obligatoire ne
 * doit pas masquer une place libre (l'usager le saisira en réservant).
 */
async function canBook(
  userId: string,
  serviceId: string,
  c: Candidate,
  p: Participants,
): Promise<boolean> {
  try {
    await prisma.$transaction(async (tx) => {
      await reserveCandidate(tx, userId, serviceId, c, p, "—");
      throw new DryRunOk();
    });
    return false;
  } catch (e) {
    if (e instanceof DryRunOk) return true;
    if (e instanceof BookingError) return false;
    if (e instanceof Prisma.PrismaClientKnownRequestError) return false; // ex. déjà réservé (uq)
    console.error("[waiting-list] essai à blanc :", e);
    return false;
  }
}

function candidateLabel(c: Candidate): string {
  const base = formatSlotLabel({
    startTime: c.startTime,
    endTime: c.endTime,
    slotDate: c.slotDate,
    slotDay: c.slotDay,
  });
  return c.kind === "rec" && c.periodLabel ? `${base} (${c.periodLabel})` : base;
}

/**
 * Traitement planifié de TOUTES les listes d'attente (services où le réglage est actif),
 * entrées dans l'ordre d'inscription. Idempotent : ne renvoie un e-mail « créneaux
 * libérés » qu'en présence de NOUVEAUX créneaux depuis le dernier envoi.
 */
export async function runWaitingList(
  now: Date = new Date(),
): Promise<{ services: number; entries: number; notified: number; booked: number }> {
  const stats = { services: 0, entries: 0, notified: 0, booked: 0 };
  const services = await prisma.service.findMany({
    where: { listeAttente: true, waitingList: { some: {} } },
    select: { id: true },
  });
  for (const svc of services) {
    stats.services++;
    const candidates = await serviceCandidates(svc.id, now);
    const entries = await prisma.waitingListEntry.findMany({
      where: { serviceId: svc.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        userId: true,
        disponibilites: true,
        periodIds: true,
        autoInscription: true,
        notifiedKeys: true,
        user: { select: { enfants: true, accompagnants: true, anonymizedAt: true } },
      },
    });
    for (const e of entries) {
      stats.entries++;
      if (e.user.anonymizedAt) {
        // Compte anonymisé : plus de destinataire ni de réservation possible.
        await closeWaitingEntries(prisma, { id: e.id }, "ANONYMIZED");
        continue;
      }
      const dispos = parseDispos(e.disponibilites);
      const periods = new Set(parsePeriodIds(e.periodIds));
      const matching = candidates.filter(
        (c) => slotMatchesDispos(c, dispos) && periodAccepted(c.periodId, periods),
      );
      if (matching.length === 0) continue;
      const participants: Participants = {
        enfants: e.user.enfants,
        // Le cœur exige au moins 1 accompagnant (fiche à 0 → 1 par défaut).
        accompagnants: Math.max(1, e.user.accompagnants),
      };
      const bookable: Candidate[] = [];
      for (const c of matching) {
        if (await canBook(e.userId, svc.id, c, participants)) bookable.push(c);
      }
      if (bookable.length === 0) {
        // Plus rien de libre : on oublie ce qui avait été signalé, pour re-signaler si
        // une place réapparaît.
        if (e.notifiedKeys) {
          await prisma.waitingListEntry.update({
            where: { id: e.id },
            data: { notifiedKeys: "" },
          });
        }
        continue;
      }

      if (e.autoInscription) {
        // Inscription automatique : premier créneau réservable (thème vide — si le
        // demandeur impose un thème, la réservation est refusée et on retombe sur la
        // simple notification). Réservation RÉELLE en transaction sérialisable.
        let done = false;
        for (const c of bookable) {
          try {
            const mail = await prisma.$transaction(
              (tx) => reserveCandidate(tx, e.userId, svc.id, c, participants, ""),
              { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
            );
            if (mail) await sendBookingConfirmationMail(mail);
            await sendWaitlistMail("waitlist_autobook", {
              userId: e.userId,
              serviceId: svc.id,
              dispos: e.disponibilites,
              periodIds: e.periodIds,
              creneaux: [candidateLabel(c)],
            });
            // Historique : la réservation qui vient d'être créée (créneau + période pour
            // un récurrent), pour le délai « inscription → place » des statistiques.
            const booked = await prisma.booking.findFirst({
              where: {
                userId: e.userId,
                serviceId: svc.id,
                slotId: c.slotId,
                ...(c.kind === "rec" ? { periodId: c.periodId } : {}),
                parentBookingId: null,
              },
              orderBy: { createdAt: "desc" },
              select: { id: true },
            });
            await closeWaitingEntries(prisma, { id: e.id }, "AUTO_BOOKED", booked?.id ?? null);
            stats.booked++;
            done = true;
            break;
          } catch (err) {
            if (err instanceof BookingError) continue; // ex. thème obligatoire, place prise entre-temps
            if (err instanceof Prisma.PrismaClientKnownRequestError) continue;
            console.error("[waiting-list] inscription automatique :", err);
          }
        }
        if (done) continue;
      }

      // Notification : seulement s'il y a du NOUVEAU par rapport au dernier envoi.
      const already = new Set(e.notifiedKeys.split(",").filter(Boolean));
      const fresh = bookable.filter((c) => !already.has(c.key));
      const keys = bookable.map((c) => c.key).join(",");
      if (fresh.length > 0) {
        // Liste bornée dans l'e-mail (un service à ponctuels peut en libérer des dizaines).
        const labels = bookable.map(candidateLabel);
        const shown = labels.slice(0, MAX_MAIL_SLOTS);
        const rest = labels.length - shown.length;
        await sendWaitlistMail("waitlist_available", {
          userId: e.userId,
          serviceId: svc.id,
          dispos: e.disponibilites,
          periodIds: e.periodIds,
          creneaux: rest > 0 ? [...shown, `… et ${rest} autre(s) créneau(x) sur l'agenda`] : shown,
        });
        await prisma.waitingListEntry.update({
          where: { id: e.id },
          data: { notifiedKeys: keys, lastNotifiedAt: now },
        });
        stats.notified++;
      } else if (keys !== e.notifiedKeys) {
        await prisma.waitingListEntry.update({ where: { id: e.id }, data: { notifiedKeys: keys } });
      }
    }
  }
  return stats;
}
