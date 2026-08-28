import type { Prisma } from "@/generated/prisma/client";
import { escapeHtml } from "@/lib/email-theme";
import { parisParts } from "@/lib/paris-time";
import { DAYS } from "@/schemas/config";
import { getAppUrl } from "@/server/config";
import { prisma } from "@/server/db";
import { sendMailOrQueue } from "@/server/mailer";
import { formatSlotLabel, resolvePeriodLabels } from "@/server/services/booking-mail";
import { buildTemplatedMail } from "@/server/services/mail-send";
import { getMailTemplate } from "@/server/services/mail-templates";

// ════════════════════════════════════════════════════════════
//  Digests de notification des gestionnaires. DEUX récapitulatifs, envoyés au même
//  rythme et sur le même curseur :
//    - « Auto-validations »      (manager_digest)      : réservations validées
//      automatiquement depuis la dernière notification ;
//    - « Nouvelles réservations » (manager_new_bookings) : réservations DÉPOSÉES
//      depuis la dernière notification — demandes en attente ET confirmées, groupées
//      par nature (demandes d'abord, réservations ensuite).
//  Un service peut recevoir l'un, l'autre, les deux ou aucun sur un même passage,
//  selon ce que la fenêtre contient ; un récapitulatif vide n'est pas envoyé.
//
//  Configuration PAR SERVICE (colonnes `Service.mgrNotice*`, réglées dans
//  Paramètres > Réservations) :
//    - none   : aucune
//    - each   : unitaires — un e-mail PAR réservation, sans attendre d'échéance
//    - hours  : toutes les N heures
//    - daily  : quotidienne à H h
//    - weekly : hebdomadaire le <jour> à H h
//
//  `each` est le seul mode où rien ne s'accumule : l'échéance est toujours atteinte,
//  et chaque réservation part dans son propre e-mail plutôt que dans une liste. Il
//  emprunte néanmoins le MÊME chemin que les autres — le balayage du cron —, et non
//  un envoi greffé sur la création de réservation : une notification qui dépendrait
//  du chemin d'écriture emprunté (usager, administration, récurrence, auto-validation)
//  finirait par en oublier un. La contrepartie est la granularité du cron : « sans
//  attendre » signifie « sans attendre d'échéance de regroupement », soit au plus
//  tard au passage suivant (15 min par défaut, cf. Tâches planifiées).
//
//  Déclenché à chaque passage du cron auto-validate (~15 min) : pour chaque
//  service dont l'échéance est atteinte, on envoie à ses gestionnaires ce qui s'est
//  produit depuis son curseur `mgrNoticeLastSentAt`. Curseur UNIQUE pour les deux
//  récapitulatifs : ils partagent la cadence, donc avancent toujours ensemble —
//  une seconde colonne n'apporterait rien qu'un risque de dérive.
// ════════════════════════════════════════════════════════════

export type NoticeMode = "none" | "each" | "hours" | "daily" | "weekly";
// Jours : alias de la source unique DAYS (schemas/config). Réexporté car consommé
// par config/actions.ts (notification gestionnaires) via z.enum(WEEKDAYS).
export const WEEKDAYS = DAYS;
type Weekday = (typeof DAYS)[number];

function normalizeMode(v: string): NoticeMode {
  return v === "each" || v === "hours" || v === "daily" || v === "weekly" ? v : "none";
}
function normalizeWeekday(v: string): Weekday {
  return (WEEKDAYS as readonly string[]).includes(v) ? (v as Weekday) : "lun";
}

type DueConfig = {
  mode: NoticeMode;
  intervalHours: number;
  hour: number;
  weekday: Weekday;
  lastSentAt: Date | null;
};

// Calendrier Europe/Paris (heure murale, DST) : source unique dans lib/paris-time.

