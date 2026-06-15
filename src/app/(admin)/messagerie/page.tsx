import { getConfigMany } from "@/server/config";
import { prisma } from "@/server/db";
import { EchangesConfig } from "../echanges/echanges-config";
import { SYSTEM_MAIL_KINDS, getMailRows } from "../echanges/mail-rows";
import { FailedMailsPanel } from "./failed-mails";
import { MessagingConfig } from "./messaging-config";

export default async function MessageriePage() {
  // Le mot de passe (mail.password) n'est jamais renvoyé au client.
  const [cfg, failedMails, autoMailRows] = await Promise.all([
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
        intro={
          <>
            E-mails de <strong>compte&nbsp;/&nbsp;sécurité</strong> (confirmation d&apos;adresse,
            mot de passe, suppression de compte, préavis RGPD) et e-mail de test. Ils sont{" "}
            <strong>toujours envoyés</strong> : leur case « Envoyer » est verrouillée, mais leur
            contenu reste modifiable.
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
