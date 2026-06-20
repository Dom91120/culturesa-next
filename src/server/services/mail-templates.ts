import { deleteConfig, getConfigMany, isConfigValueUsed, setConfigMany } from "@/server/config";

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
  "booking_unvalidated",
  "booking_cancelled",
  "booking_refused",
  "booking_reminder",
  "email_verification",
  "password_reset",
  "account_deletion_request",
  "account_deletion_notice",
  "email_test",
  "manager_digest",
] as const;

export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export type MailTemplate = { subject: string; html: string };

/** Variable disponible dans un gabarit (pour l'aide à la saisie). */
export type MailVar = { name: string; desc: string };

const COMMON_VARS: MailVar[] = [
  { name: "salutation", desc: "« Bonjour Prénom, » (ou « Bonjour, » sans prénom)" },
  { name: "prenom", desc: "Prénom de l'usager" },
  { name: "usager", desc: "Nom complet de l'usager concerné (utile pour gestionnaires/admins)" },
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
  { name: "usager", desc: "Nom complet de l'usager concerné (utile pour gestionnaires/admins)" },
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
  booking_unvalidated: BOOKING_VARS,
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
  manager_digest: [
    { name: "service", desc: "Nom du service / de l'activité" },
    { name: "nombre", desc: "Nombre de réservations auto-validées dans ce récapitulatif" },
    {
      name: "liste",
      desc: "Liste (générée) des réservations auto-validées — à placer où vous voulez",
    },
  ],
};

const DETAILS_CONFIRMATION = `<p><strong>Détail de votre réservation :</strong></p>
<ul>
<li><strong>Créneau :</strong> {{creneau}}</li>
{{#if periode}}<li><strong>Période :</strong> {{periode}}</li>{{/if}}
{{#if participants}}<li><strong>Participants :</strong> {{participants}}</li>{{/if}}
{{#if theme}}<li><strong>Thème :</strong> {{theme}}</li>{{/if}}
</ul>
<br>`;

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
  booking_unvalidated: {
    subject: "Réservation remise en attente — {{service}}",
    html: `<p>{{salutation}}</p>
<p>Votre réservation pour « {{service}} » a été <strong>remise en attente de validation</strong> par un gestionnaire.</p>
${DETAILS_CONFIRMATION}
<p>Un gestionnaire va la réexaminer : vous recevrez un e-mail dès qu'elle aura été validée ou refusée. Vous pouvez suivre son état depuis votre espace CultuRésa.</p>
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
    subject: "Demande de réservation refusée — {{service}}",
    html: `<p>{{salutation}}</p>
<p>Nous vous informons que votre demande de réservation <strong>n'a pas été validée</strong>{{#if service}} pour « {{service}} »{{/if}}.</p>
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
<p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.<br>Adresse de secours : {{url}}</p>`,
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
  manager_digest: {
    subject: "Auto-validations — {{service}}",
    html: `<p>Bonjour,</p>
<p>{{nombre}} réservation(s) ont été <strong>validées automatiquement</strong> pour « {{service}} » depuis la dernière notification :</p>
{{liste}}
<p>Vous pouvez les consulter dans l'agenda du service sur CultuRésa.</p>`,
  },
};

// Clés app_config. Avec `serviceId` → surcharge PAR SERVICE ; sans → couche GLOBALE.
// `kind` est un TemplateKind intégré OU une clé de type personnalisé (« custom_… »).
function subjectKey(kind: string, serviceId?: string) {
  return serviceId ? `mail.tpl.${serviceId}.${kind}.subject` : `mail.tpl.${kind}.subject`;
}
function htmlKey(kind: string, serviceId?: string) {
  return serviceId ? `mail.tpl.${serviceId}.${kind}.html` : `mail.tpl.${kind}.html`;
}

const builtinDefault = (kind: string): MailTemplate | undefined =>
  (DEFAULT_TEMPLATES as Record<string, MailTemplate>)[kind];

