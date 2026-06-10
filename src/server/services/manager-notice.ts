import { wrapEmailHtml } from "@/lib/email-theme";
import { prisma } from "@/server/db";
import { sendMailOrQueue } from "@/server/mailer";
import { formatSlotLabel, resolvePeriodLabel } from "@/server/services/booking-mail";
import { htmlToText } from "@/server/services/mail-templates";

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
export const WEEKDAYS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

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

// ── Calendrier Europe/Paris (indépendant du fuseau serveur) ─────────────────
const PARIS = "Europe/Paris";
function parisParts(d: Date): { dateKey: string; hour: number; weekday: Weekday } {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: PARIS,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  const wkMap: Record<string, Weekday> = {
    Mon: "lun",
    Tue: "mar",
    Wed: "mer",
    Thu: "jeu",
    Fri: "ven",
    Sat: "sam",
    Sun: "dim",
  };
  return {
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    weekday: wkMap[get("weekday")] ?? "lun",
  };
}

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

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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
      const items = await Promise.all(
        bookings.map(async (r) => {
          const name = `${r.user.prenom} ${r.user.nom}`.trim() || r.user.email || "Usager";
          const creneau = formatSlotLabel(r.slot);
          const periode = await resolvePeriodLabel({
            serviceId: svc.id,
            periodId: r.periodId,
            slotDate: r.slot.slotDate,
          });
          return `<li style="margin:.2rem 0">${escapeHtml(name)} — ${escapeHtml(creneau)}${periode ? ` · ${escapeHtml(periode)}` : ""}</li>`;
        }),
      );
      const inner = `<p>Bonjour,</p>
<p>${bookings.length} réservation(s) ont été <strong>validées automatiquement</strong> pour « ${escapeHtml(svc.label)} » depuis la dernière notification :</p>
<ul style="padding-left:1.2em">${items.join("")}</ul>
<p>Vous pouvez les consulter dans l'agenda du service sur CultuRésa.</p>`;
      const subject = `Auto-validations — ${svc.label}`;
      const html = wrapEmailHtml(inner, { preheader: subject });
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
