import { deleteConfig, getConfigMany, setConfig } from "@/server/config";
import { prisma } from "@/server/db";
import { isCustomMailType, listCustomMailTypes } from "@/server/services/mail-templates";

// Types d'e-mail liés aux réservations (chacun a un gabarit/contenu, cf. mail-templates).
// L'ENVOI est piloté PAR ACTION (déclencheur) — voir plus bas ; il n'y a plus de réglage
// d'envoi par type (les e-mails système, eux, sont toujours envoyés).
export const MAIL_KINDS = [
  "booking_confirmed",
  "booking_pending",
  "booking_unvalidated",
  "booking_cancelled",
  "booking_refused",
  "booking_reminder",
] as const;

export type MailKind = (typeof MAIL_KINDS)[number];

// ════════════════════════════════════════════════════════════
//  Contrôle PAR ACTION (déclencheur).
//
//  Chaque ACTION métier qui envoie un e-mail de réservation a sa propre préférence
//  « Envoyer » : on peut couper une action précise sans toucher aux autres qui
//  partagent le même type d'e-mail (ex. désactiver l'e-mail sur l'auto-validation
//  tout en le gardant sur la validation manuelle). Le CONTENU reste, lui, défini par
//  TYPE d'e-mail (un seul gabarit par type, cf. mail-templates).
// ════════════════════════════════════════════════════════════
export const BOOKING_TRIGGERS = [
  "pending_create",
  "unvalidate",
  "refuse",
  "reminder",
  "cancel_user",
  "cancel_manager",
  "confirm_create",
  "confirm_manager_create",
  "confirm_validate",
  "confirm_autovalidate",
] as const;
export type BookingTrigger = (typeof BOOKING_TRIGGERS)[number];

/**
 * Définition d'un déclencheur : clé (contrat avec le code), libellé affiché, type d'e-mail
 * par défaut et ordre d'affichage. Persisté dans la table `mail_triggers` (cf. listMailTriggers) ;
 * cette liste sert au seed et de repli si la table n'est pas encore peuplée.
 */
export type MailTriggerDef = {
  key: BookingTrigger;
  label: string;
  defaultKind: MailKind;
  position: number;
};

const DEFAULT_MAIL_TRIGGERS: MailTriggerDef[] = [
  {
    key: "pending_create",
    label: "L'usager crée une demande de réservation (mode validation activé)",
    defaultKind: "booking_pending",
    position: 1,
  },
  {
    key: "unvalidate",
    label: "Le gestionnaire dévalide une réservation",
    defaultKind: "booking_unvalidated",
    position: 2,
  },
  {
    key: "refuse",
    label: "Le gestionnaire refuse / supprime une demande de réservation",
    defaultKind: "booking_refused",
    position: 3,
  },
  {
    key: "reminder",
    label: "Rappel de réservation (J-7 et J-1)",
    defaultKind: "booking_reminder",
    position: 4,
  },
  {
    key: "cancel_user",
    label: "L'usager annule une réservation validée",
    defaultKind: "booking_cancelled",
    position: 5,
  },
  {
    key: "cancel_manager",
    label: "Le gestionnaire supprime une réservation validée",
    defaultKind: "booking_cancelled",
    position: 6,
  },
  {
    key: "confirm_create",
    label: "L'usager crée une réservation (mode validation désactivé)",
    defaultKind: "booking_confirmed",
    position: 7,
  },
  {
    key: "confirm_manager_create",
    label: "Le gestionnaire crée une réservation",
    defaultKind: "booking_confirmed",
    position: 8,
  },
  {
    key: "confirm_validate",
    label: "Le gestionnaire valide une demande de réservation",
    defaultKind: "booking_confirmed",
    position: 9,
  },
  {
    key: "confirm_autovalidate",
    label: "Auto-validation d'une demande de réservation après le délai configuré",
    defaultKind: "booking_confirmed",
    position: 10,
  },
];

/** Référentiel de repli des déclencheurs (utilisé pour seeder la table et si elle est vide). */
export function defaultMailTriggers(): MailTriggerDef[] {
  return DEFAULT_MAIL_TRIGGERS;
}

/** Type d'e-mail par défaut de chaque déclencheur (repli code, miroir de la table). */
export const TRIGGER_KIND = Object.fromEntries(
  DEFAULT_MAIL_TRIGGERS.map((t) => [t.key, t.defaultKind]),
) as Record<BookingTrigger, MailKind>;

export const isBookingTrigger = (v: string): v is BookingTrigger =>
  (BOOKING_TRIGGERS as readonly string[]).includes(v);

// ── Réglages PAR ACTION, désormais GLOBAUX (administrateur), plus par service ──
//  Routage (type d'e-mail), envoi (« Envoyer ») et destinataire : une seule config pour
//  TOUS les services (« Échanges par mail » au niveau administrateur). Seul le CONTENU des
//  gabarits reste surchargeable par service (cf. mail-templates / getMailTemplate).
function sendKey(t: BookingTrigger): string {
  return `mail.send.t.${t}`;
}

