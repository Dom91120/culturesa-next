import { getConfigMany, setConfigMany } from "@/server/config";

// Gabarits (sujet + corps HTML) éditables des e-mails. Stockés dans app_config (clés
// `mail.tpl.<kind>.subject` / `.html`) ; à défaut, le gabarit par défaut ci-dessous est
// utilisé. Les valeurs dynamiques sont injectées via des variables `{{nom}}` (échappées),
// la variable BRUTE `{{bouton}}` (lien d'action), et des blocs conditionnels
// `{{#if nom}}…{{/if}}` (n'affiche le bloc que si la variable est renseignée).

// Types d'e-mails disposant d'un gabarit. Les 5 premiers (réservations) sont
// désactivables ; les suivants (compte/sécurité) sont toujours envoyés.
export const TEMPLATE_KINDS = [
  "booking_confirmed",
  "booking_pending",
  "booking_cancelled",
  "booking_refused",
  "booking_reminder",
  "email_verification",
  "password_reset",
  "account_deletion_request",
  "account_deletion_notice",
  "email_test",
] as const;

export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export type MailTemplate = { subject: string; html: string };

/** Variable disponible dans un gabarit (pour l'aide à la saisie). */
export type MailVar = { name: string; desc: string };

const COMMON_VARS: MailVar[] = [
  { name: "salutation", desc: "« Bonjour Prénom, » (ou « Bonjour, » sans prénom)" },
  { name: "prenom", desc: "Prénom de l'usager" },
  { name: "service", desc: "Nom du service / de l'activité" },
  { name: "creneau", desc: "Créneau : date+heure (ponctuel) ou jour+heure (récurrent)" },
  { name: "periode", desc: "Libellé de la période (peut être vide)" },
];

const BOOKING_VARS: MailVar[] = [
  ...COMMON_VARS,
  { name: "participants", desc: "Ex. « 2 enfants, 1 accompagnant »" },
  { name: "theme", desc: "Thème de la réservation (peut être vide)" },
];
const DELETE_VARS: MailVar[] = [
  ...COMMON_VARS,
  { name: "motif", desc: "Motif saisi par le gestionnaire (peut être vide)" },
];
const REMINDER_VARS: MailVar[] = [
  { name: "salutation", desc: "« Bonjour Prénom, » (ou « Bonjour, »)" },
  { name: "prenom", desc: "Prénom de l'usager" },
  { name: "service", desc: "Nom du service / de l'activité" },
  {
    name: "creneau",
    desc: "Date + heure de la séance à venir, ex. « lundi 15 juin 2026 · 10:00 – 12:00 »",
  },
  { name: "periode", desc: "Libellé de la période (peut être vide)" },
  { name: "echeance", desc: "« dans une semaine » (J-7) ou « demain » (J-1)" },
];
const LINK_VARS: MailVar[] = [
  { name: "salutation", desc: "« Bonjour Prénom, » (ou « Bonjour, »)" },
  { name: "prenom", desc: "Prénom de l'usager" },
  { name: "bouton", desc: "Bouton d'action (lien) — à placer où vous voulez le bouton" },
  { name: "url", desc: "Adresse du lien (à afficher en secours, en texte)" },
];

export const MAIL_VARS: Record<TemplateKind, MailVar[]> = {
  booking_confirmed: BOOKING_VARS,
  booking_pending: BOOKING_VARS,
  booking_cancelled: DELETE_VARS,
  booking_refused: DELETE_VARS,
  booking_reminder: REMINDER_VARS,
  email_verification: LINK_VARS,
  password_reset: LINK_VARS,
  account_deletion_request: LINK_VARS,
  account_deletion_notice: [
    { name: "salutation", desc: "« Bonjour Prénom Nom, »" },
    { name: "prenom", desc: "Prénom de l'usager" },
    { name: "annees", desc: "Durée d'inactivité, ex. « 2 an(s) »" },
    { name: "delai", desc: "Délai avant suppression, ex. « 30 jours »" },
  ],
  email_test: [],
};

const DETAILS_CONFIRMATION = `<p><strong>Détail de votre réservation :</strong></p>
<ul>
<li><strong>Créneau :</strong> {{creneau}}</li>
{{#if periode}}<li><strong>Période :</strong> {{periode}}</li>{{/if}}
{{#if participants}}<li><strong>Participants :</strong> {{participants}}</li>{{/if}}
{{#if theme}}<li><strong>Thème :</strong> {{theme}}</li>{{/if}}
</ul>`;

