import { wrapEmailHtml } from "@/lib/email-theme";
import { getAppUrl } from "@/server/config";
import { sendMail, sendMailOrQueue } from "@/server/mailer";
import {
  type TemplateKind,
  getMailTemplate,
  htmlToText,
  renderHtmlTemplate,
  renderSubjectTemplate,
} from "@/server/services/mail-templates";

// Pipeline d'envoi d'e-mail TEMPLATÉ, mutualisé (audit duplication « pipeline ×8 ») :
//   getMailTemplate → renderHtmlTemplate → renderSubjectTemplate → wrapEmailHtml
//   (+ appUrl) → htmlToText → send
// était recopié à l'identique sur 6 sites single-shot (auth, suppression de compte,
// agenda, confirmation de résa, RGPD, e-mail de test). NE PAS utiliser dans une
// boucle (booking-reminders/manager-notice chargent le template/appUrl UNE fois hors
// boucle pour éviter un N+1) : ces cas gardent leur pipeline déroulé.
export async function sendTemplatedMail(opts: {
  to: string;
  kind: TemplateKind;
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
  const vars = opts.vars ?? {};
  const inner = renderHtmlTemplate(tpl.html, vars, opts.rawVars);
  const subject = renderSubjectTemplate(tpl.subject, vars);
  const payload = {
    to: opts.to,
    subject,
    html: wrapEmailHtml(inner, { preheader: subject, appUrl: await getAppUrl() }),
    text: htmlToText(inner),
  };
  if (opts.mode === "direct") await sendMail(payload);
  else await sendMailOrQueue(payload);
}