/**
 * Gabarit effectif d'un type d'e-mail. Repli en cascade :
 *   surcharge service → couche globale → défaut intégré (s'il existe).
 * Les types INTÉGRÉS de réservation n'ont pas de couche globale (jamais écrite) → ils
 * retombent sur le défaut. Les types PERSONNALISÉS (« custom_… ») n'ont pas de défaut
 * intégré → leur contenu « par défaut » est leur couche globale (créée à l'ajout).
 */
export async function getMailTemplate(kind: string, serviceId?: string): Promise<MailTemplate> {
  const keys = [subjectKey(kind), htmlKey(kind)];
  if (serviceId) keys.push(subjectKey(kind, serviceId), htmlKey(kind, serviceId));
  const cfg = await getConfigMany(keys);
  const svcSub = serviceId ? cfg[subjectKey(kind, serviceId)].trim() : "";
  const svcHtml = serviceId ? cfg[htmlKey(kind, serviceId)].trim() : "";
  const def = builtinDefault(kind);
  const subject = svcSub || cfg[subjectKey(kind)].trim() || def?.subject || "";
  const html = svcHtml || cfg[htmlKey(kind)].trim() || def?.html || "";
  return { subject, html };
}

/**
 * Enregistre la surcharge d'un gabarit (par service si `serviceId`, sinon couche globale).
 * Pour un type INTÉGRÉ, si le contenu == défaut (ou vide) la surcharge est EFFACÉE (la clé
 * `app_config` est supprimée, pas laissée vide) → retour au défaut, sans ligne résiduelle.
 * Pour un type PERSONNALISÉ (sans défaut intégré), vide ⇒ efface aussi.
 */
export async function setMailTemplate(
  kind: string,
  subject: string,
  html: string,
  serviceId?: string,
): Promise<void> {
  const def = builtinDefault(kind);
  const s = subject.trim();
  const h = html.trim();
  const subjVal = s && (!def || s !== def.subject.trim()) ? subject : "";
  const htmlVal = h && (!def || h !== def.html.trim()) ? html : "";

  const toSet: Record<string, string> = {};
  const toDel: string[] = [];
  if (subjVal) toSet[subjectKey(kind, serviceId)] = subjVal;
  else toDel.push(subjectKey(kind, serviceId));
  if (htmlVal) toSet[htmlKey(kind, serviceId)] = htmlVal;
  else toDel.push(htmlKey(kind, serviceId));

  if (Object.keys(toSet).length > 0) await setConfigMany(toSet);
  if (toDel.length > 0) await deleteConfig(toDel);
}

// ── Types d'e-mails PERSONNALISÉS ───────────────────────────────────────────────────
//  Deux portées, même mécanique (serviceId optionnel) :
//   - PAR SERVICE  : registre `mail.custom.types.<serviceId>`, contenu `mail.tpl.<serviceId>.<key>.*`
//                    (créés par le gestionnaire dans « Modèles d'e-mails » du service) ;
//   - GLOBAL (admin): registre `mail.custom.types`, contenu `mail.tpl.<key>.*` (couche globale)
//                    (créés dans Messagerie « Modèles d'e-mails (tous services) »), routables partout.
//  serviceId omis ⇒ portée GLOBALE.
export type CustomMailType = { key: string; label: string; description: string; recipient: string };
const customTypesKey = (serviceId?: string) =>
  serviceId ? `mail.custom.types.${serviceId}` : "mail.custom.types";
const DEFAULT_CUSTOM_RECIPIENT = "L'usager concerné";

/** Gabarit de départ d'un type personnalisé (sert aussi de cible au bouton « Réinitialiser »). */
export function customStarterTemplate(label: string): MailTemplate {
  return {
    subject: `${label} — {{service}}`,
    html: `<p>{{salutation}}</p>\n<p>Votre message pour « {{service}} ».</p>\n<p>Cordialement,<br>L'équipe CultuRésa</p>`,
  };
}

