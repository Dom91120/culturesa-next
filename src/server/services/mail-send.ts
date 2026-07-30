import { wrapEmailHtml } from "@/lib/email-theme";
import { renderHtmlTemplate, renderSubjectTemplate } from "@/lib/mail-render";
import { getAppUrl } from "@/server/config";
import { sendMail, sendMailOrQueue } from "@/server/mailer";
import { sanitizeTemplateHtml } from "@/server/services/mail-html";
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