export const DEFAULT_TEMPLATES: Record<TemplateKind, MailTemplate> = {
  booking_confirmed: {
    subject: "Réservation confirmée — {{service}}",
    html: `<p>{{salutation}}</p>
<p>Nous vous confirmons que votre réservation pour « {{service}} » a bien été enregistrée et confirmée.</p>
${DETAILS_CONFIRMATION}
<p>Aucune démarche supplémentaire n'est nécessaire. Vous pouvez consulter ou annuler votre réservation depuis votre espace CultuRésa.</p>
<p>Cordialement,<br>L'équipe CultuRésa</p>`,
  },
  booking_pending: {
    subject: "Demande de réservation enregistrée — {{service}}",
    html: `<p>{{salutation}}</p>
<p>Nous vous confirmons que votre demande de réservation pour « {{service}} » a bien été enregistrée et est <strong>en attente de validation</strong>.</p>
${DETAILS_CONFIRMATION}
<p>Un gestionnaire va examiner votre demande : vous recevrez un e-mail dès qu'elle aura été validée ou refusée. Vous pouvez suivre son état depuis votre espace CultuRésa.</p>
<p>Cordialement,<br>L'équipe CultuRésa</p>`,
  },
  booking_cancelled: {
    subject: "Réservation annulée — {{service}}",
    html: `<p>{{salutation}}</p>
<p>Nous vous informons que votre réservation a été <strong>supprimée</strong>{{#if service}} pour « {{service}} »{{/if}}.</p>
{{#if creneau}}<p><strong>Créneau concerné :</strong> {{creneau}}</p>{{/if}}
{{#if periode}}<p><strong>Période :</strong> {{periode}}</p>{{/if}}
{{#if motif}}<p><strong>Motif :</strong><br>{{motif}}</p>{{/if}}
<p>Cordialement,<br>L'équipe CultuRésa</p>`,
  },
  booking_refused: {
    subject: "Réservation non validée — {{service}}",
    html: `<p>{{salutation}}</p>
<p>Nous vous informons que votre réservation <strong>n'a pas été validée</strong>{{#if service}} pour « {{service}} »{{/if}}.</p>
{{#if creneau}}<p><strong>Créneau concerné :</strong> {{creneau}}</p>{{/if}}
{{#if periode}}<p><strong>Période :</strong> {{periode}}</p>{{/if}}
{{#if motif}}<p><strong>Motif :</strong><br>{{motif}}</p>{{/if}}
<p>Cordialement,<br>L'équipe CultuRésa</p>`,
  },
  booking_reminder: {
    subject: "Rappel — {{service}} {{echeance}}",
    html: `<p>{{salutation}}</p>
<p>Petit rappel : vous avez une réservation pour « {{service}} » <strong>{{echeance}}</strong>.</p>
<p><strong>Créneau :</strong> {{creneau}}</p>
{{#if periode}}<p><strong>Période :</strong> {{periode}}</p>{{/if}}
<p>Si vous ne pouvez plus vous y rendre, pensez à annuler votre réservation depuis votre espace CultuRésa afin de libérer la place.</p>
<p>À bientôt,<br>L'équipe CultuRésa</p>`,
  },
  email_verification: {
    subject: "Confirmez votre adresse e-mail — CultuRésa",
    html: `<p>{{salutation}}</p>
<p>Bienvenue sur CultuRésa ! Pour activer votre compte, confirmez votre adresse e-mail :</p>
<p>{{bouton}}</p>
<p>Si le bouton ne fonctionne pas, copiez cette adresse dans votre navigateur :<br>{{url}}</p>`,
  },
  password_reset: {
    subject: "Réinitialisation de votre mot de passe — CultuRésa",
    html: `<p>{{salutation}}</p>
<p>Vous avez demandé à réinitialiser votre mot de passe. Cliquez sur le bouton ci-dessous (lien valable 1&nbsp;h) :</p>
<p>{{bouton}}</p>
<p style="font-size:13px;color:#5a7a4f;">Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.<br>Adresse de secours : {{url}}</p>`,
  },
  account_deletion_request: {
    subject: "Confirmez la suppression de votre compte — CultuRésa",
    html: `<p>{{salutation}}</p>
<p>Vous avez demandé la <strong>suppression de votre compte</strong> CultuRésa. Pour confirmer, cliquez sur le bouton ci-dessous (lien valable 24&nbsp;h) :</p>
<p>{{bouton}}</p>
<p>Cette action est <strong>irréversible</strong> : vos données personnelles seront anonymisées. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail — votre compte restera inchangé.</p>
<p>Si le bouton ne fonctionne pas, copiez cette adresse dans votre navigateur :<br>{{url}}</p>`,
  },
  account_deletion_notice: {
    subject: "Préavis de suppression de votre compte — CultuRésa",
    html: `<p>{{salutation}}</p>
<p>Votre compte CultuRésa est inactif depuis plus de {{annees}}. Conformément à notre politique de conservation des données (RGPD), il sera anonymisé de façon irréversible si vous ne vous reconnectez pas sous {{delai}}.</p>
<p>Pour conserver votre compte, il vous suffit de vous reconnecter avant l'échéance.</p>
<p>Cordialement,<br>L'équipe CultuRésa</p>`,
  },
  email_test: {
    subject: "Test — CultuRésa",
    html: `<p>Bonjour,</p>
<p>Ceci est un e-mail de test envoyé depuis l'administration de CultuRésa.</p>
<p>Si vous voyez cet habillage (logo, couleurs, mise en page), la configuration e-mail fonctionne correctement.</p>
<p>Cordialement,<br>L'équipe CultuRésa</p>`,
  },
};

