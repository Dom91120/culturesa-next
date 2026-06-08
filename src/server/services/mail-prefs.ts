import { getConfigMany, setConfig } from "@/server/config";

// Préférences d'envoi des e-mails « Échanges » : pour chaque type d'e-mail lié aux
// réservations, l'application envoie (ou non) selon une clé app_config. Activé par
// défaut (comportement historique) ; désactivé uniquement si la valeur stockée = "0".

export const MAIL_KINDS = [
  "booking_confirmed",
  "booking_pending",
  "booking_cancelled",
  "booking_refused",
] as const;

export type MailKind = (typeof MAIL_KINDS)[number];

const KEY_BY_KIND: Record<MailKind, string> = {
  booking_confirmed: "mail.send.booking_confirmed",
  booking_pending: "mail.send.booking_pending",
  booking_cancelled: "mail.send.booking_cancelled",
  booking_refused: "mail.send.booking_refused",
};

/** Un type d'e-mail est activé par défaut ; désactivé seulement si la valeur = "0". */
export async function isMailEnabled(kind: MailKind): Promise<boolean> {
  const key = KEY_BY_KIND[kind];
  const cfg = await getConfigMany([key]);
  return cfg[key] !== "0";
}

/** État (activé/désactivé) des préférences, pour l'écran « Échanges ». */
export async function getMailPrefs(): Promise<Record<MailKind, boolean>> {
  const cfg = await getConfigMany(MAIL_KINDS.map((k) => KEY_BY_KIND[k]));
  const out = {} as Record<MailKind, boolean>;
  for (const k of MAIL_KINDS) out[k] = cfg[KEY_BY_KIND[k]] !== "0";
  return out;
}

/** Active/désactive l'envoi d'un type d'e-mail. */
export async function setMailEnabled(kind: MailKind, enabled: boolean): Promise<void> {
  await setConfig(KEY_BY_KIND[kind], enabled ? "1" : "0");
}
