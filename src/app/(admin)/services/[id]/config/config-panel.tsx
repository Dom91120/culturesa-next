"use client";

// Onglet « Configuration » : réglages globaux + matrice demandeurs (AUTOSAVE) et
// thèmes (barre de sauvegarde dédiée). Branché aux actions des onglets Demandeurs
// et Thèmes. La refonte « globaux + par-demandeur » se reprojette sur la matrice
// service × demandeur en respectant les règles de synchro (semaineAb uniforme entre
// récurrents, jauge uniforme par mode).

import { useEffect, useRef, useState, useTransition } from "react";
import { Switch } from "@/components/switch";
import type { DemandeurSettingRow } from "@/server/services/demandeur-settings";
import { saveDemandeurSettingsAction } from "../demandeurs/actions";
import { saveThemesAction } from "../themes/actions";
import { setGaugeAccompagnantsAction } from "./actions";

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        border: "1px solid var(--border)",
        borderRadius: 99,
        background: "var(--surface2)",
        padding: 1,
        gap: 2,
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            style={{
              border: "none",
              borderRadius: 99,
              padding: ".18rem .65rem",
              fontSize: ".7rem",
              lineHeight: 1,
              fontWeight: active ? 600 : 500,
              cursor: "pointer",
              background: active ? "var(--accent)" : "transparent",
              color: active ? "#0f1117" : "var(--muted)",
              transition: "background .15s, color .15s",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Types & helpers ──────────────────────────────────────────────────────────

type Mode = "recurrent" | "ponctuel";
type ThemeMode = "libre" | "liste";
type DemandeurOption = { id: number; label: string };
type DemRow = {
  key: string;
  demandeurId: number;
  mode: Mode;
  validation: boolean;
  themes: boolean;
};
type ThemeRow = { key: string; label: string };

type Props = {
  serviceId: string;
  allDemandeurs: DemandeurOption[];
  initialRows: DemandeurSettingRow[];
  initialThemeMode: ThemeMode;
  initialThemes: string[];
  initialGaugeAccompagnants: boolean;
};

/** Reprojette l'état (globaux + par-demandeur) vers la matrice service × demandeur. */
function buildMatrix(
  rows: DemRow[],
  semaineAb: boolean,
  jaugeRec: boolean,
  jaugePonct: boolean,
): DemandeurSettingRow[] {
  return rows
    .filter((r) => r.demandeurId > 0)
    .map((r) => {
      const recurrent = r.mode === "recurrent";
      return {
        demandeurId: r.demandeurId,
        recurrent,
        semaineAb: recurrent && semaineAb,
        validation: r.validation,
        themes: r.themes,
        jauge: recurrent ? jaugeRec : jaugePonct,
      };
    });
}

/** Signature stable (triée) d'une matrice, pour détecter un vrai changement. */
function matrixSig(m: DemandeurSettingRow[]): string {
  return JSON.stringify([...m].sort((a, b) => a.demandeurId - b.demandeurId));
}

/** Nettoyage des libellés de thèmes (trim, vides, dédoublonnage casse-insensible). */
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

// ── Panneau ──────────────────────────────────────────────────────────────────

/** Style des 3 sous-panels (fond --surface2) imbriqués dans le panel conteneur
 *  (--surface1, via .panel). Hiérarchie : page(--surface) < conteneur < sous-panels. */
const SUB_PANEL: React.CSSProperties = {
  background: "var(--surface2)",
  border: "1px solid var(--border)",
  borderRadius: "var(--rad-sm)",
  padding: "1.25rem",
};

export function ConfigPanel({
  serviceId,
  allDemandeurs,
  initialRows,
  initialThemeMode,
  initialThemes,
  initialGaugeAccompagnants,
}: Props) {
  const counter = useRef(0);

  // Réglage service-global « prise en compte des accompagnants dans la jauge ».
  // Persistance immédiate (dédiée, indépendante de la matrice demandeurs).
  const [gaugeAccompagnants, setGaugeAccompagnants] = useState(initialGaugeAccompagnants);
  const [, startGaugeAcc] = useTransition();
  function toggleGaugeAccompagnants(v: boolean) {
    setGaugeAccompagnants(v);
    startGaugeAcc(async () => {
      await setGaugeAccompagnantsAction(serviceId, v);
    });
  }

  // Réglages globaux dérivés de la matrice initiale (cohérence inter-lignes).
  const [semaineAb, setSemaineAb] = useState(() =>
    initialRows.some((r) => r.recurrent && r.semaineAb),
  );
  const [jaugeRec, setJaugeRec] = useState(() => initialRows.some((r) => r.recurrent && r.jauge));
  const [jaugePonct, setJaugePonct] = useState(() =>
    initialRows.some((r) => !r.recurrent && r.jauge),
  );
  const [rows, setRows] = useState<DemRow[]>(() =>
    initialRows.map((r, i) => ({
      key: `db-${i}`,
      demandeurId: r.demandeurId,
      mode: r.recurrent ? "recurrent" : "ponctuel",
      validation: r.validation,
      themes: r.themes,
    })),
  );

  // Autosave Demandeurs + Globaux (débounce). Signature de la dernière sauvegarde.
  const lastSavedSig = useRef(matrixSig(buildMatrix(rows, semaineAb, jaugeRec, jaugePonct)));
  const [savedFlash, setSavedFlash] = useState(false);
  const flashTimer = useRef<number | null>(null);
  const [demError, setDemError] = useState<string | null>(null);
  const [demPending, startSaveDem] = useTransition();
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const payload = buildMatrix(rows, semaineAb, jaugeRec, jaugePonct);
    const sig = matrixSig(payload);
    if (sig === lastSavedSig.current) return; // rien de neuf à persister
    const handle = window.setTimeout(() => {
      startSaveDem(async () => {
        const res = await saveDemandeurSettingsAction({ serviceId, rows: payload });
        if (res && !res.ok) {
          setDemError(res.error ?? "Échec de l'enregistrement.");
          return;
        }
        lastSavedSig.current = sig;
        setDemError(null);
        setSavedFlash(true);
        if (flashTimer.current) window.clearTimeout(flashTimer.current);
        flashTimer.current = window.setTimeout(() => setSavedFlash(false), 1600);
      });
    }, 450);
    return () => window.clearTimeout(handle);
  }, [rows, semaineAb, jaugeRec, jaugePonct, serviceId]);

  // Thèmes : barre de sauvegarde explicite (base « enregistrée » mutable).
  const [themeMode, setThemeMode] = useState<ThemeMode>(initialThemeMode);
  const [themes, setThemes] = useState<ThemeRow[]>(() =>
    initialThemes.map((label, i) => ({ key: `db-${i}`, label })),
  );
  const [savedThemeMode, setSavedThemeMode] = useState<ThemeMode>(initialThemeMode);
  const [savedThemes, setSavedThemes] = useState<string[]>(initialThemes);
  const [themesError, setThemesError] = useState<string | null>(null);
  const [themesPending, startThemes] = useTransition();
  const nextThemeId = () => `new-${counter.current++}`;
  const themesDirty =
    JSON.stringify([themeMode, themes.map((t) => t.label)]) !==
    JSON.stringify([savedThemeMode, savedThemes]);

  function saveThemes() {
    const cleaned = cleanLabels(themes.map((t) => t.label));
    startThemes(async () => {
      const res = await saveThemesAction({ serviceId, mode: themeMode, themes: cleaned });
      if (res && !res.ok) {
        setThemesError(res.error ?? "Échec de l'enregistrement.");
        return;
      }
      setThemesError(null);
      setSavedThemeMode(themeMode);
      setSavedThemes(cleaned);
      setThemes(cleaned.map((label, i) => ({ key: `db-${i}`, label })));
    });
  }
  function cancelThemes() {
    setThemesError(null);
    setThemeMode(savedThemeMode);
    setThemes(savedThemes.map((label, i) => ({ key: `db-${i}`, label })));
  }

  // ── Demandeurs : helpers ──
  const usedIds = new Set(rows.map((r) => r.demandeurId).filter((id) => id > 0));
  const available = allDemandeurs.filter((d) => !usedIds.has(d.id));
  const hasRecurrent = rows.some((r) => r.demandeurId > 0 && r.mode === "recurrent");
  const labelFor = (id: number) => allDemandeurs.find((d) => d.id === id)?.label ?? "";

  function patch(key: string, p: Partial<DemRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  }
  function removeRow(key: string) {
    setRows((rs) => rs.filter((r) => r.key !== key));
  }
  function addRow() {
    setRows((rs) => [
      ...rs,
      {
        key: `new-${counter.current++}`,
        demandeurId: 0,
        mode: "ponctuel",
        validation: false,
        themes: false,
      },
    ]);
  }

  return (
    <section className="panel">
      {/* En-tête du panel conteneur : statut autosave (Globaux + Demandeurs) à droite. */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          minHeight: 18,
          marginBottom: ".75rem",
        }}
      >
        <span
          style={{
            fontSize: ".72rem",
            transition: "opacity .25s",
            opacity: demError || demPending || savedFlash ? 1 : 0,
            color: demError ? "var(--danger)" : "var(--accent)",
          }}
        >
          {demError ? demError : demPending ? "Enregistrement…" : "✓ Enregistré"}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: ".85rem" }}>
        {/* ─ Réglages globaux (autosave) ─ */}
        <section style={SUB_PANEL}>
          <div className="panel-title" style={{ marginBottom: ".25rem" }}>
            <span className="dot" style={{ background: "var(--warn)" }} />
            Paramètres globaux du service
          </div>
          <p style={{ fontSize: ".75rem", color: "var(--muted)", margin: "0 0 1rem" }}>
            S'appliquent à tous les demandeurs du même mode. Enregistrement automatique.
          </p>

          <GlobalRow
            label="Alternance Semaine A / B"
            desc={
              hasRecurrent
                ? "Les créneaux récurrents alternent une semaine A et une semaine B."
                : "Sans effet : aucun demandeur récurrent pour l'instant."
            }
          >
            <Switch on={semaineAb} disabled={!hasRecurrent} onChange={setSemaineAb} />
          </GlobalRow>
          <GlobalRow
            label="Jauge — créneaux récurrents"
            desc="Affiche une jauge de places sur les créneaux récurrents."
          >
            <Switch on={jaugeRec} onChange={setJaugeRec} />
          </GlobalRow>
          <GlobalRow
            label="Jauge — créneaux ponctuels"
            desc="Affiche une jauge de places sur les créneaux ponctuels."
          >
            <Switch on={jaugePonct} onChange={setJaugePonct} />
          </GlobalRow>
          <GlobalRow
            label="Jauge — prise en compte des accompagnants"
            desc={
              jaugeRec || jaugePonct
                ? "Prendre en compte les accompagnants dans le calcul de la jauge."
                : "Sans effet : aucune jauge active pour ce service."
            }
            last
          >
            <Switch
              on={gaugeAccompagnants}
              disabled={!(jaugeRec || jaugePonct)}
              onChange={toggleGaugeAccompagnants}
            />
          </GlobalRow>
        </section>

        {/* ─ Demandeurs (autosave) ─ */}
        <section style={SUB_PANEL}>
          <div className="panel-title" style={{ justifyContent: "space-between" }}>
            <span style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
              <span className="dot" style={{ background: "var(--warn)" }} />
              Demandeurs
            </span>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={addRow}
              disabled={available.length === 0}
              style={{ fontSize: ".66rem", padding: ".2rem .5rem" }}
            >
              ＋ Ajouter un demandeur
            </button>
          </div>

          <div style={{ marginTop: "1rem" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 180px 84px 84px 32px",
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
              <span style={{ textAlign: "center" }}>Mode</span>
              <span style={{ textAlign: "center" }}>Validation</span>
              <span style={{ textAlign: "center" }}>Thèmes</span>
              <span />
            </div>

            {rows.map((r) => (
              <div
                key={r.key}
                className="mockup-row"
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 180px 84px 84px 32px",
                  gap: ".75rem",
                  alignItems: "center",
                  padding: ".55rem .75rem",
                  borderRadius: "var(--rad-sm)",
                  borderTop: "1px solid var(--border)",
                }}
              >
                {r.demandeurId > 0 ? (
                  <span style={{ fontSize: ".85rem", fontWeight: 600, color: "var(--text)" }}>
                    {labelFor(r.demandeurId)}
                  </span>
                ) : (
                  <select
                    value=""
                    onChange={(e) =>
                      patch(r.key, { demandeurId: Number.parseInt(e.target.value, 10) || 0 })
                    }
                    style={{
                      width: "50%",
                      fontSize: ".82rem",
                      padding: ".25rem .4rem",
                      background: "var(--surface2)",
                      color: "var(--text)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--rad-sm)",
                    }}
                  >
                    <option value="">— Choisir un demandeur —</option>
                    {available.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                )}
                <span style={{ display: "flex", justifyContent: "center" }}>
                  <Segmented
                    value={r.mode}
                    onChange={(v) => patch(r.key, { mode: v })}
                    options={[
                      { value: "recurrent", label: "Récurrent" },
                      { value: "ponctuel", label: "Ponctuel" },
                    ]}
                  />
                </span>
                <span style={{ display: "flex", justifyContent: "center" }}>
                  <Switch on={r.validation} onChange={(v) => patch(r.key, { validation: v })} />
                </span>
                <span style={{ display: "flex", justifyContent: "center" }}>
                  <Switch on={r.themes} onChange={(v) => patch(r.key, { themes: v })} />
                </span>
                <button
                  type="button"
                  className="mockup-x"
                  onClick={() => removeRow(r.key)}
                  title="Retirer ce demandeur"
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
              </div>
            ))}

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
                Aucun demandeur configuré. Cliquez sur « Ajouter un demandeur ».
              </div>
            )}
          </div>
        </section>

        {/* ─ Thèmes (barre de sauvegarde dédiée) ─ */}
        <section style={SUB_PANEL}>
          <div className="panel-title" style={{ justifyContent: "space-between" }}>
            <span style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
              <span className="dot" style={{ background: "var(--warn)" }} />
              Thèmes
            </span>
            {themeMode === "liste" && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setThemes((ts) => [...ts, { key: nextThemeId(), label: "" }])}
                style={{ fontSize: ".66rem", padding: ".2rem .5rem" }}
              >
                ＋ Ajouter un thème
              </button>
            )}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "1.5rem",
              flexWrap: "wrap",
              margin: "1rem 0 .25rem",
            }}
          >
            {(
              [
                ["libre", "Thème libre"],
                ["liste", "Liste de thèmes"],
              ] as [ThemeMode, string][]
            ).map(([value, label]) => (
              <label
                key={value}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: ".45rem",
                  cursor: "pointer",
                  fontSize: ".85rem",
                  fontWeight: 400,
                  color: "var(--text)",
                  textTransform: "none",
                  letterSpacing: "normal",
                }}
              >
                <input
                  type="radio"
                  name="theme-mode"
                  checked={themeMode === value}
                  onChange={() => setThemeMode(value)}
                  style={{ accentColor: "var(--accent)" }}
                />
                {label}
              </label>
            ))}
            <span style={{ fontSize: ".74rem", color: "var(--muted)" }}>
              {themeMode === "libre"
                ? "L'usager saisit un thème de son choix."
                : "L'usager choisit parmi une liste prédéfinie."}
            </span>
          </div>

          {themeMode === "liste" && (
            <div style={{ marginTop: ".75rem" }}>
              {themes.map((t) => (
                <div
                  key={t.key}
                  className="mockup-row"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: ".5rem",
                    borderRadius: "var(--rad-sm)",
                  }}
                >
                  <input
                    type="text"
                    className="mockup-theme-input"
                    value={t.label}
                    placeholder="Nom du thème"
                    onChange={(e) =>
                      setThemes((ts) =>
                        ts.map((x) => (x.key === t.key ? { ...x, label: e.target.value } : x)),
                      )
                    }
                    style={{
                      flex: 1,
                      fontSize: ".85rem",
                      padding: ".25rem .75rem",
                      border: "none",
                      background: "transparent",
                      color: "var(--text)",
                      outline: "none",
                      borderRadius: "var(--rad-sm)",
                      transition: "background .15s, box-shadow .15s",
                    }}
                  />
                  <button
                    type="button"
                    className="mockup-x"
                    onClick={() => setThemes((ts) => ts.filter((x) => x.key !== t.key))}
                    title="Supprimer ce thème"
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--muted)",
                      fontSize: "1rem",
                      lineHeight: 1,
                      borderRadius: 6,
                      padding: ".3rem",
                      marginRight: ".4rem",
                      flexShrink: 0,
                      transition: "opacity .15s",
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}

              {themes.length === 0 && (
                <div style={{ padding: ".6rem .75rem", fontSize: ".8rem", color: "var(--muted)" }}>
                  Aucun thème — utilisez « ＋ Ajouter un thème ».
                </div>
              )}
            </div>
          )}

          {/* Barre de sauvegarde — Thèmes uniquement, toujours visible. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: ".6rem",
              marginTop: ".9rem",
            }}
          >
            <span
              style={{
                fontSize: ".78rem",
                color: themesError ? "var(--danger)" : themesDirty ? "var(--warn)" : "var(--muted)",
              }}
            >
              {themesError
                ? themesError
                : themesDirty
                  ? "Modifications non enregistrées"
                  : "À jour"}
            </span>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={cancelThemes}
              disabled={!themesDirty || themesPending}
              style={{
                fontSize: ".75rem",
                padding: ".3rem .8rem",
                opacity: themesDirty && !themesPending ? 1 : 0.4,
                cursor: themesDirty && !themesPending ? "pointer" : "not-allowed",
              }}
            >
              Annuler
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={saveThemes}
              disabled={!themesDirty || themesPending}
              style={{
                fontSize: ".75rem",
                padding: ".3rem .9rem",
                opacity: themesDirty && !themesPending ? 1 : 0.4,
                cursor: themesDirty && !themesPending ? "pointer" : "not-allowed",
              }}
            >
              {themesPending ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </section>
      </div>

      <style>
        {
          ".mockup-row:hover{background:var(--surface3)}.mockup-x{opacity:0}.mockup-row:hover .mockup-x{opacity:1}.mockup-theme-input:hover{background:var(--surface3)}.mockup-theme-input:focus{background:var(--surface3);box-shadow:inset 0 -2px 0 var(--accent)}"
        }
      </style>
    </section>
  );
}

function GlobalRow({
  label,
  desc,
  last,
  children,
}: {
  label: string;
  desc: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        padding: ".75rem 0",
        borderBottom: last ? "none" : "1px solid var(--border)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: ".85rem", fontWeight: 600, color: "var(--text)" }}>{label}</div>
        <div style={{ fontSize: ".74rem", color: "var(--muted)", marginTop: ".15rem" }}>{desc}</div>
      </div>
      {children}
    </div>
  );
}
