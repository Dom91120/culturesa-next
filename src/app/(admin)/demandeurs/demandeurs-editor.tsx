"use client";

import { useEffect, useRef, useState } from "react";
import { createDemandeurAction, deleteDemandeurAction, updateDemandeurAction } from "./actions";

type Row = { id: number | null; label: string; openOnSchoolHolidays: boolean; key: string };
type Initial = { id: number; label: string; openOnSchoolHolidays: boolean };

const GRID = "1fr 190px 32px";

// ── Interrupteur fin (30×16) — repris de la maquette ─────────────────────────
function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      style={{
        position: "relative",
        width: 30,
        height: 16,
        borderRadius: 99,
        background: on ? "var(--accent)" : "var(--surface2)",
        border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
        cursor: "pointer",
        transition: "background .2s, border-color .2s",
        flexShrink: 0,
        padding: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 1,
          left: on ? 15 : 1,
          width: 12,
          height: 12,
          borderRadius: "50%",
          background: on ? "#0f1117" : "var(--muted)",
          transition: "left .2s",
          display: "block",
        }}
      />
    </button>
  );
}

export function DemandeursEditor({ initial }: { initial: Initial[] }) {
  const counter = useRef(0);
  const [rows, setRows] = useState<Row[]>(() => initial.map((d) => ({ ...d, key: `db-${d.id}` })));
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  // Dernier état des lignes (lu dans les callbacks asynchrones d'autosave).
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  // Timers de debounce par ligne + garde anti-double-création (créations en vol).
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const creating = useRef(new Set<string>());
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) clearTimeout(t);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  function flash() {
    setError(null);
    setSavedFlash(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setSavedFlash(false), 1500);
  }

  function scheduleSave(key: string) {
    const existing = timers.current.get(key);
    if (existing) clearTimeout(existing);
    timers.current.set(
      key,
      setTimeout(() => {
        timers.current.delete(key);
        void flushRow(key);
      }, 550),
    );
  }

  async function flushRow(key: string) {
    const row = rowsRef.current.find((r) => r.key === key);
    if (!row) return;
    const label = row.label.trim();
    if (!label) return; // libellé vide : rien à persister (création/maj invalide)
    // Une création est déjà en vol pour cette ligne → on réessaie après.
    if (creating.current.has(key)) {
      scheduleSave(key);
      return;
    }
    if (row.id == null) {
      creating.current.add(key);
      const res = await createDemandeurAction({
        label,
        openOnSchoolHolidays: row.openOnSchoolHolidays,
      });
      creating.current.delete(key);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const newId = res.id;
      setRows((rs) => rs.map((r) => (r.key === key ? { ...r, id: newId } : r)));
      flash();
      // Modifié pendant la création ? On reprogramme une mise à jour (par id).
      const latest = rowsRef.current.find((r) => r.key === key);
      if (
        latest &&
        (latest.label.trim() !== label || latest.openOnSchoolHolidays !== row.openOnSchoolHolidays)
      ) {
        scheduleSave(key);
      }
    } else {
      const res = await updateDemandeurAction(row.id, {
        label,
        openOnSchoolHolidays: row.openOnSchoolHolidays,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      flash();
    }
  }

  function patch(key: string, p: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
    scheduleSave(key);
  }

  function add() {
    const key = `new-${counter.current++}`;
    setRows((rs) => [...rs, { id: null, label: "", openOnSchoolHolidays: true, key }]);
    setConfirmKey(null);
  }

  async function doRemove(key: string) {
    setConfirmKey(null);
    const t = timers.current.get(key);
    if (t) {
      clearTimeout(t);
      timers.current.delete(key);
    }
    const row = rowsRef.current.find((r) => r.key === key);
    if (row?.id != null) {
      const res = await deleteDemandeurAction(row.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
    }
    setRows((rs) => rs.filter((r) => r.key !== key));
    if (row?.id != null) flash();
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <section className="panel">
        <div className="panel-title" style={{ justifyContent: "space-between", gap: ".75rem" }}>
          <span style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
            <span className="dot" style={{ background: "var(--warn)" }} />
            Demandeurs
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: ".75rem" }}>
            {error ? (
              <span className="field-error" style={{ display: "inline", fontSize: ".72rem" }}>
                {error}
              </span>
            ) : (
              <span
                style={{
                  fontSize: ".72rem",
                  color: "var(--accent)",
                  opacity: savedFlash ? 1 : 0,
                  transition: "opacity .25s",
                }}
              >
                ✓ Enregistré
              </span>
            )}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={add}
              style={{ fontSize: ".7rem", padding: ".25rem .6rem" }}
            >
              ＋ Ajouter
            </button>
          </span>
        </div>

        <div style={{ marginTop: "1rem" }}>
          {/* En-têtes de colonnes (discrets) */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: GRID,
              gap: ".75rem",
              alignItems: "center",
              padding: "0 .75rem .5rem",
              fontSize: ".66rem",
              fontWeight: 600,
              letterSpacing: ".05em",
              textTransform: "uppercase",
              color: "var(--muted)",
            }}
          >
            <span>Demandeur</span>
            <span style={{ textAlign: "center" }}>Ouvert vacances scolaires</span>
            <span />
          </div>

          {rows.map((r) => {
            const confirming = confirmKey === r.key;
            return (
              <div
                key={r.key}
                className="dem-row"
                style={{
                  display: "grid",
                  gridTemplateColumns: GRID,
                  gap: ".75rem",
                  alignItems: "center",
                  padding: ".4rem .75rem",
                  borderRadius: "var(--rad-sm)",
                  borderTop: "1px solid var(--border)",
                }}
              >
                <input
                  type="text"
                  className="dem-ghost"
                  value={r.label}
                  placeholder="Nom du demandeur"
                  onChange={(e) => patch(r.key, { label: e.target.value })}
                  style={{
                    fontSize: ".85rem",
                    fontWeight: 600,
                    color: "var(--text)",
                    border: "none",
                    background: "transparent",
                    outline: "none",
                    borderRadius: "var(--rad-sm)",
                    padding: ".35rem .5rem",
                    width: "100%",
                  }}
                />

                {confirming ? (
                  <div
                    style={{
                      gridColumn: "2 / 4",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "flex-end",
                      gap: ".5rem",
                    }}
                  >
                    <span style={{ fontSize: ".76rem", color: "var(--muted)" }}>
                      Supprimer ce demandeur ?
                    </span>
                    <button
                      type="button"
                      onClick={() => void doRemove(r.key)}
                      style={{
                        border: "1px solid var(--danger)",
                        background: "transparent",
                        color: "var(--danger)",
                        borderRadius: "var(--rad-sm)",
                        fontSize: ".72rem",
                        padding: ".2rem .55rem",
                        cursor: "pointer",
                      }}
                    >
                      Supprimer
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setConfirmKey(null)}
                      style={{ fontSize: ".72rem", padding: ".2rem .55rem" }}
                    >
                      Annuler
                    </button>
                  </div>
                ) : (
                  <>
                    <span style={{ display: "flex", justifyContent: "center" }}>
                      <Switch
                        on={r.openOnSchoolHolidays}
                        onChange={(v) => patch(r.key, { openOnSchoolHolidays: v })}
                      />
                    </span>
                    <button
                      type="button"
                      className="dem-x"
                      onClick={() => setConfirmKey(r.key)}
                      title="Supprimer ce demandeur"
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--muted)",
                        fontSize: "1rem",
                        lineHeight: 1,
                        borderRadius: 6,
                        padding: ".25rem",
                        transition: "opacity .15s",
                      }}
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
            );
          })}

          {rows.length === 0 && (
            <div
              style={{
                padding: "1.5rem",
                textAlign: "center",
                fontSize: ".82rem",
                color: "var(--muted)",
                borderTop: "1px solid var(--border)",
              }}
            >
              Aucun demandeur. Cliquez sur « Ajouter ».
            </div>
          )}
        </div>
      </section>

      <style>
        {
          ".dem-row:hover{background:var(--surface2)}.dem-x{opacity:0}.dem-row:hover .dem-x{opacity:1}.dem-ghost:hover{background:var(--surface2)}.dem-ghost:focus{background:var(--surface2);box-shadow:inset 0 -2px 0 var(--accent)}"
        }
      </style>
    </div>
  );
}