function subjectKey(kind: TemplateKind) {
  return `mail.tpl.${kind}.subject`;
}
function htmlKey(kind: TemplateKind) {
  return `mail.tpl.${kind}.html`;
}

/** Gabarit effectif d'un type d'e-mail : surcharge enregistrée, sinon défaut. */
export async function getMailTemplate(kind: TemplateKind): Promise<MailTemplate> {
  const cfg = await getConfigMany([subjectKey(kind), htmlKey(kind)]);
  const subject = cfg[subjectKey(kind)].trim() || DEFAULT_TEMPLATES[kind].subject;
  const html = cfg[htmlKey(kind)].trim() || DEFAULT_TEMPLATES[kind].html;
  return { subject, html };
}

/**
 * Enregistre la surcharge d'un gabarit. Si le contenu est identique au défaut (ou
 * vide), on efface la surcharge (retour au défaut, propagation des évolutions).
 */
export async function setMailTemplate(
  kind: TemplateKind,
  subject: string,
  html: string,
): Promise<void> {
  const def = DEFAULT_TEMPLATES[kind];
  const s = subject.trim();
  const h = html.trim();
  await setConfigMany({
    [subjectKey(kind)]: s && s !== def.subject.trim() ? subject : "",
    [htmlKey(kind)]: h && h !== def.html.trim() ? html : "",
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Résout les blocs conditionnels {{#if nom}}…{{/if}} (gardés si la variable est non vide). */
function applyConditionals(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_m, key, inner) =>
    (vars[key] ?? "").trim() ? inner : "",
  );
}

/**
 * Rend le corps HTML : conditionnels puis variables. Les `vars` sont échappées
 * (valeurs de confiance limitée), les `rawVars` sont injectées telles quelles
 * (HTML de confiance généré par l'app, ex. le bouton d'action `{{bouton}}`).
 */
export function renderHtmlTemplate(
  tpl: string,
  vars: Record<string, string>,
  rawVars: Record<string, string> = {},
): string {
  return applyConditionals(tpl, { ...vars, ...rawVars }).replace(/\{\{(\w+)\}\}/g, (_m, key) =>
    key in rawVars ? rawVars[key] : escapeHtml(vars[key] ?? "").replace(/\n/g, "<br>"),
  );
}

/** Rend le sujet : conditionnels puis variables brutes, sur une seule ligne. */
export function renderSubjectTemplate(tpl: string, vars: Record<string, string>): string {
  return applyConditionals(tpl, vars)
    .replace(/\{\{(\w+)\}\}/g, (_m, key) => vars[key] ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Version texte brut dérivée du HTML rendu (deliverabilité + clients sans HTML). */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li>/gi, "- ")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
