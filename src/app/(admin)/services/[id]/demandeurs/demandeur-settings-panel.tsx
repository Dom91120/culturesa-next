"use client";

import type { DemandeurSettingRow } from "@/server/services/demandeur-settings";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { saveDemandeurSettingsAction } from "./actions";
import { type ToggleField, applyToggle, normalizeInitial } from "./sync-rules";

type DemandeurOption = { id: number; label: string };

/** Ligne d'état UI : la donnée métier + une clé stable pour le rendu React. */
type UiRow = DemandeurSettingRow & { key: string };

type Props = {
  serviceId: string;
  allDemandeurs: DemandeurOption[];
  initialRows: DemandeurSettingRow[];
};

const COLS: { field: ToggleField; head: string }[] = [
  { field: "recurrent", head: "Récurrent" },
  { field: "semaineAb", head: "Semaine A/B" },
  { field: "validation", head: "Validation" },
  { field: "themes", head: "Thèmes" },
  { field: "jauge", head: "Jauge" },
];

const TH_STYLE: React.CSSProperties = {
  padding: ".35rem .5rem",
  fontSize: ".7rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: ".06em",
  color: "var(--muted)",
  textAlign: "center",
  whiteSpace: "nowrap",
};

/** Signature de la matrice (sans les clés UI) pour détecter les modifications. */
function sig(rows: { demandeurId: number; [k: string]: unknown }[]): string {
  return JSON.stringify(
    rows.map((r) => ({
      demandeurId: r.demandeurId,
      recurrent: r.recurrent,
      semaineAb: r.semaineAb,
      validation: r.validation,
      themes: r.themes,
      jauge: r.jauge,
    })),
  );
}

