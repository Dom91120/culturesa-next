import { getConfigMany } from "@/server/config";
import { MessagingPanel } from "./messaging-panel";

export default async function MessageriePage() {
  const cfg = await getConfigMany(["mail.senderName", "mail.signature"]);

  return (
    <div>
      <div className="panel-title">
        <span className="dot" />
        Messagerie
      </div>
      <MessagingPanel
        senderName={cfg["mail.senderName"]}
        signature={cfg["mail.signature"]}
        smtpConfigured={Boolean(process.env.SMTP_HOST)}
        smtpHost={process.env.SMTP_HOST ?? ""}
        smtpFrom={process.env.SMTP_FROM ?? ""}
      />
    </div>
  );
}
