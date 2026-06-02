"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { saveThemesAction } from "./actions";

type Mode = "libre" | "liste";
type Row = { key: string; label: string };

type Props = {
  serviceId: string;
  initialMode: Mode;
  initialThemes: string[];
};

/** Signature de l'état (mode + liste) pour détecter les modifications. */
function sig(mode: Mode, labels: string[]) {
  return JSON.stringify({ mode, list: labels });
}

/**
 * Nettoyage côté client AVANT envoi : trim, suppression des vides,
 * dédoublonnage insensible à la casse en conservant l'ordre. Le serveur
 * refait le même nettoyage (défense en profondeur).
 */
function cleanLabels(labels: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of labels) {
    const label = raw.trim();
    if (label === "") continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

export function ThemesPanel({ serviceId, initialMode, initialThemes }: Props) {
  const router = useRouter();
  const counter = useRef(0);
  const fromInitial = (): Row[] => initialThemes.map((label, i) => ({ key: `db-${i}`, label }));

  const [mode, setMode] = useState<Mode>(initialMode);
  const [rows, setRows] = useState<Row[]>(fromInitial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const initialSig = useMemo(() => sig(initialMode, initialThemes), [initialMode, initialThemes]);
  // Note (fidèle au legacy) : la signature inclut la liste TELLE QUELLE (sans
  // nettoyage), même en mode « libre ». Repasser en libre ne vide pas la liste.
  const dirty =
    sig(
      mode,
      rows.map((r) => r.label),
    ) !== initialSig;

  function changeMode(next: Mode) {
    setSaved(false);
    setMode(next);
  }
  function updateRow(key: string, label: string) {
    setSaved(false);
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, label } : r)));
  }
  function addRow() {
    setSaved(false);
    setRows((rs) => [...rs, { key: `new-${counter.current++}`, label: "" }]);
  }
  function removeRow(key: string) {
    setSaved(false);
    setRows((rs) => rs.filter((r) => r.key !== key));
  }
  function cancel() {
    setError(null);
    setSaved(false);
    setMode(initialMode);
    setRows(fromInitial());
  }

  function save() {
    setError(null);
    // Le legacy persiste la liste même en mode libre (on ne l'efface pas).
    const cleaned = cleanLabels(rows.map((r) => r.label));
    startTransition(async () => {
      const res = await saveThemesAction({ serviceId, mode, themes: cleaned });
      if (res && !res.ok) {
        setError(res.error ?? "Échec de l'enregistrement.");
        return;
      }
      setRows(cleaned.map((label, i) => ({ key: `db-${i}`, label })));
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="panel">
      <div className="panel-title" style={{ justifyContent: "space-between" }}>
        <span style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
          <span className="dot" style={{ background: "var(--warn)" }} />
          Thèmes
        </span>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "2rem",
          margin: "2rem 0 1.5rem",
        }}
      >
        <label className="cycle-opt">
          <input
            type="radio"
            name="themes-mode"
            value="libre"
            checked={mode === "libre"}
            onChange={() => changeMode("libre")}
          />{" "}
          Thème libre
        </label>
        <label className="cycle-opt">
          <input
            type="radio"
            name="themes-mode"
            value="liste"
            checked={mode === "liste"}
            onChange={() => changeMode("liste")}
          />{" "}
          Liste de thèmes
        </label>
      </div>

      {mode === "liste" && (
        <div id="params-themes-list-wrap" style={{ padding: "0 1.5rem" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: ".5rem",
            }}
          >
            <span
              style={{
                fontSize: ".7rem",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: ".06em",
                color: "var(--muted)",
                padding: ".35rem .5rem",
              }}
            >
              Thème
            </span>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={addRow}
              style={{ fontSize: ".68rem", padding: ".25rem .65rem", whiteSpace: "nowrap" }}
            >
              ＋ Ajouter
            </button>
          </div>

          {rows.length > 0 ? (
            rows.map((r) => (
              <div
                key={r.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: ".4rem",
                  padding: "0 .2rem",
                }}
              >
                <input
                  type="text"
                  value={r.label}
                  placeholder="Nom du thème"
                  onChange={(e) => updateRow(r.key, e.target.value)}
                  ref={(el) => {
                    // Focus la dernière ligne ajoutée à chaud (label vide neuf).
                    if (el && r.key.startsWith("new-") && r.label === "") {
                      const wantFocus = r.key === `new-${counter.current - 1}`;
                      if (wantFocus && document.activeElement !== el) el.focus();
                    }
                  }}
                  style={{
                    flex: 1,
                    fontSize: ".85rem",
                    padding: ".25rem .35rem",
                    border: "none",
                    background: "transparent",
                    color: "var(--text)",
                    outline: "none",
                  }}
                />
                <button
                  type="button"
                  onClick={() => removeRow(r.key)}
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
              </div>
            ))
          ) : (
            <div style={{ padding: ".4rem .5rem", fontSize: ".8rem", color: "var(--muted)" }}>
              Aucun thème — cliquez sur « ＋ Ajouter » pour en créer un.
            </div>
          )}
        </div>
      )}

      <div
        style={{
          marginTop: ".75rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: ".5rem",
          padding: "0 1.5rem",
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
