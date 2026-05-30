import { prisma } from "@/server/db";
import { RgpdExportForm } from "./export-form";

const dtFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const ACTION_LABELS: Record<string, string> = {
  export: "Export (art. 15)",
  anonymize: "Anonymisation",
  self_delete: "Suppression self-service",
  deletion_notice: "Préavis de suppression",
};

export default async function RgpdAdminPage() {
  const [logs, users] = await Promise.all([
    prisma.rgpdLog.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.user.findMany({
      orderBy: [{ nom: "asc" }, { prenom: "asc" }],
      select: { id: true, nom: true, prenom: true, email: true },
    }),
  ]);

  const nameById = new Map(users.map((u) => [u.id, `${u.nom} ${u.prenom}`.trim() || u.email]));
  const userOpts = users.map((u) => ({
    id: u.id,
    label: `${u.nom} ${u.prenom}`.trim() + ` — ${u.email}`,
  }));

  return (
    <div>
      <div className="panel-title">
        <span className="dot" />
        RGPD
      </div>

      <div className="panel">
        <div className="panel-title" style={{ fontSize: ".82rem" }}>
          <span className="dot" />
          Export des données d&apos;un usager (art. 15 — droit d&apos;accès)
        </div>
        <p style={{ fontSize: ".8rem", color: "var(--muted)", marginBottom: ".75rem" }}>
          Télécharge l&apos;intégralité des données d&apos;un usager (profil + réservations) au
          format JSON. Chaque export est journalisé ci-dessous.
        </p>
        <RgpdExportForm users={userOpts} />
      </div>

      <div className="panel">
        <div className="panel-title" style={{ fontSize: ".82rem" }}>
          <span className="dot" />
          Journal d&apos;audit
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Action</th>
                <th>Usager concerné</th>
                <th>Effectué par</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td>{dtFmt.format(l.createdAt)}</td>
                  <td>{ACTION_LABELS[l.action] ?? l.action}</td>
                  <td>{l.targetUserId ? (nameById.get(l.targetUserId) ?? l.targetUserId) : "—"}</td>
                  <td>{l.actorUserId ? (nameById.get(l.actorUserId) ?? l.actorUserId) : "Système"}</td>
                  <td>{l.ip ?? "—"}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", padding: "1.5rem", color: "var(--muted)" }}>
                    Aucune entrée pour le moment.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p style={{ fontSize: ".72rem", color: "var(--muted)", marginTop: ".5rem" }}>
        L&apos;anonymisation (art. 17) et la purge automatique des comptes inactifs sont gérées par
        le conteneur cron (à venir dans l&apos;interface).
      </p>
    </div>
  );
}
