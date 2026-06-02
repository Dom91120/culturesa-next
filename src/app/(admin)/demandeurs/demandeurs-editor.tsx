"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { saveDemandeursAction } from "./actions";

type Row = { id: number | null; label: string; openOnSchoolHolidays: boolean; key: string };
type Initial = { id: number; label: string; openOnSchoolHolidays: boolean };

function sig(rows: { id: number | null; label: string; openOnSchoolHolidays: boolean }[]) {
  return rows
    .map((r) => `${r.id ?? "new"}|${r.label.trim()}|${r.openOnSchoolHolidays ? 1 : 0}`)
    .join(";");
}

export function DemandeursEditor({ initial }: { initial: Initial[] }) {
  const router = useRouter();
  const counter = useRef(0);
  const fromInitial = () => initial.map((d) => ({ ...d, key: `db-${d.id}` }));
  const [rows, setRows] = useState<Row[]>(fromInitial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const initialSig = useMemo(() => sig(initial), [initial]);
  const dirty = sig(rows) !== initialSig;

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
  function cancel() {
    setError(null);
    setSaved(false);
    setRows(fromInitial());
  }

  function save() {
    setError(null);
    const payload = rows
      .filter((r) => r.label.trim().length > 0)
      .map((r) => ({
        id: r.id,
        label: r.label.trim(),
        openOnSchoolHolidays: r.openOnSchoolHolidays,
      }));
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
      <div className="panel-title" style={{ justifyContent: "space-between", gap: ".75rem" }}>
        <span style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
          <span className="dot" style={{ background: "var(--warn)" }} />
          Demandeurs
        </span>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={add}
          style={{ padding: ".25rem .65rem", fontSize: ".68rem" }}
        >
          ＋ Ajouter
        </button>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th style={{ minWidth: 200, textAlign: "left" }}>Libellé</th>
              <th
                style={{ width: 240, textAlign: "center" }}
                title="Coché = Ouvert pendant les vacances scolaires"
              >
                Vacances
              </th>
              <th style={{ width: 80 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>
                  <input
                    type="text"
                    value={r.label}
                    placeholder="Nom du demandeur"
                    onChange={(e) => update(r.key, { label: e.target.value })}
                    style={{
                      width: "100%",
                      background: "var(--surface2)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--rad-sm)",
                      color: "var(--text)",
                      fontSize: ".82rem",
                      padding: ".2rem .4rem",
                    }}
                  />
                </td>
                <td style={{ textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={r.openOnSchoolHolidays}
                    title="Coché = Ouvert pendant les vacances scolaires"
                    onChange={(e) => update(r.key, { openOnSchoolHolidays: e.target.checked })}
                    style={{
                      accentColor: "var(--accent)",
                      width: 14,
                      height: 14,
                      cursor: "pointer",
                    }}
                  />
                </td>
                <td style={{ textAlign: "center" }}>
                  <button
                    type="button"
                    onClick={() => remove(r.key)}
                    title="Supprimer"
                    className="btn btn-ghost"
                    style={{
                      borderColor: "rgba(220,80,80,.4)",
                      color: "#e05555",
                      fontSize: ".65rem",
                      padding: ".15rem .5rem",
                    }}
                  >
                    🗑️
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={3}
                  style={{ textAlign: "center", padding: "1.5rem", color: "var(--muted)" }}
                >
                  Aucun demandeur.
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
          justifyContent: "flex-end",
          gap: ".5rem",
          marginTop: ".6rem",
        }}
      >
        {error && (
          <span className="field-error" style={{ display: "inline" }}>
            {error}
          </span>
        )}
        {saved && !dirty && (
          <span style={{ fontSize: ".8rem", color: "var(--accent)" }}>Enregistré ✓</span>
        )}
        {dirty && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={cancel}
            style={{ fontSize: ".7rem", padding: ".2rem .6rem" }}
          >
            Annuler
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary"
          onClick={save}
          disabled={pending}
          style={{
            background: "var(--warn)",
            color: "#0f1117",
            fontSize: ".7rem",
            padding: ".2rem .6rem",
          }}
        >
          {pending ? "Enregistrement…" : "💾 Enregistrer"}
        </button>
      </div>
    </div>
  );
}
