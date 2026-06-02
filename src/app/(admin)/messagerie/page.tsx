import { getConfigMany } from "@/server/config";
import { MessagingConfig } from "./messaging-config";

export default async function MessageriePage() {
  // Le mot de passe (mail.password) n'est jamais renvoyé au client.
  const cfg = await getConfigMany([
    "mail.driver",
    "mail.from",
    "mail.fromName",
    "mail.host",
    "mail.port",
    "mail.security",
    "mail.username",
  ]);

  return (
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
  );
}
