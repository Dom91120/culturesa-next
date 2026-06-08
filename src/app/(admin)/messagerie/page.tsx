import { getConfigMany } from "@/server/config";
import { prisma } from "@/server/db";
import { FailedMailsPanel } from "./failed-mails";
import { MessagingConfig } from "./messaging-config";

export default async function MessageriePage() {
  // Le mot de passe (mail.password) n'est jamais renvoyé au client.
  const [cfg, failedMails] = await Promise.all([
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
