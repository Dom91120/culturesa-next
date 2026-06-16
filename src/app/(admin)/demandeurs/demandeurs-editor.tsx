"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { createDemandeurAction, deleteDemandeurAction, updateDemandeurAction } from "./actions";

type Row = { id: number | null; label: string; openOnSchoolHolidays: boolean; key: string };
type Initial = { id: number; label: string; openOnSchoolHolidays: boolean };

const GRID = "1fr 190px 80px";

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

/**
 * Éditeur des demandeurs affiché dans la modale du référentiel (Administration >
 * Configuration). MODE TAMPON : les modifications restent locales jusqu'au clic sur
 * « Enregistrer » (qui applique le diff en lot) ; « Annuler » ferme sans persister.
 */
export function DemandeursEditor({
  initial,
  onClose,
}: {
  initial: Initial[];
  onClose?: () => void;
}) {
  const counter = useRef(0);
  const [rows, setRows] = useState<Row[]>(() => initial.map((d) => ({ ...d, key: `db-${d.id}` })));
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const [saving, startSaving] = useTransition();

  function patch(key: string, p: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  }

  function add() {
    const key = `new-${counter.current++}`;
    setRows((rs) => [...rs, { id: null, label: "", openOnSchoolHolidays: true, key }]);
    setConfirmKey(null);
  }

  function remove(key: string) {
    setConfirmKey(null);
    setRows((rs) => rs.filter((r) => r.key !== key));
  }

  // Applique en lot les suppressions / créations / mises à jour, puis ferme la modale.
  function saveAll() {
    const initialById = new Map(initial.map((d) => [d.id, d]));
    const currentIds = new Set(rows.map((r) => r.id).filter((id): id is number => id != null));
    const toDelete = initial.filter((d) => !currentIds.has(d.id));
    const toCreate = rows.filter((r) => r.id == null && r.label.trim() !== "");
    const toUpdate = rows.filter((r) => {
      if (r.id == null || r.label.trim() === "") return false;
      const init = initialById.get(r.id);
      return (
        !!init &&
        (init.label !== r.label.trim() || init.openOnSchoolHolidays !== r.openOnSchoolHolidays)
      );
    });

    startSaving(async () => {
      try {
        for (const d of toDelete) {
          const res = await deleteDemandeurAction(d.id);
          if (!res.ok) throw new Error(res.error);
        }
        for (const r of toCreate) {
          const res = await createDemandeurAction({
            label: r.label.trim(),
            openOnSchoolHolidays: r.openOnSchoolHolidays,
          });
          if (!res.ok) throw new Error(res.error);
        }
        for (const r of toUpdate) {
          const res = await updateDemandeurAction(r.id as number, {
            label: r.label.trim(),
            openOnSchoolHolidays: r.openOnSchoolHolidays,
          });
          if (!res.ok) throw new Error(res.error);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Échec de l'enregistrement.");
        return;
      }
      router.refresh();
      onClose?.();
    });
  }

  return (
    <div>
      {/* En-tête : statut d'erreur éventuel + bouton d'ajout (le titre est porté par la modale). */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: ".75rem",
          marginBottom: ".5rem",
        }}
      >
        {error && (
          <span className="field-error" style={{ fontSize: ".72rem" }}>
            {error}
          </span>
        )}
        <button
          type="button"
          className="btn btn-ghost"
          onClick={add}
          style={{ fontSize: ".64rem", padding: ".18rem .5rem" }}
        >
          ＋ Ajouter
        </button>
      </div>

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
        <span style={{ paddingLeft: ".5rem" }}>Demandeur</span>
        <span style={{ textAlign: "center" }}>Ouvert vacances scolaires</span>
        <span style={{ textAlign: "center" }}>Action</span>
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
                  onClick={() => remove(r.key)}
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
                  className="btn btn-ghost"
                  onClick={() => setConfirmKey(r.key)}
                  title="Supprimer ce demandeur"
                  style={{
                    fontSize: ".75rem",
                    padding: ".15rem .4rem",
                    lineHeight: 1,
                    color: "#e05555",
                    borderColor: "rgba(220,80,80,.4)",
                    justifySelf: "center",
                  }}
                >
                  🗑️
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

      {/* Mode tampon : enregistrement explicite (pas d'autosave). */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: ".6rem",
          marginTop: "1.25rem",
        }}
      >
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => onClose?.()}
          disabled={saving}
          style={{ fontSize: ".7rem", padding: ".22rem .65rem" }}
        >
          Annuler
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={saveAll}
          disabled={saving}
          style={{ fontSize: ".7rem", padding: ".22rem .75rem" }}
        >
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>

      <style>
        {
          ".dem-row:hover{background:var(--surface2)}.dem-ghost:hover{background:var(--surface2)}.dem-ghost:focus{background:var(--surface2);box-shadow:inset 0 -2px 0 var(--accent)}"
        }
      </style>
    </div>
  );
}
