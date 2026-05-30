"use client";

import { useState } from "react";

type UserOpt = { id: string; label: string };

export function RgpdExportForm({ users }: { users: UserOpt[] }) {
  const [userId, setUserId] = useState("");

  return (
    <div style={{ display: "flex", gap: ".6rem", alignItems: "flex-end", flexWrap: "wrap" }}>
      <label className="field" style={{ minWidth: 240 }}>
        <span style={{ fontSize: ".65rem", fontWeight: 600, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--muted)" }}>
          Usager
        </span>
        <select value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">— choisir —</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </select>
      </label>
      {userId ? (
        <a
          href={`/rgpd/export?userId=${encodeURIComponent(userId)}`}
          className="btn btn-primary"
          style={{ textDecoration: "none" }}
        >
          📥 Télécharger (JSON)
        </a>
      ) : (
        <button type="button" className="btn btn-primary" disabled>
          📥 Télécharger (JSON)
        </button>
      )}
    </div>
  );
}
