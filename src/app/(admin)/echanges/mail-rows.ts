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

// E-mails « système » (compte / sécurité + test) + notifications aux gestionnaires, contenu
// modifiable. Cet ordre détermine l'affichage dans Administration › Échanges. « E-mail de
// test » est placé après le préavis RGPD ; les deux récapitulatifs destinés aux
// gestionnaires ferment la liste, « Nouvelles réservations » après « Auto-validations ».
export const SYSTEM_MAIL_KINDS = [
  "email_verification",
  "password_reset",
  "password_changed",
  "two_factor_changed",
  "account_deletion_request",
  "account_deletion_notice",
  "email_test",
  "manager_digest",
  "manager_new_bookings",
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
  booking_absence: {
    label: "Absence prévenue",
    description:
      "Envoyé lorsqu'une absence est signalée à l'avance sur une séance : par l'usager depuis son agenda (destinataire par défaut : les gestionnaires du service) ou par un gestionnaire prévenu par ailleurs (destinataire par défaut : l'usager concerné).",
    recipient: "Les gestionnaires du service, ou l'usager concerné (selon l'action)",
  },
  waitlist_joined: {
    label: "Liste d'attente : inscription",
    description:
      "Envoyé à l'usager lorsqu'il s'inscrit sur la liste d'attente d'un service (récapitule ses disponibilités).",
    recipient: "L'usager concerné",
  },
  waitlist_available: {
    label: "Liste d'attente : créneaux libérés",
    description:
      "Envoyé à un inscrit de la liste d'attente lorsque des créneaux réservables correspondant à ses disponibilités apparaissent (nouveautés seulement).",
    recipient: "L'usager concerné",
  },
  waitlist_autobooked: {
    label: "Liste d'attente : inscription automatique",
    description:
      "Envoyé à un inscrit de la liste d'attente ayant demandé l'inscription automatique, lorsqu'une réservation a été faite en son nom sur un créneau libéré (en plus de l'e-mail de réservation habituel).",
    recipient: "L'usager concerné",
  },
  waitlist_expired: {
    label: "Liste d'attente : inscription échue",
    description:
      "Envoyé à un inscrit de la liste d'attente lorsque les périodes qu'il souhaitait sont terminées sans qu'une place ait pu lui être proposée : son inscription est close automatiquement.",
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
  two_factor_changed: {
    label: "Double authentification modifiée",
    description:
      "Alerte envoyée APRÈS toute activation, réinitialisation ou désactivation du second facteur (toujours envoyé). Sans lien : c'est ce qui permet à l'usager de détecter qu'un tiers a pris la main sur son compte.",
    recipient: "L'utilisateur",
  },
  password_changed: {
    label: "Mot de passe modifié",
    description:
      "Alerte envoyée APRÈS tout changement de mot de passe, réinitialisation comprise (toujours envoyé). Sans lien : c'est ce qui permet à l'usager de détecter une prise de contrôle de son compte.",
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
      "Récapitulatif des réservations validées automatiquement, envoyé aux gestionnaires du service (rôle gestionnaire, via leur rattachement). Fréquence réglée par service (Paramètres > Réservations) ; en mode « Unitaires », un e-mail par réservation au lieu d'un récapitulatif.",
    recipient: "Les gestionnaires du service",
  },
  manager_new_bookings: {
    label: "Nouvelles réservations",
    description:
      "Récapitulatif des réservations déposées depuis la dernière notification — demandes en attente ET confirmées, groupées par nature dans la liste —, envoyé aux gestionnaires du service. Même fréquence que « Auto-validations » (Paramètres > Réservations) ; en mode « Unitaires », un e-mail par réservation au lieu d'un récapitulatif.",
    recipient: "Les gestionnaires du service",
  },
};

export type MailTypeMeta = { label: string; description: string; recipient: string };

// ── Refonte Dom 2026-09-09 : regroupements de l'onglet Échanges ─────────────────────
/** Famille d'un déclencheur (intertitre de « Échanges par mail »). */
export type TriggerFamily = "reservations" | "rappels" | "attente";
/** Qui déclenche l'action : pastille devant le libellé. */
export type TriggerActor = "usager" | "gestionnaire" | "auto";
const TRIGGER_GROUP: Record<BookingTrigger, { family: TriggerFamily; actor: TriggerActor }> = {
  pending_create: { family: "reservations", actor: "usager" },
  confirm_create: { family: "reservations", actor: "usager" },
  cancel_user: { family: "reservations", actor: "usager" },
  confirm_manager_create: { family: "reservations", actor: "gestionnaire" },
  confirm_validate: { family: "reservations", actor: "gestionnaire" },
  unvalidate: { family: "reservations", actor: "gestionnaire" },
  refuse: { family: "reservations", actor: "gestionnaire" },
  cancel_manager: { family: "reservations", actor: "gestionnaire" },
  confirm_autovalidate: { family: "reservations", actor: "auto" },
  reminder: { family: "rappels", actor: "auto" },
  absence_user: { family: "rappels", actor: "usager" },
  absence_manager: { family: "rappels", actor: "gestionnaire" },
  waitlist_join: { family: "attente", actor: "usager" },
  waitlist_available: { family: "attente", actor: "auto" },
  waitlist_autobook: { family: "attente", actor: "auto" },
  waitlist_expire: { family: "attente", actor: "auto" },
};

/** Famille d'un type d'e-mail (intertitre de « Modèles d'e-mails »). */
export type KindFamily =
  | "compte"
  | "gestionnaires"
  | "reservations"
  | "absences"
  | "attente"
  | "perso";
/** Familles d'e-mails de réservation (routables par action) : absences et liste d'attente
 *  ont leur propre intertitre (Dom 2026-09-10), le reste est « Réservations ». */
const BOOKING_FAMILIES: readonly KindFamily[] = ["reservations", "absences", "attente"];
function kindFamily(kind: string): KindFamily {
  if (kind.startsWith("manager_")) return "gestionnaires";
  if ((SYSTEM_MAIL_KINDS as readonly string[]).includes(kind)) return "compte";
  if (kind.startsWith("waitlist_")) return "attente";
  if (kind === "booking_absence") return "absences";
  if ((MAIL_KINDS as readonly string[]).includes(kind)) return "reservations";
  return "perso";
}

/**
 * Usage d'un type par les actions de « Échanges par mail » : nombre d'actions routées vers
 * lui, dont combien ont l'envoi activé. Routage GLOBAL → même réponse dans toute portée.
 */
export type KindUsage = { actions: number; enabled: number };
async function routingUsage(): Promise<Record<string, KindUsage>> {
  const [kinds, prefs] = await Promise.all([getTriggerKinds(), getTriggerPrefs()]);
  const out: Record<string, KindUsage> = {};
  for (const t of Object.keys(kinds) as BookingTrigger[]) {
    const k = kinds[t];
    out[k] ??= { actions: 0, enabled: 0 };
    out[k].actions++;
    if (prefs[t]) out[k].enabled++;
  }
  return out;
}

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
  const [templates, meta, usage, bases] = await Promise.all([
    Promise.all(kinds.map((k) => getMailTemplate(k, serviceId))),
    getMailTypeMeta(),
    routingUsage(),
    // Portée service : la référence « non modifié » est le contenu GLOBAL (hérité), pas le
    // défaut livré — un texte retouché en administration n'est pas une surcharge du service.
    serviceId ? Promise.all(kinds.map((k) => getMailTemplate(k))) : null,
  ]);
  // « Verrouillé » = e-mail système (toujours envoyé). Les types de réservation ne le sont
  // pas (leur envoi est piloté par action, cf. « Échanges par mail »).
  const toggleable = new Set<string>(MAIL_KINDS);
  const systemSet = new Set<string>(SYSTEM_MAIL_KINDS);

  return kinds.map((kind, i) => {
    const m = meta[kind] ?? META[kind];
    const base = bases ? bases[i] : DEFAULT_TEMPLATES[kind];
    const family = kindFamily(kind);
    return {
      kind,
      label: m.label,
      description: m.description,
      recipient: m.recipient,
      family,
      usage: BOOKING_FAMILIES.includes(family) ? (usage[kind] ?? { actions: 0, enabled: 0 }) : null,
      modified: templates[i].subject !== base.subject || templates[i].html !== base.html,
      locked: !toggleable.has(kind),
      // « Système » = e-mail compte/sécurité TOUJOURS envoyé. Les récapitulatifs aux
      // gestionnaires (`manager_digest`, `manager_new_bookings`) sont listés ici mais
      // leur envoi dépend d'un réglage PAR SERVICE → pas « système ».
      system: systemSet.has(kind) && !kind.startsWith("manager_"),
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
  family: TriggerFamily;
  actor: TriggerActor;
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
    family: TRIGGER_GROUP[t.key]?.family ?? "reservations",
    actor: TRIGGER_GROUP[t.key]?.actor ?? "auto",
  }));
}

/** Lignes « Modèles » des types PERSONNALISÉS d'une portée (service ou, si omis, globale). */
async function customRows(serviceId?: string): Promise<KindData[]> {
  const [customTypes, usage] = await Promise.all([listCustomMailTypes(serviceId), routingUsage()]);
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
        family: "perso",
        usage: usage[t.key] ?? { actions: 0, enabled: 0 },
        modified: content.subject !== starter.subject || content.html !== starter.html,
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