/** Un déclencheur envoie par défaut ; désactivé seulement si la valeur stockée = "0". */
export async function isTriggerEnabled(t: BookingTrigger): Promise<boolean> {
  const cfg = await getConfigMany([sendKey(t)]);
  return cfg[sendKey(t)] !== "0";
}

/** État (activé/désactivé) de tous les déclencheurs (global). */
export async function getTriggerPrefs(): Promise<Record<BookingTrigger, boolean>> {
  const cfg = await getConfigMany(BOOKING_TRIGGERS.map((t) => sendKey(t)));
  const out = {} as Record<BookingTrigger, boolean>;
  for (const t of BOOKING_TRIGGERS) out[t] = cfg[sendKey(t)] !== "0";
  return out;
}

/** Active/désactive l'envoi d'e-mail pour une action précise (global). */
export async function setTriggerEnabled(t: BookingTrigger, enabled: boolean): Promise<void> {
  await setConfig(sendKey(t), enabled ? "1" : "0");
}

// ── Routage déclencheur → type d'e-mail (GLOBAL) ─────────────────────────────
//  Par défaut, chaque action utilise le type d'e-mail de TRIGGER_KIND. L'administrateur
//  peut RE-ROUTER une action vers un autre type via « Échanges par mail » (global). Le
//  contenu reste celui du type choisi (surchargeable par service dans « Modèles d'e-mails »).
const isMailKind = (v: string): v is MailKind => (MAIL_KINDS as readonly string[]).includes(v);

function routeKey(t: BookingTrigger): string {
  return `mail.route.${t}`;
}

/**
 * Liste ORDONNÉE des déclencheurs depuis la table `mail_triggers` (référentiel persisté),
 * avec repli sur le code (`DEFAULT_MAIL_TRIGGERS`) si la table est vide ou absente.
 */
export async function listMailTriggers(): Promise<MailTriggerDef[]> {
  try {
    const rows = await prisma.mailTrigger.findMany({ orderBy: { position: "asc" } });
    if (rows.length > 0) {
      return rows
        .filter((r) => isBookingTrigger(r.key))
        .map((r) => ({
          key: r.key as BookingTrigger,
          label: r.label,
          defaultKind: isMailKind(r.defaultKind)
            ? r.defaultKind
            : TRIGGER_KIND[r.key as BookingTrigger],
          position: r.position,
        }));
    }
  } catch {
    // Table absente (avant migration) → repli sur le référentiel code.
  }
  return DEFAULT_MAIL_TRIGGERS;
}

/** Type d'e-mail par défaut de chaque déclencheur, depuis la base (repli code). */
async function triggerDefaultMap(): Promise<Record<BookingTrigger, MailKind>> {
  const map = { ...TRIGGER_KIND };
  try {
    const rows = await prisma.mailTrigger.findMany({ select: { key: true, defaultKind: true } });
    for (const r of rows) {
      if (isBookingTrigger(r.key) && isMailKind(r.defaultKind)) map[r.key] = r.defaultKind;
    }
  } catch {
    // repli code
  }
  return map;
}

// Un override de routage est valide si la cible existe encore : type intégré OU type
// personnalisé GLOBAL. (Le routage étant global, on ne peut pas cibler un type perso d'un
// service.) Sinon (type supprimé), on retombe sur le défaut du déclencheur.
async function isValidKind(v: string): Promise<boolean> {
  return isMailKind(v) || (await isCustomMailType(v));
}

/** Type d'e-mail EFFECTIF d'une action (global) : override si valide, sinon défaut (base). */
export async function resolveTriggerKind(t: BookingTrigger): Promise<string> {
  const defaults = await triggerDefaultMap();
  const cfg = await getConfigMany([routeKey(t)]);
  const v = cfg[routeKey(t)];
  return v && (await isValidKind(v)) ? v : defaults[t];
}

/** Mapping effectif (action → type), global, pour l'affichage du tableau. */
export async function getTriggerKinds(): Promise<Record<BookingTrigger, string>> {
  const [cfg, globalList, defaults] = await Promise.all([
    getConfigMany(BOOKING_TRIGGERS.map((t) => routeKey(t))),
    listCustomMailTypes(), // types personnalisés GLOBAUX (seuls routables en global)
    triggerDefaultMap(),
  ]);
  const custom = new Set(globalList.map((c) => c.key));
  const out = {} as Record<BookingTrigger, string>;
  for (const t of BOOKING_TRIGGERS) {
    const v = cfg[routeKey(t)];
    out[t] = v && (isMailKind(v) || custom.has(v)) ? v : defaults[t];
  }
  return out;
}

/** Re-route une action vers un type d'e-mail (global). */
export async function setTriggerKind(t: BookingTrigger, kind: string): Promise<void> {
  await setConfig(routeKey(t), kind);
}

