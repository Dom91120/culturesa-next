import type { Role } from "@prisma/client";
import { prisma } from "@/server/db";

const ROLE_META: Record<Role, { cls: string; label: string }> = {
  administrateur: { cls: "role-admin", label: "ADMIN" },
  gestionnaire: { cls: "role-gestionnaire", label: "GESTIONNAIRE" },
  utilisateur: { cls: "role-utilisateur", label: "UTILISATEUR" },
};

export default async function UsersPage() {
  const users = await prisma.user.findMany({
    orderBy: [{ nom: "asc" }, { prenom: "asc" }],
    select: {
      id: true,
      nom: true,
      prenom: true,
      email: true,
      tel: true,
      role: true,
      demandeur: { select: { label: true } },
      structure: { select: { label: true } },
    },
  });

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: ".75rem",
          flexWrap: "wrap",
          marginBottom: "1rem",
        }}
      >
        <div className="panel-title" style={{ marginBottom: 0 }}>
          <span className="dot" />
          Comptes utilisateurs
        </div>
        <span style={{ fontSize: ".72rem", color: "var(--muted)" }}>
          {users.length} compte{users.length > 1 ? "s" : ""}
        </span>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th className="col-check" />
              <th>Nom</th>
              <th>Prénom</th>
              <th>E-mail</th>
              <th>Téléphone</th>
              <th>Structure / Service</th>
              <th>Rôle</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const meta = ROLE_META[u.role];
              return (
                <tr key={u.id}>
                  <td className="col-check">
                    <input type="checkbox" />
                  </td>
                  <td style={{ fontWeight: 600 }}>{u.nom || "—"}</td>
                  <td>{u.prenom || "—"}</td>
                  <td>{u.email}</td>
                  <td>{u.tel || "—"}</td>
                  <td>{u.structure?.label ?? u.demandeur?.label ?? "—"}</td>
                  <td>
                    <span className={`role-pill ${meta.cls}`}>{meta.label}</span>
                  </td>
                </tr>
              );
            })}
            {users.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: "1.5rem", color: "var(--muted)" }}>
                  Aucun compte.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: ".72rem", color: "var(--muted)", marginTop: ".75rem" }}>
        Recherche, pagination, colonne RGPD et création de comptes — à venir.
      </p>
    </div>
  );
}
