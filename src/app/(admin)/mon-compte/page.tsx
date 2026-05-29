import { requireUser } from "@/server/guards";

export default async function MonComptePage() {
  const session = await requireUser();
  return (
    <div className="panel">
      <div className="panel-title">
        <span className="dot" />
        Mon compte
      </div>
      <p style={{ fontSize: ".85rem", color: "var(--muted)" }}>
        Connecté en tant que <strong style={{ color: "var(--text)" }}>{session.user.email}</strong>.
        <br />
        Édition du profil, changement d&apos;e-mail / mot de passe et droits RGPD — à venir.
      </p>
    </div>
  );
}