// ── Destinataire PAR ACTION (déclencheur), GLOBAL ────────────────────────────
//  Le destinataire dépend de l'ACTION, pas du modèle. Par défaut « usager »
//  (l'usager concerné) = comportement historique. Les autres options sont
//  résolues au moment de l'envoi (gestionnaires DU SERVICE concerné par la réservation,
//  administrateurs, ou une/des adresse(s) fixe(s)).
export type MailRecipientKind = "usager" | "gestionnaires" | "administrateurs" | "fixe";
const MAIL_RECIPIENT_KINDS: readonly MailRecipientKind[] = [
  "usager",
  "gestionnaires",
  "administrateurs",
  "fixe",
];
export const isMailRecipientKind = (v: string): v is MailRecipientKind =>
  (MAIL_RECIPIENT_KINDS as readonly string[]).includes(v);

function recipientKey(t: BookingTrigger): string {
  return `mail.recipient.${t}`;
}
function recipientAddrKey(t: BookingTrigger): string {
  return `mail.recipient.${t}.addr`;
}

export type TriggerRecipient = { kind: MailRecipientKind; addr: string };

/** Réglage destinataire d'une action (défaut « usager » si absent/invalide). */
export async function getTriggerRecipient(t: BookingTrigger): Promise<TriggerRecipient> {
  const cfg = await getConfigMany([recipientKey(t), recipientAddrKey(t)]);
  const raw = cfg[recipientKey(t)];
  return {
    kind: isMailRecipientKind(raw) ? raw : "usager",
    addr: cfg[recipientAddrKey(t)] ?? "",
  };
}

/** Réglages destinataire de toutes les actions (global), pour l'affichage du tableau. */
export async function getTriggerRecipients(): Promise<Record<BookingTrigger, TriggerRecipient>> {
  const keys = BOOKING_TRIGGERS.flatMap((t) => [recipientKey(t), recipientAddrKey(t)]);
  const cfg = await getConfigMany(keys);
  const out = {} as Record<BookingTrigger, TriggerRecipient>;
  for (const t of BOOKING_TRIGGERS) {
    const raw = cfg[recipientKey(t)];
    out[t] = {
      kind: isMailRecipientKind(raw) ? raw : "usager",
      addr: cfg[recipientAddrKey(t)] ?? "",
    };
  }
  return out;
}

/**
 * Définit le destinataire d'une action (global). Le défaut « usager » n'est PAS stocké (les
 * clés sont supprimées) pour ne pas accumuler de lignes redondantes ; l'adresse fixe n'est
 * conservée que pour « fixe ».
 */
export async function setTriggerRecipient(
  t: BookingTrigger,
  kind: MailRecipientKind,
  addr: string,
): Promise<void> {
  if (kind === "usager") {
    await deleteConfig([recipientKey(t), recipientAddrKey(t)]);
    return;
  }
  await setConfig(recipientKey(t), kind);
  await setConfig(recipientAddrKey(t), kind === "fixe" ? addr : "");
}

/** Un destinataire résolu : adresse + prénom (vide si non personnalisable). `personal`
 *  = vrai uniquement pour « l'usager concerné » (salutation personnalisée). */
export type ResolvedRecipient = { email: string; prenom: string; personal: boolean };

const hasEmail = (e?: string | null): e is string => !!e && e.includes("@");

/**
 * Résout les destinataires effectifs d'une action selon son réglage et le contexte
 * (usager concerné = `ctx.userId`). Liste filtrée sur des adresses valides.
 */
export async function resolveTriggerRecipients(
  t: BookingTrigger,
  serviceId: string,
  ctx: { userId?: string | null },
): Promise<ResolvedRecipient[]> {
  // Réglage destinataire GLOBAL ; `serviceId` ne sert qu'à résoudre « gestionnaires du service ».
  const { kind, addr } = await getTriggerRecipient(t);

  if (kind === "usager") {
    if (!ctx.userId) return [];
    const u = await prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { email: true, prenom: true },
    });
    return hasEmail(u?.email)
      ? [{ email: u.email.trim(), prenom: u.prenom?.trim() ?? "", personal: true }]
      : [];
  }

  if (kind === "gestionnaires") {
    const svc = await prisma.service.findUnique({
      where: { id: serviceId },
      select: {
        managers: {
          where: { user: { role: "gestionnaire" } },
          select: { user: { select: { email: true, prenom: true } } },
        },
      },
    });
    return (svc?.managers ?? [])
      .map((m) => ({
        email: m.user.email?.trim() ?? "",
        prenom: m.user.prenom?.trim() ?? "",
        personal: false,
      }))
      .filter((r) => hasEmail(r.email));
  }

  if (kind === "administrateurs") {
    const admins = await prisma.user.findMany({
      where: { role: "administrateur", anonymizedAt: null },
      select: { email: true, prenom: true },
    });
    return admins
      .map((a) => ({ email: a.email.trim(), prenom: a.prenom?.trim() ?? "", personal: false }))
      .filter((r) => hasEmail(r.email));
  }

  // fixe : adresses saisies (séparées par virgule), aucune personnalisation.
  return addr
    .split(",")
    .map((s) => s.trim())
    .filter(hasEmail)
    .map((email) => ({ email, prenom: "", personal: false }));
}
