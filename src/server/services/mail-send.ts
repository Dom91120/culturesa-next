import { wrapEmailHtml } from "@/lib/email-theme";
import { greeting, renderHtmlTemplate, renderSubjectTemplate } from "@/lib/mail-render";
import { getAppUrl } from "@/server/config";
import { prisma } from "@/server/db";
import { sendMail, sendMailOrQueue } from "@/server/mailer";
import { sanitizeTemplateHtml } from "@/server/services/mail-html";
import {
  type BookingTrigger,
  isTriggerEnabled,
  type ResolvedRecipient,
  resolveTriggerKind,
  resolveTriggerRecipients,
} from "@/server/services/mail-prefs";
import { getMailTemplate, htmlToText } from "@/server/services/mail-templates";

/**
 * Cœur de rendu d'un e-mail templaté (SOURCE UNIQUE) : template + variables → sujet +
 * HTML habillé (wrapEmailHtml) + version texte. Ne charge NI template NI appUrl (fournis
 * par l'appelant) → utilisable en BOUCLE batch (template/appUrl chargés une seule fois
 * hors boucle, anti-N+1) comme en single-shot. L'appelant ajoute `to` et choisit l'envoi.
 */
export function buildTemplatedMail(
  tpl: { subject: string; html: string },
  vars: Record<string, string>,
  appUrl: string,
  rawVars?: Record<string, string>,
): { subject: string; html: string; text: string } {
  // Assainissement AVANT rendu : couvre les gabarits enregistres AVANT la mise en
  // place du filtre, et tout contenu qui aurait contourne le chemin de stockage.
  // Avant rendu et non apres, pour que le bouton d action genere par l app
  // ({{bouton}}, injecte en variable brute) ne soit pas soumis au filtre.
  const inner = renderHtmlTemplate(sanitizeTemplateHtml(tpl.html), vars, rawVars);
  const subject = renderSubjectTemplate(tpl.subject, vars);
  return {
    subject,
    html: wrapEmailHtml(inner, { preheader: subject, appUrl }),
    text: htmlToText(inner),
  };
}

// Pipeline d'envoi d'e-mail TEMPLATÉ single-shot, mutualisé : charge template + appUrl,
// délègue le rendu à buildTemplatedMail, puis envoie (direct ou file). Recopié à
// l'identique sur 6 sites (auth, suppression de compte, agenda, confirmation de résa,
// RGPD, e-mail de test).
export async function sendTemplatedMail(opts: {
  to: string;
  // TemplateKind intégré OU clé de type personnalisé (« custom_… »).
  kind: string;
  /** Variables échappées (texte). */
  vars?: Record<string, string>;
  /** Variables HTML de confiance (boutons…), injectées sans échappement. */
  rawVars?: Record<string, string>;
  /**
   * "queue" (défaut) = best-effort, les échecs SMTP partent en file (transactionnel).
   * "direct" = lève en cas d'échec (e-mail de test admin, ou flux qui veut le savoir).
   */
  mode?: "queue" | "direct";
  /** Gabarit propre à ce service (e-mails de réservation) ; absent → gabarit global. */
  serviceId?: string;
}): Promise<void> {
  const tpl = await getMailTemplate(opts.kind, opts.serviceId);
  const built = buildTemplatedMail(tpl, opts.vars ?? {}, await getAppUrl(), opts.rawVars);
  const payload = { to: opts.to, ...built };
  if (opts.mode === "direct") await sendMail(payload);
  else await sendMailOrQueue(payload);
}

// ─── E-mails DÉCLENCHÉS par une action métier (réservation, liste d'attente) ──────────

/**
 * Envoie un e-mail templaté à chaque destinataire résolu, avec la salutation
 * personnalisée pour l'usager concerné (`personal`) et neutre pour les autres
 * (gestionnaires, administrateurs, adresse fixe). Template et appUrl fournis par
 * l'appelant → utilisable en boucle batch (chargés une fois) comme en single-shot.
 * Best-effort : chaque échec SMTP part en file (sendMailOrQueue).
 */
export async function sendToRecipients(opts: {
  recipients: ReadonlyArray<ResolvedRecipient>;
  tpl: { subject: string; html: string };
  vars: Record<string, string>;
  rawVars?: Record<string, string>;
  appUrl: string;
}): Promise<void> {
  for (const r of opts.recipients) {
    const prenom = r.personal ? r.prenom : "";
    const vars = { ...opts.vars, salutation: greeting(prenom), prenom };
    await sendMailOrQueue({
      to: r.email,
      ...buildTemplatedMail(opts.tpl, vars, opts.appUrl, opts.rawVars),
    });
  }
}

/** Contexte résolu passé au constructeur de variables d'un e-mail déclenché. */
export type TriggeredMailContext = {
  /** « Prénom Nom » de l'usager concerné ("" sans usager). */
  usager: string;
  /** URL publique de l'app, SANS slash final (getAppUrl). */
  appUrl: string;
  recipients: ReadonlyArray<ResolvedRecipient>;
};

/**
 * Squelette COMMUN des e-mails déclenchés par une action (source unique — recopié dans
 * booking-mail.ts et waiting-list.ts avant l'audit 2026-09-17, D5) :
 *   1. déclencheur activé ? (réglage global « Envoyer ») — sinon rien ;
 *   2. destinataires du réglage global « Destinataire » (usager concerné, gestionnaires
 *      du service, administrateurs, adresse fixe) — aucun → rien ;
 *   3. usager concerné (prénom/nom) + URL de l'app → `build` construit les variables
 *      texte (et les variables HTML brutes : boutons, listes) propres à l'action ;
 *      `null` → rien à envoyer ;
 *   4. type d'e-mail EFFECTIF du déclencheur (re-routage global) → gabarit du service
 *      (cascade service → global → défaut), un envoi par destinataire avec salutation.
 * Totalement best-effort : toute erreur est journalisée sous `logTag`, jamais levée.
 */
export async function sendTriggeredMail(opts: {
  trigger: BookingTrigger;
  serviceId: string;
  /** Usager concerné (destinataire « usager » + variable {{usager}}) ; absent = aucun. */
  userId?: string | null;
  build: (
    ctx: TriggeredMailContext,
  ) =>
    | Promise<{ vars: Record<string, string>; rawVars?: Record<string, string> } | null>
    | { vars: Record<string, string>; rawVars?: Record<string, string> }
    | null;
  /** Étiquette du journal d'erreur (nom de la fonction appelante). */
  logTag: string;
}): Promise<void> {
  try {
    if (!(await isTriggerEnabled(opts.trigger))) return;
    const [recipients, concerned, appUrl] = await Promise.all([
      resolveTriggerRecipients(opts.trigger, opts.serviceId, { userId: opts.userId }),
      opts.userId
        ? prisma.user.findUnique({
            where: { id: opts.userId },
            select: { prenom: true, nom: true },
          })
        : null,
      getAppUrl(),
    ]);
    if (recipients.length === 0) return;
    const usager = `${concerned?.prenom ?? ""} ${concerned?.nom ?? ""}`.trim();
    const built = await opts.build({ usager, appUrl, recipients });
    if (!built) return;
    const kind = await resolveTriggerKind(opts.trigger);
    const tpl = await getMailTemplate(kind, opts.serviceId);
    await sendToRecipients({ recipients, tpl, vars: built.vars, rawVars: built.rawVars, appUrl });
  } catch (e) {
    console.error(`[${opts.logTag}] erreur:`, e);
  }
}
