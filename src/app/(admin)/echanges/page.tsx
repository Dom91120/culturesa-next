import { MAIL_KINDS, getMailPrefs } from "@/server/services/mail-prefs";
import {
  DEFAULT_TEMPLATES,
  MAIL_VARS,
  TEMPLATE_KINDS,
  type TemplateKind,
  getMailTemplate,
} from "@/server/services/mail-templates";
import { EchangesConfig, type KindData } from "./echanges-config";

// Libellés / descriptions affichés pour chaque type d'e-mail.
const META: Record<TemplateKind, { label: string; description: string }> = {
  booking_confirmed: {
    label: "Réservation confirmée",
    description: "Envoyé à l'usager lorsque sa réservation est validée d'emblée (confirmée).",
  },
  booking_pending: {
    label: "Demande de réservation enregistrée",
    description: "Envoyé lorsque la réservation est enregistrée et en attente de validation.",
  },
  booking_cancelled: {
    label: "Réservation annulée",
    description: "Envoyé lorsqu'un gestionnaire supprime une réservation déjà validée.",
  },
  booking_refused: {
    label: "Réservation non validée (refus)",
    description: "Envoyé lorsqu'un gestionnaire supprime/refuse une réservation en attente.",
  },
  booking_reminder: {
    label: "Rappel de réservation",
    description:
      "Envoyé automatiquement une semaine avant, puis la veille de chaque séance réservée (réservations confirmées).",
  },
  email_verification: {
    label: "Confirmation d'adresse e-mail",
    description: "Envoyé à l'inscription pour activer le compte (toujours envoyé).",
  },
  password_reset: {
    label: "Réinitialisation du mot de passe",
    description: "Envoyé lors d'une demande de réinitialisation (toujours envoyé).",
  },
  account_deletion_request: {
    label: "Demande de suppression de compte",
    description:
      "Envoyé à l'usager qui demande la suppression de son compte (lien de confirmation 24 h, toujours envoyé).",
  },
  account_deletion_notice: {
    label: "Préavis de suppression de compte (RGPD)",
    description: "Envoyé à un compte inactif avant anonymisation (toujours envoyé).",
  },
  email_test: {
    label: "E-mail de test",
    description: "Envoyé manuellement depuis Messagerie pour vérifier la configuration.",
  },
};

export default async function EchangesPage() {
  const prefs = await getMailPrefs();
  const templates = await Promise.all(TEMPLATE_KINDS.map((k) => getMailTemplate(k)));
  const toggleable = new Set<string>(MAIL_KINDS);

  const rows: KindData[] = TEMPLATE_KINDS.map((kind, i) => {
    const locked = !toggleable.has(kind);
    return {
      kind,
      label: META[kind].label,
      description: META[kind].description,
      // Types verrouillés : toujours envoyés ; sinon, préférence enregistrée.
      enabled: locked ? true : (prefs[kind as (typeof MAIL_KINDS)[number]] ?? true),
      locked,
      subject: templates[i].subject,
      html: templates[i].html,
      defaultSubject: DEFAULT_TEMPLATES[kind].subject,
      defaultHtml: DEFAULT_TEMPLATES[kind].html,
      variables: MAIL_VARS[kind],
    };
  });

  return <EchangesConfig rows={rows} />;
}
