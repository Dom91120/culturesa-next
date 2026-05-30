"use client";

import type { Role } from "@prisma/client";
import { useMemo, useState } from "react";

type UserRow = {
  id: string;
  nom: string;
  prenom: string;
  email: string;
  tel: string;
  role: Role;
  rgpdOk: boolean;
  affiliation: string | null;
};

const ROLE_META: Record<Role, { cls: string; label: string }> = {
  administrateur: { cls: "role-admin", label: "ADMIN" },
  gestionnaire: { cls: "role-gestionnaire", label: "GESTIONNAIRE" },
  utilisateur: { cls: "role-utilisateur", label: "UTILISATEUR" },
};

const PAGE_SIZE = 12;

export function UsersTable({ users }: { users: UserRow[] }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      [u.nom, u.prenom, u.email].some((v) => v.toLowerCase().includes(q)),
    );
  }, [users, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const start = current * PAGE_SIZE;
  const visible = filtered.slice(start, start + PAGE_SIZE);

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
        <div style={{ display: "flex", gap: ".5rem", alignItems: "center" }}>
          <input
            type="search"
            placeholder="🔍  Nom, e-mail…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            style={{ minWidth: 220 }}
          />
          <button type="button" className="btn btn-ghost" disabled title="À venir">
            + Ajouter
          </button>
        </div>
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
              <th style={{ textAlign: "center" }}>RGPD</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((u) => {
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
                  <td>{u.affiliation ?? "—"}</td>
                  <td>
                    <span className={`role-pill ${meta.cls}`}>{meta.label}</span>
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <span
                      title={u.rgpdOk ? "Consentement RGPD donné" : "Pas de consentement"}
                      style={{ opacity: u.rgpdOk ? 1 : 0.3 }}
                    >
                      🛡️
                    </span>
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", padding: "1.5rem", color: "var(--muted)" }}>
                  Aucun compte.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: ".75rem",
          fontSize: ".75rem",
          color: "var(--muted)",
        }}
      >
        <span>
          {filtered.length === 0
            ? "0 compte"
            : `${start + 1}–${start + visible.length} sur ${filtered.length} compte${filtered.length > 1 ? "s" : ""}`}
        </span>
        <div className="exercice-nav-inline">
          <span className="ex-nav-arrows">
            <button
              type="button"
              className="ex-arrow"
              disabled={current === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              ‹
            </button>
          </span>
          <span className="ex-nav-label" style={{ margin: "0 .5rem" }}>
            {current + 1}/{pageCount}
          </span>
          <span className="ex-nav-arrows">
            <button
              type="button"
              className="ex-arrow"
              disabled={current >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            >
              ›
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
