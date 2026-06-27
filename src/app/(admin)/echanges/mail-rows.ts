import { prisma } from "@/server/db";
import {
  type BookingTrigger,
  getTriggerKinds,
  getTriggerPrefs,
  getTriggerRecipients,
  listMailTriggers,
  MAIL_KINDS,
  type MailRecipientKind,
} from "@/server/services/mail-prefs";
import {
  CUSTOM_MAIL_VARS,
  customStarterTemplate,
  DEFAULT_TEMPLATES,
  getMailTemplate,
  isCustomMailTypeUsed,
  listCustomMailTypes,
  MAIL_VARS,
  TEMPLATE_KINDS,
  type TemplateKind,
} from "@/server/services/mail-templates";
import type { KindData } from "./echanges-config";

// E-mails « système » (compte / sécurité + test) + digest, contenu modifiable. Cet ordre
// détermine l'affichage dans Administration › Échanges. « E-mail de test » est placé après
// le préavis RGPD ; « Auto-validations » (digest, réglé par service) figure en dernier.
export const SYSTEM_MAIL_KINDS = [
  "email_verification",
  "password_reset",
  "account_deletion_request",
  "account_deletion_notice",
  "email_test",
  "manager_digest",
] as const satisfies readonly TemplateKind[];

// Libellés / descriptions / destinataire PAR DÉFAUT des types d'e-mail intégrés (repli code).
// La source de vérité au runtime est la table `mail_types` (cf. getMailTypeMeta) ; cette
// constante sert au seed et de repli si la table est vide/absente. Les CLÉS restent en code.
const META: Record<TemplateKind, { label: string; description: string; recipient: string }> = {
  booking_confirmed: {
    label: "Réservation confirmée",
    description: "Envoyé à l'usager lorsque sa réservation est validée d'emblée (confirmée).",
    recipient: "L'usager concerné",
  },
  booking_pending: {
    label: "Demande de réservation enregistrée",
    description: "Envoyé lorsque la réservation est enregistrée et en attente de validation.",
    recipient: "L'usager concerné",
  },
  booking_unvalidated: {
    label: "Réservation remise en attente",
    description:
      "Envoyé à l'usager lorsqu'un gestionnaire dévalide (remet en attente de validation) une réservation déjà validée.",
    recipient: "L'usager concerné",
  },
  booking_cancelled: {
    label: "Réservation annulée",
    description: "Envoyé lorsqu'un gestionnaire supprime une réservation déjà validée.",
    recipient: "L'usager concerné",
  },
  booking_refused: {
    label: "Demande de réservation refusée",
    description: "Envoyé lorsqu'un gestionnaire supprime/refuse une demande de réservation.",
    recipient: "L'usager concerné",
  },
  booking_reminder: {
    label: "Rappel de réservation",
    description:
      "Envoyé automatiquement une semaine avant, puis la veille de chaque séance réservée (réservations confirmées).",
    recipient: "L'usager concerné",
  },
  email_verification: {
    label: "Confirmation d'adresse e-mail",
    description: "Envoyé à l'inscription pour activer le compte (toujours envoyé).",
    recipient: "L'utilisateur (adresse à confirmer)",
  },
  password_reset: {
    label: "Réinitialisation du mot de passe",
    description: "Envoyé lors d'une demande de réinitialisation (toujours envoyé).",
    recipient: "L'utilisateur",
  },
  account_deletion_request: {
    label: "Demande de suppression de compte",
    description:
      "Envoyé à l'usager qui demande la suppression de son compte (lien de confirmation 24 h, toujours envoyé).",
    recipient: "L'utilisateur",
  },
  account_deletion_notice: {
    label: "Préavis de suppression de compte (RGPD)",
    description: "Envoyé à un compte inactif avant anonymisation (toujours envoyé).",
    recipient: "L'utilisateur (compte inactif)",
  },
  email_test: {
    label: "E-mail de test",
    description: "Envoyé manuellement depuis Messagerie pour vérifier la configuration.",
    recipient: "L'adresse saisie",
  },
  manager_digest: {
    label: "Auto-validations",
    description:
      "Récapitulatif des réservations validées automatiquement, envoyé aux gestionnaires du service (rôle gestionnaire, via leur rattachement). Fréquence réglée par service (Paramètres > Réservations).",
    recipient: "Les gestionnaires du service",
  },
};

export type MailTypeMeta = { label: string; description: string; recipient: string };

/** Référentiel de repli des métadonnées des types intégrés (sert au seed et si table vide). */
export function defaultMailTypes(): { key: TemplateKind; meta: MailTypeMeta }[] {
  return TEMPLATE_KINDS.map((k) => ({ key: k, meta: META[k] }));
}

/**
 * Métadonnées (libellé / description / destinataire) des types intégrés, depuis la table
 * `mail_types` (référentiel persisté), avec repli sur le code (`META`) si absente/vide.
 */
export async function getMailTypeMeta(): Promise<Record<string, MailTypeMeta>> {
  const map: Record<string, MailTypeMeta> = { ...META };
  try {
    // Métadonnées = lignes GLOBALES (serviceId ""); les lignes par service ne portent
    // que du contenu (surcharges), pas de métadonnées.
    const rows = await prisma.mailType.findMany({ where: { serviceId: "" } });
    for (const r of rows) {
      map[r.key] = { label: r.label, description: r.description, recipient: r.recipient };
    }
  } catch {
    // Table absente (avant migration) → repli code.
  }
  return map;
}

