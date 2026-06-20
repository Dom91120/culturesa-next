import { getConfigMany } from "@/server/config";
import { prisma } from "@/server/db";
import { requireRole } from "@/server/guards";
import { EchangesConfig } from "../echanges/echanges-config";
import { SYSTEM_MAIL_KINDS, getGlobalModeleRows, getMailRows } from "../echanges/mail-rows";
import { FailedMailsPanel } from "./failed-mails";
import { MessagingConfig } from "./messaging-config";

export default async function MessageriePage() {
  // Administration réservée aux administrateurs (les gestionnaires n'y ont pas accès).
  await requireRole("administrateur");
  // Le mot de passe (mail.password) n'est jamais renvoyé au client.
  const [cfg, failedMails, autoMailRows, globalModeleRows] = await Promise.all([
    getConfigMany([
      "mail.driver",
      "mail.from",
      "mail.fromName",
      "mail.host",
      "mail.port",
      "mail.security",
      "mail.username",
    ]),
    prisma.failedMail.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        toAddr: true,
        subject: true,
        error: true,
        attempts: true,
        createdAt: true,
        lastTriedAt: true,
      },
    }),
    getMailRows(SYSTEM_MAIL_KINDS),
    getGlobalModeleRows(),
  ]);

  return (
    <>
      <MessagingConfig
        config={{
          driver: cfg["mail.driver"],
          from: cfg["mail.from"],
          fromName: cfg["mail.fromName"],
          host: cfg["mail.host"],
          port: cfg["mail.port"],
          security: cfg["mail.security"],
          username: cfg["mail.username"],
        }}
      />
      <EchangesConfig
        rows={autoMailRows}
        title="E-mails automatiques"
        panelId="auto-mails-panel"
        showRecipient
        intro={
          <>
            E-mails de <strong>compte&nbsp;/&nbsp;sécurité</strong> (confirmation d&apos;adresse,
            mot de passe, suppression de compte, préavis RGPD) et e-mail de test. Ils sont{" "}
            <strong>toujours envoyés</strong> : leur case « Envoyer » est verrouillée, mais leur
            contenu reste modifiable.
          </>
        }
      />
      <EchangesConfig
        // Remonte le composant quand l'ensemble des types change (création/suppression).
        key={globalModeleRows.map((r) => r.kind).join(",")}
        rows={globalModeleRows}
        title="Modèles d'e-mails (tous services)"
        panelId="global-modeles-panel"
        showSend={false}
        allowCreate
        contentLabel="Modèle"
        intro={
          <>
            Contenu <strong>de base</strong> des e-mails de réservation, valable pour{" "}
            <strong>tous les services</strong> (chaque service peut le surcharger dans ses propres «
            Modèles d&apos;e-mails »). Vous pouvez aussi créer des types <strong>globaux</strong>,
            routables vers une action dans n&apos;importe quel service.
          </>
        }
      />
      <FailedMailsPanel
        mails={failedMails.map((m) => ({
          ...m,
          createdAt: m.createdAt.toISOString(),
          lastTriedAt: m.lastTriedAt.toISOString(),
        }))}
      />
    </>
  );
}