/** Le digest d'un service est-il dû à `now`, vu son mode et son dernier envoi ? */
export function isDigestDue(cfg: DueConfig, now: Date): boolean {
  if (cfg.mode === "none") return false;
  // Unitaires : jamais d'attente, l'échéance est toujours atteinte. Le curseur suffit
  // à ne pas renvoyer deux fois la même réservation.
  if (cfg.mode === "each") return true;
  if (cfg.mode === "hours") {
    if (!cfg.lastSentAt) return true; // baseline posée par sendManagerDigest
    return now.getTime() - cfg.lastSentAt.getTime() >= cfg.intervalHours * 3_600_000;
  }
  const np = parisParts(now);
  const sentToday = cfg.lastSentAt && parisParts(cfg.lastSentAt).dateKey === np.dateKey;
  if (cfg.mode === "daily") return np.hour >= cfg.hour && !sentToday;
  return np.weekday === cfg.weekday && np.hour >= cfg.hour && !sentToday; // weekly
}

const setCursor = (serviceId: string, at: Date) =>
  prisma.service.update({ where: { id: serviceId }, data: { mgrNoticeLastSentAt: at } });

/**
 * Liste HTML d'un groupe de réservations, injectée dans `{{liste}}` (variable BRUTE du
 * gabarit : les données utilisateur y sont donc échappées une à une). Les libellés de
 * période sont résolus en un seul lot (anti-N+1) ; une période vide est omise.
 *   Marie Martin — lundi 09:00 – 10:30 · Vacances de printemps
 */
async function buildNoticeList(serviceId: string, rows: NoticeRow[]): Promise<string> {
  const periodLabels = await resolvePeriodLabels(
    rows.map((r) => ({ serviceId, periodId: r.periodId, slotDate: r.slot.slotDate })),
  );
  const items = rows.map((r, idx) => {
    const name = `${r.user.prenom} ${r.user.nom}`.trim() || r.user.email || "Usager";
    const creneau = formatSlotLabel(r.slot);
    const periode = periodLabels[idx] ?? "";
    return `<li style="margin:.2rem 0">${escapeHtml(name)} — ${escapeHtml(creneau)}${periode ? ` · ${escapeHtml(periode)}` : ""}</li>`;
  });
  return `<ul style="padding-left:1.2em">${items.join("")}</ul>`;
}

/**
 * Liste du récapitulatif « Nouvelles réservations », GROUPÉE par nature : les demandes
 * en attente d'abord, les réservations confirmées ensuite, chacune sous son intitulé
 * suivi de son nombre. L'intitulé portant la nature, les lignes n'ont pas de préfixe ;
 * un groupe vide est entièrement omis (intitulé compris).
 */
async function buildGroupedNoticeList(serviceId: string, rows: NoticeRow[]): Promise<string> {
  const groups: [string, NoticeRow[]][] = [
    ["Demandes de réservation", rows.filter((r) => !r.validated)],
    ["Réservations", rows.filter((r) => r.validated)],
  ];
  const parts: string[] = [];
  for (const [title, group] of groups) {
    if (group.length === 0) continue;
    parts.push(
      `<p style="margin:.6rem 0 .2rem"><strong>${title} (${group.length})</strong></p>`,
      await buildNoticeList(serviceId, group),
    );
  }
  return parts.join("");
}

// Colonnes nécessaires à une ligne de récapitulatif (les deux requêtes les partagent).
const NOTICE_SELECT = {
  periodId: true,
  validated: true,
  user: { select: { prenom: true, nom: true, email: true } },
  slot: { select: { startTime: true, endTime: true, slotDate: true, slotDay: true } },
} satisfies Prisma.BookingSelect;

/** Une ligne de récapitulatif : usager, créneau, période — et nature si demandée. */
type NoticeRow = Prisma.BookingGetPayload<{ select: typeof NOTICE_SELECT }>;

/**
 * Pour chaque service dont l'échéance est atteinte, envoie à ses gestionnaires les
 * récapitulatifs de ce qui s'est produit depuis son curseur : réservations
 * auto-validées, et réservations déposées (en attente + confirmées). Best-effort ; le
 * curseur avance même sans destinataire (pas de re-balayage). Renvoie le nombre de
 * services notifiés (au moins un e-mail parti) et d'e-mails envoyés.
 */