/**
 * Construit les `KindData` (préférence + modèle) pour les types d'e-mail demandés.
 * `serviceId` → gabarits/préférences PAR SERVICE (e-mails de réservation) ; absent →
 * portée globale (e-mails système).
 */
export async function getMailRows(
  kinds: readonly TemplateKind[],
  serviceId?: string,
): Promise<KindData[]> {
  const [templates, meta] = await Promise.all([
    Promise.all(kinds.map((k) => getMailTemplate(k, serviceId))),
    getMailTypeMeta(),
  ]);
  // « Verrouillé » = e-mail système (toujours envoyé). Les types de réservation ne le sont
  // pas (leur envoi est piloté par action, cf. « Échanges par mail »).
  const toggleable = new Set<string>(MAIL_KINDS);
  const systemSet = new Set<string>(SYSTEM_MAIL_KINDS);

  return kinds.map((kind, i) => {
    const m = meta[kind] ?? META[kind];
    return {
      kind,
      label: m.label,
      description: m.description,
      recipient: m.recipient,
      locked: !toggleable.has(kind),
      // « Système » = e-mail compte/sécurité TOUJOURS envoyé. `manager_digest`
      // (Auto-validations) est listé ici mais son envoi est réglé PAR SERVICE
      // (Paramètres › Réservations) → pas « système ».
      system: systemSet.has(kind) && kind !== "manager_digest",
      subject: templates[i].subject,
      html: templates[i].html,
      defaultSubject: DEFAULT_TEMPLATES[kind].subject,
      defaultHtml: DEFAULT_TEMPLATES[kind].html,
      variables: MAIL_VARS[kind],
    };
  });
}

export type RoutingRow = {
  triggerKey: BookingTrigger;
  action: string;
  // Type d'e-mail effectif : type intégré OU clé de type personnalisé.
  kind: string;
  enabled: boolean;
  // Destinataire de l'action (défaut « usager ») + adresse(s) si « fixe ».
  recipientKind: MailRecipientKind;
  recipientAddr: string;
};

/**
 * Lignes de « Échanges par mail » (GLOBAL, administrateur) : une par ACTION (déclencheur),
 * avec le type d'e-mail EFFECTIF (re-routable), la préférence d'envoi et le destinataire.
 */
export async function getRoutingRows(): Promise<RoutingRow[]> {
  const [prefs, kinds, recipients, triggers] = await Promise.all([
    getTriggerPrefs(),
    getTriggerKinds(),
    getTriggerRecipients(),
    listMailTriggers(), // référentiel persisté (libellé + ordre)
  ]);
  return triggers.map((t) => ({
    triggerKey: t.key,
    action: t.label,
    kind: kinds[t.key],
    enabled: prefs[t.key],
    recipientKind: recipients[t.key].kind,
    recipientAddr: recipients[t.key].addr,
  }));
}

/** Lignes « Modèles » des types PERSONNALISÉS d'une portée (service ou, si omis, globale). */
async function customRows(serviceId?: string): Promise<KindData[]> {
  const customTypes = await listCustomMailTypes(serviceId);
  return Promise.all(
    customTypes.map(async (t): Promise<KindData> => {
      const [content, used] = await Promise.all([
        getMailTemplate(t.key, serviceId), // contenu propre à la portée
        isCustomMailTypeUsed(t.key, serviceId), // routé ? (suppression interdite)
      ]);
      // Pas de défaut intégré → la cible « Réinitialiser » est le gabarit de départ générique.
      const starter = customStarterTemplate(t.label);
      return {
        kind: t.key,
        label: t.label,
        description: t.description, // brut (éditable) ; peut être vide
        recipient: t.recipient,
        locked: false,
        system: false,
        deletable: true,
        used,
        subject: content.subject,
        html: content.html,
        defaultSubject: starter.subject,
        defaultHtml: starter.html,
        variables: CUSTOM_MAIL_VARS,
      };
    }),
  );
}

/**
 * Lignes du « Modèles d'e-mails » d'un SERVICE : types intégrés de réservation, avec le
 * contenu propre au service (surcharge du contenu global). Un service ne fait que SURCHARGER
 * le contenu — la création de types personnalisés est centralisée en administration (globale).
 */
export async function getModeleRows(serviceId: string): Promise<KindData[]> {
  return getMailRows(MAIL_KINDS, serviceId);
}

/**
 * Lignes « Modèles d'e-mails (tous services) » (admin, Messagerie) : types intégrés au
 * niveau GLOBAL (contenu de base hérité par tous les services) PUIS types personnalisés
 * GLOBAUX (supprimables), routables dans tous les services.
 */
export async function getGlobalModeleRows(): Promise<KindData[]> {
  const [builtin, custom] = await Promise.all([getMailRows(MAIL_KINDS), customRows()]);
  return [...builtin, ...custom];
}

/**
 * Options du menu « Type d'e-mail » (« Échanges par mail », GLOBAL) : types intégrés +
 * types personnalisés GLOBAUX. Le routage étant global, on ne propose PAS les types perso
 * d'un service (ils ne seraient ciblables que dans leur service).
 */
export async function getKindOptions(): Promise<{ value: string; label: string }[]> {
  const [meta, global] = await Promise.all([getMailTypeMeta(), listCustomMailTypes()]);
  const builtin = MAIL_KINDS.map((k) => ({ value: k, label: (meta[k] ?? META[k]).label }));
  return [...builtin, ...global.map((t) => ({ value: t.key, label: t.label }))];
}
