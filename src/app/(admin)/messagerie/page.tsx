import { getConfigMany } from "@/server/config";
import { prisma } from "@/server/db";
import { requireRole } from "@/server/guards";
import { FailedMailsPanel } from "./failed-mails";
import { type LastTest, MessagingConfig } from "./messaging-config";

export default async function MessageriePage() {
  // Administration réservée aux administrateurs (les gestionnaires n'y ont pas accès).
  await requireRole("administrateur");
  // Le mot de passe (mail.password) n'est jamais renvoyé au client : seule sa
  // PRÉSENCE l'est (pastille « conservé » du formulaire).
  const [cfg, failedMails] = await Promise.all([
    getConfigMany([
      "mail.driver",
      "mail.from",
      "mail.fromName",
      "mail.host",
      "mail.port",
      "mail.security",
      "mail.username",
      "mail.password",
      "mail.lastTest.at",
      "mail.lastTest.to",
      "mail.lastTest.ok",
      "mail.lastTest.error",
      "mail.lastTest.ms",
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

  const lastTest: LastTest | null = cfg["mail.lastTest.at"]
    ? {
        at: cfg["mail.lastTest.at"],
        to: cfg["mail.lastTest.to"] ?? "",
        ok: cfg["mail.lastTest.ok"] === "1",
        error: cfg["mail.lastTest.error"] ?? "",
        ms: Number(cfg["mail.lastTest.ms"] ?? 0) || 0,
      }
    : null;

  const nowMs = Date.now();

  return (
    <>
      <MessagingConfig
        config={{
          driver: cfg["mail.driver"] ?? "",
          from: cfg["mail.from"] ?? "",
          fromName: cfg["mail.fromName"] ?? "",
          host: cfg["mail.host"] ?? "",
          port: cfg["mail.port"] ?? "",
          security: cfg["mail.security"] ?? "",
          username: cfg["mail.username"] ?? "",
          hasPassword: !!cfg["mail.password"],
        }}
        lastTest={lastTest}
        failedCount={failedMails.length}
        oldestFailedAt={failedMails.at(-1)?.createdAt.toISOString() ?? null}
        nowMs={nowMs}
      />
      <FailedMailsPanel
        nowMs={nowMs}
        mails={failedMails.map((m) => ({
          ...m,
          createdAt: m.createdAt.toISOString(),
          lastTriedAt: m.lastTriedAt.toISOString(),
        }))}
      />
    </>
  );
}
