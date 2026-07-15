import { escapeHtml, wrapEmailHtml } from "@/lib/email-theme";
import { parisParts } from "@/lib/paris-time";
import { DAYS } from "@/schemas/config";
import { getAppUrl } from "@/server/config";
import { prisma } from "@/server/db";
import { sendMailOrQueue } from "@/server/mailer";
import { formatSlotLabel, resolvePeriodLabels } from "@/server/services/booking-mail";
import {
  getMailTemplate,
  htmlToText,
  renderHtmlTemplate,
  renderSubjectTemplate,
} from "@/server/services/mail-templates";

// ════════════════════════════════════════════════════════════
//  Digest de notification des gestionnaires sur les AUTO-VALIDATIONS.
//
//  Configuration PAR SERVICE (colonnes `Service.mgrNotice*`, réglées dans
//  Paramètres > Réservations) :
//    - none   : aucune
//    - hours  : toutes les N heures
//    - daily  : quotidienne à H h
//    - weekly : hebdomadaire le <jour> à H h
//
//  Déclenché à chaque passage du cron auto-validate (~15 min) : pour chaque
//  service dont l'échéance est atteinte, on envoie à ses gestionnaires la liste de
//  ses réservations auto-validées depuis son curseur `mgrNoticeLastSentAt`.
// ════════════════════════════════════════════════════════════

export type NoticeMode = "none" | "hours" | "daily" | "weekly";
// Jours : alias de la source unique DAYS (schemas/config). Réexporté car consommé
// par reservations/actions.ts via z.enum(WEEKDAYS) (audit duplication D2).
export const WEEKDAYS = DAYS;
export type Weekday = (typeof DAYS)[number];

export function normalizeMode(v: string): NoticeMode {
  return v === "hours" || v === "daily" || v === "weekly" ? v : "none";
}
export function normalizeWeekday(v: string): Weekday {
  return (WEEKDAYS as readonly string[]).includes(v) ? (v as Weekday) : "lun";
}

export type DueConfig = {
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
 * Pour chaque service dont l'échéance est atteinte, envoie à ses gestionnaires le
 * digest de ses réservations auto-validées depuis son curseur. Best-effort ; le
 * curseur avance même sans destinataire (pas de re-balayage). Renvoie le nombre de
 * services notifiés et d'e-mails envoyés.
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
  // Gabarit éditable « Auto-validations » (Messagerie > E-mails automatiques), portée
  // globale. La liste des réservations est injectée via la variable BRUTE {{liste}}.
  const digestTpl = await getMailTemplate("manager_digest");
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

    const bookings = await prisma.booking.findMany({
      where: { serviceId: svc.id, autoValidatedAt: { gt: cfg.lastSentAt, lte: now } },
      select: {
        periodId: true,
        user: { select: { prenom: true, nom: true, email: true } },
        slot: { select: { startTime: true, endTime: true, slotDate: true, slotDay: true } },
      },
      orderBy: { autoValidatedAt: "asc" },
    });

    if (managers.length > 0 && bookings.length > 0) {
      // Libellés de période résolus en batch (anti-N+1) avant de composer la liste.
      const periodLabels = await resolvePeriodLabels(
        bookings.map((r) => ({
          serviceId: svc.id,
          periodId: r.periodId,
          slotDate: r.slot.slotDate,
        })),
      );
      const items = bookings.map((r, idx) => {
        const name = `${r.user.prenom} ${r.user.nom}`.trim() || r.user.email || "Usager";
        const creneau = formatSlotLabel(r.slot);
        const periode = periodLabels[idx] ?? "";
        return `<li style="margin:.2rem 0">${escapeHtml(name)} — ${escapeHtml(creneau)}${periode ? ` · ${escapeHtml(periode)}` : ""}</li>`;
      });
      const liste = `<ul style="padding-left:1.2em">${items.join("")}</ul>`;
      const vars = { service: svc.label, nombre: String(bookings.length) };
      const subject = renderSubjectTemplate(digestTpl.subject, vars);
      const inner = renderHtmlTemplate(digestTpl.html, vars, { liste });
      const html = wrapEmailHtml(inner, { preheader: subject, appUrl });
      const text = htmlToText(inner);
      for (const to of managers) {
        await sendMailOrQueue({ to, subject, html, text });
        emails += 1;
      }
      notified += 1;
    }

    // Avance le curseur même sans envoi (réservations sans gestionnaire non re-balayées).
    await setCursor(svc.id, now);
  }

  return { services: notified, emails };
}