export async function sendManagerDigest(now: Date = new Date()): Promise<{
  services: number;
  emails: number;
}> {
  const services = await prisma.service.findMany({
    where: { mgrNoticeMode: { not: "none" } },
    select: {
      id: true,
      label: true,
      mgrNoticeMode: true,
      mgrNoticeIntervalHours: true,
      mgrNoticeHour: true,
      mgrNoticeWeekday: true,
      mgrNoticeLastSentAt: true,
      // Sécurité : seuls les comptes gestionnaire reçoivent le digest (au cas où la
      // relation ServiceManager serait un jour réutilisée pour d'autres rôles).
      managers: {
        where: { user: { role: "gestionnaire" } },
        select: { user: { select: { email: true } } },
      },
    },
  });

  const appUrl = await getAppUrl();
  // Gabarits éditables (Administration › Échanges › « Modèles d'e-mails »), portée
  // globale. La liste des réservations est injectée via la variable BRUTE {{liste}}.
  const [digestTpl, newBookingsTpl] = await Promise.all([
    getMailTemplate("manager_digest"),
    getMailTemplate("manager_new_bookings"),
  ]);
  let notified = 0;
  let emails = 0;

  for (const svc of services) {
    const cfg: DueConfig = {
      mode: normalizeMode(svc.mgrNoticeMode),
      intervalHours: svc.mgrNoticeIntervalHours,
      hour: svc.mgrNoticeHour,
      weekday: normalizeWeekday(svc.mgrNoticeWeekday),
      lastSentAt: svc.mgrNoticeLastSentAt,
    };
    if (!isDigestDue(cfg, now)) continue;

    // Première échéance sans curseur : on pose la baseline et on n'envoie rien.
    if (!cfg.lastSentAt) {
      await setCursor(svc.id, now);
      continue;
    }

    const managers = svc.managers
      .map((m) => m.user.email?.trim())
      .filter((e): e is string => !!e?.includes("@"));

    const [autoValidated, created] = await Promise.all([
      prisma.booking.findMany({
        where: { serviceId: svc.id, autoValidatedAt: { gt: cfg.lastSentAt, lte: now } },
        select: NOTICE_SELECT,
        orderBy: { autoValidatedAt: "asc" },
      }),
      // Nouvelles réservations : demandes en attente ET confirmées (le statut figure
      // dans la liste). Les occurrences MIROIRS d'une récurrente sont exclues —
      // sinon une seule réservation en ferait apparaître une quarantaine.
      prisma.booking.findMany({
        where: {
          serviceId: svc.id,
          parentBookingId: null,
          createdAt: { gt: cfg.lastSentAt, lte: now },
        },
        select: NOTICE_SELECT,
        orderBy: { createdAt: "asc" },
      }),
    ]);

    if (managers.length > 0) {
      // Un récapitulatif vide n'est pas envoyé : sur un même passage, un service peut
      // donc recevoir l'un, l'autre, les deux, ou rien.
      const digests: { rows: NoticeRow[]; tpl: typeof digestTpl; grouped: boolean }[] = [
        { rows: autoValidated, tpl: digestTpl, grouped: false },
        // Nouvelles réservations : lignes regroupées par nature (demandes / réservations).
        { rows: created, tpl: newBookingsTpl, grouped: true },
      ];
      let sentForService = false;
      for (const d of digests) {
        if (d.rows.length === 0) continue;
        // Unitaires : un lot PAR réservation, donc un e-mail par réservation. Les
        // autres modes n'en font qu'un, portant la liste entière. Même gabarit dans
        // les deux cas : `{{nombre}}` vaut alors 1 et `{{liste}}` tient sur une ligne.
        const lots: NoticeRow[][] = cfg.mode === "each" ? d.rows.map((r) => [r]) : [d.rows];
        for (const lot of lots) {
          const liste = d.grouped
            ? await buildGroupedNoticeList(svc.id, lot)
            : await buildNoticeList(svc.id, lot);
          const vars = { service: svc.label, nombre: String(lot.length) };
          const built = buildTemplatedMail(d.tpl, vars, appUrl, { liste });
          for (const to of managers) {
            await sendMailOrQueue({ to, ...built });
            emails += 1;
          }
        }
        sentForService = true;
      }
      if (sentForService) notified += 1;
    }

    // Avance le curseur même sans envoi (réservations sans gestionnaire non re-balayées).
    await setCursor(svc.id, now);
  }

  return { services: notified, emails };
}
