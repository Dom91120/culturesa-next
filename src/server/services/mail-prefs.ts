import { getConfigMany, setConfig } from "@/server/config";

// Préférences d'envoi des e-mails « Échanges » : pour chaque type d'e-mail lié aux
// réservations, l'application envoie (ou non) selon une clé app_config. Activé par
// défaut (comportement historique) ; désactivé uniquement si la valeur stockée = "0".

export const MAIL_KINDS = [
  "booking_confirmed",
  "booking_pending",
  "booking_cancelled",
  "booking_refused",
  "booking_reminder",
] as const;

export type MailKind = (typeof MAIL_KINDS)[number];

const KEY_BY_KIND: Record<MailKind, string> = {
  booking_confirmed: "mail.send.booking_confirmed",
  booking_pending: "mail.send.booking_pending",
  booking_cancelled: "mail.send.booking_cancelled",
  booking_refused: "mail.send.booking_refused",
  booking_reminder: "mail.send.booking_reminder",
};

// Clé de préférence : avec `serviceId` → réglage PAR SERVICE ; sans → réglage global
// (conservé pour compat ; les e-mails de réservation sont désormais réglés par service).
function sendKey(kind: MailKind, serviceId?: string): string {
  return serviceId ? `mail.send.${serviceId}.${kind}` : KEY_BY_KIND[kind];
}

/** Un type d'e-mail est activé par défaut ; désactivé seulement si la valeur = "0". */
export async function isMailEnabled(kind: MailKind, serviceId?: string): Promise<boolean> {
  const key = sendKey(kind, serviceId);
  const cfg = await getConfigMany([key]);
  return cfg[key] !== "0";
}

/** État (activé/désactivé) des préférences d'un service (ou global si `serviceId` absent). */
export async function getMailPrefs(serviceId?: string): Promise<Record<MailKind, boolean>> {
  const cfg = await getConfigMany(MAIL_KINDS.map((k) => sendKey(k, serviceId)));
  const out = {} as Record<MailKind, boolean>;
  for (const k of MAIL_KINDS) out[k] = cfg[sendKey(k, serviceId)] !== "0";
  return out;
}

/** Active/désactive l'envoi d'un type d'e-mail (par service si `serviceId`). */
export async function setMailEnabled(
  kind: MailKind,
  enabled: boolean,
  serviceId?: string,
): Promise<void> {
  await setConfig(sendKey(kind, serviceId), enabled ? "1" : "0");
}
