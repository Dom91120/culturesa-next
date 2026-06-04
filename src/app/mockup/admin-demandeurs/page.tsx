"use client";

// ⚠️ MAQUETTE DESIGN (jetable) — route isolée /mockup/admin-demandeurs.
// Données factices, aucune action serveur. Refonte de Administration > Demandeurs :
// liste épurée (ghost-input + interrupteur), autosave, suppression confirmée inline.
// À supprimer une fois la direction tranchée.

import { useEffect, useRef, useState } from "react";

// ── Primitive : interrupteur fin (30×16) ─────────────────────────────────────
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

// ── Données factices ─────────────────────────────────────────────────────────
type Row = { key: string; label: string; vac: boolean };
const INITIAL: Row[] = [
  { key: "d1", label: "Maternelle", vac: true },
  { key: "d2", label: "Élémentaire", vac: false },
  { key: "d3", label: "Assistante maternelle", vac: true },
  { key: "d4", label: "Loisirs ados", vac: false },
];

const GRID = "1fr 190px 32px";

export default function MockupAdminDemandeurs() {
  const counter = useRef(0);
  const [rows, setRows] = useState<Row[]>(INITIAL);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);

  // Autosave (simulé) : flash de confirmation à la pause de frappe / au changement.
  const [savedFlash, setSavedFlash] = useState(false);
  const flashTimer = useRef<number | null>(null);
  const firstRender = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: effet "fire-on-change" sur rows (flash débouncé)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const h = window.setTimeout(() => {
      setSavedFlash(true);
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setSavedFlash(false), 1500);
    }, 550);
    return () => window.clearTimeout(h);
  }, [rows]);

  function patch(key: string, p: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  }
  function add() {
    const key = `new-${counter.current++}`;
    setRows((rs) => [...rs, { key, label: "", vac: true }]);
  }
  function doRemove(key: string) {
    setRows((rs) => rs.filter((r) => r.key !== key));
    setConfirmKey(null);
  }

  return (
    <div style={{ maxWidth: 720, margin: "2rem auto", padding: "0 1rem" }}>
      <div
        style={{
          fontSize: ".7rem",
          color: "var(--warn)",
          fontWeight: 700,
          letterSpacing: ".04em",
          textTransform: "uppercase",
          marginBottom: "1rem",
        }}
      >
        ⚠ Maquette design — non branchée
      </div>

      <section className="panel">
        <div className="panel-title" style={{ justifyContent: "space-between", gap: ".75rem" }}>
          <span style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
            <span className="dot" style={{ background: "var(--warn)" }} />
            Demandeurs
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: ".75rem" }}>
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
          {/* En-têtes de colonnes (discrets, une seule fois) */}
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
                className="mockup-row"
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
                  className="mockup-ghost"
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
                      onClick={() => doRemove(r.key)}
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
                      <Switch on={r.vac} onChange={(v) => patch(r.key, { vac: v })} />
                    </span>
                    <button
                      type="button"
                      className="mockup-x"
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
          ".mockup-row:hover{background:var(--surface2)}.mockup-x{opacity:0}.mockup-row:hover .mockup-x{opacity:1}.mockup-ghost:hover{background:var(--surface2)}.mockup-ghost:focus{background:var(--surface2);box-shadow:inset 0 -2px 0 var(--accent)}"
        }
      </style>
    </div>
  );
}
