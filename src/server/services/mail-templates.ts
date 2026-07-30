import { isConfigValueUsed } from "@/server/config";
import { prisma } from "@/server/db";
import { sanitizeTemplateHtml } from "@/server/services/mail-html";

// Gabarits (sujet + corps HTML) éditables des e-mails. Stockés dans la table `mail_types`
// (cf. getMailTemplate, cascade service→global) ; à défaut, le gabarit par défaut ci-dessous
// est utilisé. Les valeurs dynamiques sont injectées via des variables `{{nom}}` (échappées),
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
  "password_changed",
  "account_deletion_request",
  "account_deletion_notice",
  "email_test",
  "manager_digest",
  "manager_new_bookings",
] as const;

export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

type MailTemplate = { subject: string; html: string };

/** Variable disponible dans un gabarit (pour l'aide à la saisie). */
type MailVar = { name: string; desc: string };

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
  password_changed: [
    { name: "salutation", desc: "« Bonjour Prénom Nom, »" },
    { name: "prenom", desc: "Prénom de l’usager" },
    { name: "date", desc: "Date et heure du changement, ex. « 30/07/2026 à 18:42 »" },
  ],
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
  manager_new_bookings: [
    { name: "service", desc: "Nom du service / de l'activité" },
    { name: "nombre", desc: "Nombre de nouvelles réservations dans ce récapitulatif" },
    {
      name: "liste",
      desc: "Liste (générée) des nouvelles réservations — à placer où vous voulez",
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
  // Envoyé APRÈS coup, et c'est tout son intérêt (constat A7) : il ne demande rien
  // et ne contient AUCUN lien. Un courriel de sécurité porteur d'un lien apprend à
  // cliquer sur les liens des courriels de sécurité — exactement ce dont vit
  // l'hameçonnage. La consigne renvoie donc l'usager vers le site, par ses propres
  // moyens, et vers un interlocuteur humain.
  password_changed: {
    subject: "Votre mot de passe a été modifié — CultuRésa",
    html: `<p>{{salutation}}</p>
<p>Le mot de passe de votre compte CultuRésa a été modifié le {{date}}.</p>
<p>Vos autres sessions ouvertes ont été fermées : si vous étiez connecté sur un autre appareil, vous devrez vous y reconnecter.</p>
<p><strong>Si vous n'êtes pas à l'origine de ce changement</strong>, votre compte est peut-être compromis. Rendez-vous sur CultuRésa pour réinitialiser votre mot de passe, et signalez-le au service culturel.</p>`,
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
  manager_new_bookings: {
    subject: "Nouvelles réservations — {{service}}",
    // La nature de chaque ligne (« demande de réservation » / « réservation ») est
    // portée par {{liste}}, d'où une phrase d'introduction unique.
    html: `<p>Bonjour,</p>
<p>{{nombre}} nouvelle(s) demande(s) ont été déposées pour « {{service}} » depuis la dernière notification :</p>
{{liste}}
<p>Vous pouvez les consulter dans l'agenda du service sur CultuRésa.</p>`,
  },
};

// ── Stockage UNIFIÉ : table `mail_types` (clé composite (serviceId, key), "" = global) ──
const builtinDefault = (kind: string): MailTemplate | undefined =>
  (DEFAULT_TEMPLATES as Record<string, MailTemplate>)[kind];

const scopeOf = (serviceId?: string): string => serviceId ?? "";
const pick = (...vals: (string | undefined)[]): string =>
  vals.find((v) => v && v.trim() !== "") ?? "";

/**
 * Gabarit effectif d'un type d'e-mail. Cascade : surcharge service → ligne globale →
 * défaut intégré (`DEFAULT_TEMPLATES`, repli de sûreté). Tout est lu dans `mail_types`.
 */
export async function getMailTemplate(kind: string, serviceId?: string): Promise<MailTemplate> {
  const scopes = serviceId ? [serviceId, ""] : [""];
  const rows = await prisma.mailType.findMany({
    where: { key: kind, serviceId: { in: scopes } },
    select: { serviceId: true, subject: true, html: true },
  });
  const svc = serviceId ? rows.find((r) => r.serviceId === serviceId) : undefined;
  const glob = rows.find((r) => r.serviceId === "");
  const def = builtinDefault(kind);
  return {
    subject: pick(svc?.subject, glob?.subject, def?.subject),
    html: pick(svc?.html, glob?.html, def?.html),
  };
}

/**
 * Enregistre le contenu (objet + corps) d'un type d'e-mail dans `mail_types`.
 *  - Surcharge PAR SERVICE d'un type INTÉGRÉ : si == la base (globale/défaut), la ligne de
 *    surcharge est SUPPRIMÉE (retour à la base, sans ligne résiduelle) ; sinon upsert.
 *  - Ligne globale d'un intégré, ou type personnalisé (toute portée) : upsert (la ligne existe).
 */
export async function setMailTemplate(
  kind: string,
  subject: string,
  htmlBrut: string,
  serviceId?: string,
): Promise<void> {
  // Assainissement AU STOCKAGE : la base ne contient que du HTML déjà filtré,
  // quel que soit le chemin d écriture (constats BAC1 et S1).
  const html = sanitizeTemplateHtml(htmlBrut);
  const scope = scopeOf(serviceId);
  const builtin = (TEMPLATE_KINDS as readonly string[]).includes(kind);

  if (scope !== "" && builtin) {
    const base = await getMailTemplate(kind, ""); // base globale (ou défaut code)
    if (subject.trim() === base.subject.trim() && html.trim() === base.html.trim()) {
      await prisma.mailType.deleteMany({ where: { serviceId: scope, key: kind } });
      return;
    }
    await prisma.mailType.upsert({
      where: { serviceId_key: { serviceId: scope, key: kind } },
      update: { subject, html },
      create: { serviceId: scope, key: kind, subject, html, builtin: true },
    });
    return;
  }

  await prisma.mailType.upsert({
    where: { serviceId_key: { serviceId: scope, key: kind } },
    update: { subject, html },
    create: { serviceId: scope, key: kind, subject, html, builtin },
  });
}

// ── Types d'e-mails PERSONNALISÉS (lignes `mail_types` avec builtin = false) ──────────
//  serviceId fourni ⇒ type DU SERVICE (serviceId = "<svc>") ; omis ⇒ type GLOBAL (serviceId = "").
type CustomMailType = { key: string; label: string; description: string; recipient: string };
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
  const rows = await prisma.mailType.findMany({
    where: { serviceId: scopeOf(serviceId), builtin: false },
    orderBy: { createdAt: "asc" },
    select: { key: true, label: true, description: true, recipient: true },
  });
  return rows.map((r) => ({
    key: r.key,
    label: r.label,
    description: r.description,
    recipient: r.recipient || DEFAULT_CUSTOM_RECIPIENT,
  }));
}

export async function isCustomMailType(key: string, serviceId?: string): Promise<boolean> {
  const row = await prisma.mailType.findUnique({
    where: { serviceId_key: { serviceId: scopeOf(serviceId), key } },
    select: { builtin: true },
  });
  return !!row && !row.builtin;
}

/**
 * Ce type personnalisé est-il routé par un service (clés `mail.route.*` d'app_config) ?
 * Portée service → routes de CE service ; portée globale → routes de N'IMPORTE quel service.
 */
export async function isCustomMailTypeUsed(key: string, serviceId?: string): Promise<boolean> {
  return isConfigValueUsed(serviceId ? `mail.route.${serviceId}.` : "mail.route.", key);
}

/** Crée un type personnalisé (clé unique + libellé + contenu de départ). serviceId omis ⇒ global. */
export async function createCustomMailType(
  serviceId: string | undefined,
  label: string,
  description = "",
  recipient: string = DEFAULT_CUSTOM_RECIPIENT,
): Promise<CustomMailType> {
  const key = `custom_${crypto.randomUUID().slice(0, 8)}`;
  const starter = customStarterTemplate(label);
  await prisma.mailType.create({
    data: {
      serviceId: scopeOf(serviceId),
      key,
      label,
      description,
      recipient,
      subject: starter.subject,
      html: starter.html,
      builtin: false,
    },
  });
  return { key, label, description, recipient };
}

/** Met à jour les métadonnées (nom / description / destinataire) d'un type personnalisé. */
export async function updateCustomMailType(
  serviceId: string | undefined,
  key: string,
  fields: { label: string; description: string; recipient: string },
): Promise<void> {
  await prisma.mailType.update({
    where: { serviceId_key: { serviceId: scopeOf(serviceId), key } },
    data: { label: fields.label, description: fields.description, recipient: fields.recipient },
  });
}

/**
 * Supprime un type personnalisé. Global ⇒ supprime la ligne globale ET ses éventuelles
 * surcharges par service (même `key`). Par service ⇒ supprime la seule ligne du service.
 * Les routages le pointant retombent sur le défaut (cf. resolveTriggerKind).
 */
export async function deleteCustomMailType(
  serviceId: string | undefined,
  key: string,
): Promise<void> {
  if (scopeOf(serviceId) === "") await prisma.mailType.deleteMany({ where: { key } });
  else await prisma.mailType.deleteMany({ where: { serviceId, key } });
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