/** Variables disponibles pour un type personnalisé (union des variables de réservation). */
export const CUSTOM_MAIL_VARS: MailVar[] = [
  { name: "salutation", desc: "« Bonjour Prénom, » (ou « Bonjour, »)" },
  { name: "prenom", desc: "Prénom de l'usager" },
  { name: "usager", desc: "Nom complet de l'usager concerné (utile pour gestionnaires/admins)" },
  { name: "service", desc: "Nom du service / de l'activité" },
  { name: "creneau", desc: "Créneau concerné (selon l'action)" },
  { name: "periode", desc: "Libellé de la période (peut être vide)" },
  { name: "participants", desc: "Ex. « 2 enfants, 1 accompagnant » (si disponible)" },
  { name: "theme", desc: "Thème (si disponible)" },
  { name: "motif", desc: "Motif (si l'action en fournit un)" },
  { name: "echeance", desc: "Échéance (rappels uniquement)" },
];

export async function listCustomMailTypes(serviceId?: string): Promise<CustomMailType[]> {
  const key = customTypesKey(serviceId);
  const cfg = await getConfigMany([key]);
  try {
    const arr = JSON.parse(cfg[key] || "[]");
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((t) => !!t?.key && typeof t.label === "string")
      .map((t) => ({
        key: t.key as string,
        label: t.label as string,
        description: typeof t.description === "string" ? t.description : "",
        recipient: typeof t.recipient === "string" ? t.recipient : DEFAULT_CUSTOM_RECIPIENT,
      }));
  } catch {
    return [];
  }
}

export async function isCustomMailType(key: string, serviceId?: string): Promise<boolean> {
  return (await listCustomMailTypes(serviceId)).some((t) => t.key === key);
}

/**
 * Ce type personnalisé est-il routé par un service (clés `mail.route.*`) ?
 * Portée service → routes de CE service ; portée globale → routes de N'IMPORTE quel service.
 */
export async function isCustomMailTypeUsed(key: string, serviceId?: string): Promise<boolean> {
  return isConfigValueUsed(serviceId ? `mail.route.${serviceId}.` : "mail.route.", key);
}

/** Crée un type personnalisé (clé unique + libellé) avec un gabarit de départ. serviceId omis ⇒ global. */
export async function createCustomMailType(
  serviceId: string | undefined,
  label: string,
  description = "",
  recipient: string = DEFAULT_CUSTOM_RECIPIENT,
): Promise<CustomMailType> {
  const types = await listCustomMailTypes(serviceId);
  const key = `custom_${crypto.randomUUID().slice(0, 8)}`;
  const t: CustomMailType = { key, label, description, recipient };
  await setConfigMany({ [customTypesKey(serviceId)]: JSON.stringify([...types, t]) });
  // Gabarit de départ stocké au niveau du service (modifiable ensuite).
  const starter = customStarterTemplate(label);
  await setMailTemplate(key, starter.subject, starter.html, serviceId);
  return t;
}

/** Met à jour les métadonnées (nom / description / destinataire) d'un type personnalisé. serviceId omis ⇒ global. */
export async function updateCustomMailType(
  serviceId: string | undefined,
  key: string,
  fields: { label: string; description: string; recipient: string },
): Promise<void> {
  const types = await listCustomMailTypes(serviceId);
  await setConfigMany({
    [customTypesKey(serviceId)]: JSON.stringify(
      types.map((t) => (t.key === key ? { ...t, ...fields } : t)),
    ),
  });
}

/**
 * Supprime un type personnalisé du service : retire l'entrée du registre ET efface son
 * contenu de gabarit propre au service (`mail.tpl.<svc>.<key>.subject/html`), pour ne pas
 * laisser de lignes `app_config` orphelines. Les routages le pointant retombent sur le défaut.
 */
export async function deleteCustomMailType(
  serviceId: string | undefined,
  key: string,
): Promise<void> {
  const types = (await listCustomMailTypes(serviceId)).filter((t) => t.key !== key);
  const regKey = customTypesKey(serviceId);
  // Registre : on réécrit s'il reste des types, sinon on supprime la clé (pas de « [] » résiduel).
  if (types.length > 0) await setConfigMany({ [regKey]: JSON.stringify(types) });
  else await deleteConfig([regKey]);
  // Contenu de gabarit propre au service (évite les lignes app_config orphelines).
  await deleteConfig([subjectKey(key, serviceId), htmlKey(key, serviceId)]);
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
