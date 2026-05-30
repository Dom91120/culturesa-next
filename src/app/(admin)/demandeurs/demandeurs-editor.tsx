"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { saveDemandeursAction } from "./actions";

type Row = { id: number | null; label: string; openOnSchoolHolidays: boolean; key: string };
type Initial = { id: number; label: string; openOnSchoolHolidays: boolean };

export function DemandeursEditor({ initial }: { initial: Initial[] }) {
  const router = useRouter();
  const counter = useRef(0);
  const [rows, setRows] = useState<Row[]>(
    initial.map((d) => ({ ...d, key: `db-${d.id}` })),
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function update(key: string, patch: Partial<Row>) {
    setSaved(false);
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function add() {
    setSaved(false);
    setRows((rs) => [
      ...rs,
      { id: null, label: "", openOnSchoolHolidays: true, key: `new-${counter.current++}` },
    ]);
  }
  function remove(key: string) {
    setSaved(false);
    setRows((rs) => rs.filter((r) => r.key !== key));
  }

  function save() {
    setError(null);
    const payload = rows
      .filter((r) => r.label.trim().length > 0)
      .map((r) => ({ id: r.id, label: r.label.trim(), openOnSchoolHolidays: r.openOnSchoolHolidays }));
    startTransition(async () => {
      const res = await saveDemandeursAction(payload);
      if (res && !res.ok) {
        setError(res.error ?? "Échec de l'enregistrement.");
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

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
          Demandeurs
        </div>
        <button type="button" className="btn btn-ghost" onClick={add}>
          + Ajouter
        </button>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Libellé</th>
              <th style={{ textAlign: "center", width: 130 }}>Vacances</th>
              <th style={{ width: 50 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>
                  <input
                    value={r.label}
                    placeholder="Libellé du demandeur"
                    style={{ width: "100%" }}
                    onChange={(e) => update(r.key, { label: e.target.value })}
                  />
                </td>
                <td style={{ textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={r.openOnSchoolHolidays}
                    onChange={(e) => update(r.key, { openOnSchoolHolidays: e.target.checked })}
                  />
                </td>
                <td style={{ textAlign: "center" }}>
                  <button
                    type="button"
                    onClick={() => remove(r.key)}
                    title="Supprimer"
                    className="btn btn-ghost"
                    style={{ padding: ".1rem .4rem", borderColor: "rgba(224,107,107,.4)", color: "var(--danger)" }}
                  >
                    🗑️
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} style={{ textAlign: "center", padding: "1.5rem", color: "var(--muted)" }}>
                  Aucun demandeur.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: ".75rem", marginTop: "1rem" }}>
        {error && <span className="field-error" style={{ display: "inline" }}>{error}</span>}
        {saved && <span style={{ fontSize: ".8rem", color: "var(--accent)" }}>Enregistré ✓</span>}
        <button
          type="button"
          className="btn btn-primary"
          onClick={save}
          disabled={pending}
          style={{ background: "var(--warn)", color: "#0f1117" }}
        >
          {pending ? "Enregistrement…" : "💾 Enregistrer"}
        </button>
      </div>
    </div>
  );
}