/** Reproduction du switch legacy `makeToggle` (compact 26×14). */
function Toggle({
  on,
  disabled,
  onToggle,
}: {
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  const isOn = disabled ? false : on;
  return (
    <button
      type="button"
      aria-pressed={isOn}
      disabled={disabled}
      onClick={onToggle}
      style={{
        position: "relative",
        width: 26,
        height: 14,
        borderRadius: 99,
        background: isOn ? "var(--accent)" : "var(--surface2)",
        border: `1.5px solid ${isOn ? "var(--accent)" : "var(--border)"}`,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.35 : 1,
        transition: ".25s",
        flexShrink: 0,
        padding: 0,
        verticalAlign: "middle",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 1,
          left: isOn ? 12.5 : 1.5,
          width: 9,
          height: 9,
          borderRadius: "50%",
          background: isOn ? "#0f1117" : "var(--muted)",
          transition: ".25s",
          display: "block",
        }}
      />
    </button>
  );
}

export function DemandeurSettingsPanel({ serviceId, allDemandeurs, initialRows }: Props) {
  const router = useRouter();
  const counter = useRef(0);

  // État initial normalisé (cohérence inter-lignes), avec clés stables.
  const normalizedInitial = useMemo(() => normalizeInitial(initialRows), [initialRows]);
  const fromInitial = (): UiRow[] => normalizedInitial.map((r, i) => ({ ...r, key: `db-${i}` }));

  const [rows, setRows] = useState<UiRow[]>(fromInitial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const initialSig = useMemo(() => sig(normalizedInitial), [normalizedInitial]);
  const dirty = sig(rows) !== initialSig;

  const usedIds = new Set(rows.map((r) => r.demandeurId).filter((id) => id > 0));
  const availableLeft = allDemandeurs.filter((d) => !usedIds.has(d.id));

  function toggle(idx: number, field: ToggleField) {
    setSaved(false);
    setRows((rs) => {
      const next = applyToggle(rs, idx, field);
      // applyToggle renvoie des lignes sans la clé `key` -> on la réinjecte.
      return next.map((r, i) => ({ ...r, key: rs[i].key }));
    });
  }

  function setRowDemandeur(idx: number, value: string) {
    setSaved(false);
    const id = value ? Number.parseInt(value, 10) : 0;
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, demandeurId: id } : r)));
  }

  function addRow() {
    setSaved(false);
    setRows((rs) => {
      // Hériter la jauge d'une ligne ponctuelle existante (mode par défaut).
      const sameModeRow = rs.find((r) => !r.recurrent);
      const defaultJauge = sameModeRow ? sameModeRow.jauge : false;
      return [
        ...rs,
        {
          key: `new-${counter.current++}`,
          demandeurId: 0,
          recurrent: false,
          semaineAb: false,
          validation: false,
          themes: false,
          jauge: defaultJauge,
        },
      ];
    });
  }

  function removeRow(key: string) {
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
    const payload: DemandeurSettingRow[] = rows
      .filter((r) => r.demandeurId > 0)
      .map((r) => ({
        demandeurId: r.demandeurId,
        recurrent: r.recurrent,
        semaineAb: r.semaineAb,
        validation: r.validation,
        themes: r.themes,
        jauge: r.jauge,
      }));
    startTransition(async () => {
      const res = await saveDemandeurSettingsAction({ serviceId, rows: payload });
      if (res && !res.ok) {
        setError(res.error ?? "Échec de l'enregistrement.");
        return;
      }
      setRows(payload.map((r, i) => ({ ...r, key: `db-${i}` })));
      setSaved(true);
      router.refresh();
    });
  }

  function labelFor(id: number): string {
    return allDemandeurs.find((d) => d.id === id)?.label ?? "";
  }

  return (
    <div className="panel">
      <div className="panel-title" style={{ justifyContent: "space-between" }}>
        <span style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
          <span className="dot" style={{ background: "var(--warn)" }} />
          Configuration des demandeurs
        </span>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={addRow}
          disabled={availableLeft.length === 0}
          style={{ fontSize: ".68rem", padding: ".25rem .65rem", whiteSpace: "nowrap" }}
        >
          ＋ Ajouter
        </button>
      </div>

      <div id="params-cat-table" style={{ margin: "1rem 0 .6rem" }}>
        {rows.length > 0 ? (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...TH_STYLE, textAlign: "left" }}>Demandeur</th>
                {COLS.map((c) => (
                  <th key={c.field} style={TH_STYLE}>
                    {c.head}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={row.key}>
                  <td
                    style={{
                      padding: ".4rem .6rem",
                      fontSize: ".82rem",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {row.demandeurId > 0 ? (
                      labelFor(row.demandeurId)
                    ) : (
                      <select
                        value=""
                        onChange={(e) => setRowDemandeur(idx, e.target.value)}
                        style={{ fontSize: ".82rem", padding: ".25rem .4rem" }}
                      >
                        <option value="">— Demandeur —</option>
                        {availableLeft.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  {COLS.map((c) => {
                    const disabled = c.field === "semaineAb" && !row.recurrent;
                    return (
                      <td key={c.field} style={{ padding: ".4rem .5rem", textAlign: "center" }}>
                        <Toggle
                          on={row[c.field]}
                          disabled={disabled}
                          onToggle={() => toggle(idx, c.field)}
                        />
                      </td>
                    );
                  })}
                  <td style={{ padding: ".4rem .3rem", textAlign: "center" }}>
                    <button
                      type="button"
                      onClick={() => removeRow(row.key)}
                      title="Supprimer"
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--muted)",
                        fontSize: ".9rem",
                        lineHeight: 1,
                        padding: ".1rem .3rem",
                      }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ padding: ".4rem .5rem", fontSize: ".8rem", color: "var(--muted)" }}>
            Aucun demandeur configuré.
          </div>
        )}
      </div>

      <div
        style={{
          marginTop: ".75rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: ".5rem",
        }}
      >
        {error && (
          <span className="field-error" style={{ display: "inline" }}>
            {error}
          </span>
        )}
        {saved && !dirty && (
          <span style={{ fontSize: ".78rem", color: "var(--accent)" }}>✓ Enregistré</span>
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
