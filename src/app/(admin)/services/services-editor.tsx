"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ModalOverlay } from "@/components/agenda-shared";
import { deleteServicesAction, saveServiceFromModalAction } from "./actions";
import { ICON_CATEGORIES } from "./legacy-icons";

type Initial = { id: string; label: string; icon: string | null };
type Row = { id: string | null; label: string; icon: string | null; key: string };

const GRID = "40px 1fr 80px";

/**
 * Éditeur des services (modale du référentiel, Administration > Configuration).
 * MODE TAMPON (comme Demandeurs) : modifications locales jusqu'au clic sur « Enregistrer ».
 * Édition en ligne du nom + sélecteur d'icône par ligne.
 */
export function ServicesEditor({ initial, onClose }: { initial: Initial[]; onClose?: () => void }) {
  const counter = useRef(0);
  const [rows, setRows] = useState<Row[]>(() => initial.map((s) => ({ ...s, key: `db-${s.id}` })));
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  // Ligne dont le sélecteur d'icône est ouvert (null = fermé).
  const [pickerKey, setPickerKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const [saving, startSaving] = useTransition();

  function patch(key: string, p: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  }
  function add() {
    const key = `new-${counter.current++}`;
    setRows((rs) => [...rs, { id: null, label: "", icon: null, key }]);
    setConfirmKey(null);
  }
  function remove(key: string) {
    setConfirmKey(null);
    setRows((rs) => rs.filter((r) => r.key !== key));
  }

  function resetRows() {
    setRows(initial.map((s) => ({ ...s, key: `db-${s.id}` })));
  }

  // « Modification/création en cours » : ligne nouvelle, suppression en attente ou ligne
  // (libellé/icône) modifiée. Pilote le pied : « Fermer » au repos, « Annuler /
  // Enregistrer » dès qu'il y a une modification.
  // Mémoïsés : ne dépendent que de `initial` (stable entre deux frappes) / `rows` — sinon
  // Map/Set + 3 balayages recalculés à CHAQUE frappe dans un champ.
  const initialById = useMemo(() => new Map(initial.map((s) => [s.id, s])), [initial]);
  const currentIds = useMemo(
    () => new Set(rows.map((r) => r.id).filter((id): id is string => id != null)),
    [rows],
  );
  const dirty = useMemo(
    () =>
      rows.some((r) => r.id == null) ||
      initial.some((s) => !currentIds.has(s.id)) ||
      rows.some((r) => {
        if (r.id == null) return false;
        const init = initialById.get(r.id);
        return (
          !!init && (init.label !== r.label.trim() || (init.icon ?? null) !== (r.icon ?? null))
        );
      }),
    [rows, initial, initialById, currentIds],
  );

  // Resynchronise le tampon après un enregistrement (réconcilie les nouveaux id) ou lors
  // d'un rafraîchissement externe sans modification locale en cours.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const justSaved = useRef(false);
  const initSig = useMemo(() => JSON.stringify(initial), [initial]);
  const lastSig = useRef(initSig);
  // biome-ignore lint/correctness/useExhaustiveDependencies: resync piloté par la signature des données serveur
  useEffect(() => {
    if (initSig === lastSig.current) return;
    lastSig.current = initSig;
    if (justSaved.current || !dirtyRef.current) {
      resetRows();
      setConfirmKey(null);
      setPickerKey(null);
      setError(null);
    }
    justSaved.current = false;
  }, [initSig]);

  // Annule les modifications en cours (revient au tampon serveur), sans fermer la modale.
  function cancelEdits() {
    resetRows();
    setConfirmKey(null);
    setPickerKey(null);
    setError(null);
  }

  function saveAll() {
    const toDelete = initial.filter((s) => !currentIds.has(s.id));
    const toCreate = rows.filter((r) => r.id == null && r.label.trim() !== "");
    const toUpdate = rows.filter((r) => {
      if (r.id == null || r.label.trim() === "") return false;
      const init = initialById.get(r.id);
      return !!init && (init.label !== r.label.trim() || (init.icon ?? null) !== (r.icon ?? null));
    });

    // Rien à enregistrer (ex. ligne vierge laissée vide) : on nettoie et on repasse en
    // lecture sans appel serveur.
    if (toDelete.length === 0 && toCreate.length === 0 && toUpdate.length === 0) {
      setRows((rs) => rs.filter((r) => r.id != null));
      setConfirmKey(null);
      return;
    }

    startSaving(async () => {
      try {
        for (const s of toDelete) {
          const res = await deleteServicesAction([s.id]);
          if (res && !res.ok) throw new Error(res.error ?? "Échec de la suppression.");
        }
        for (const r of toCreate) {
          const res = await saveServiceFromModalAction({ label: r.label.trim(), icon: r.icon });
          if (res && !res.ok) throw new Error(res.error ?? "Échec de la création.");
        }
        for (const r of toUpdate) {
          const res = await saveServiceFromModalAction({
            id: r.id as string,
            label: r.label.trim(),
            icon: r.icon,
          });
          if (res && !res.ok) throw new Error(res.error ?? "Échec de la mise à jour.");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Échec de l'enregistrement.");
        return;
      }
      justSaved.current = true;
      router.refresh();
    });
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: ".75rem",
          marginBottom: "0.75rem",
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

      <div
        style={{
          display: "grid",
          gridTemplateColumns: GRID,
          gap: ".75rem",
          alignItems: "center",
          padding: "0 .75rem .5rem",
          borderBottom: "1px solid var(--border)",
          fontSize: ".66rem",
          fontWeight: 600,
          letterSpacing: ".05em",
          textTransform: "uppercase",
          color: "var(--muted)",
        }}
      >
        <span style={{ textAlign: "center" }}>Icône</span>
        <span style={{ paddingLeft: ".5rem" }}>Service</span>
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
              padding: ".2rem .75rem",
              borderRadius: "var(--rad-sm)",
            }}
          >
            <button
              type="button"
              onClick={() => setPickerKey(r.key)}
              title="Choisir une icône"
              style={{
                width: 30,
                height: 30,
                fontSize: "1.1rem",
                border: "1px solid var(--border)",
                borderRadius: "var(--rad-sm)",
                background: "var(--surface2)",
                cursor: "pointer",
                justifySelf: "center",
                lineHeight: 1,
              }}
            >
              {r.icon || "🎯"}
            </button>

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
                <span style={{ fontSize: ".74rem", color: "var(--muted)" }}>
                  Supprimer ce service et toutes ses données ?
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
                <input
                  type="text"
                  className="dem-ghost"
                  value={r.label}
                  placeholder="Nom du service"
                  onChange={(e) => patch(r.key, { label: e.target.value })}
                  style={{
                    fontSize: ".8rem",
                    fontWeight: 600,
                    color: "var(--text)",
                    border: "none",
                    background: "transparent",
                    outline: "none",
                    borderRadius: "var(--rad-sm)",
                    padding: ".2rem .5rem",
                    width: "100%",
                  }}
                />
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setConfirmKey(r.key)}
                  title="Supprimer ce service"
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
          }}
        >
          Aucun service. Cliquez sur « Ajouter ».
        </div>
      )}

      {/* Pied : « Fermer » au repos ; « Annuler / Enregistrer » dès qu'une modification
          ou création est en cours. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: ".6rem",
          marginTop: "1.25rem",
        }}
      >
        {dirty ? (
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={cancelEdits}
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
          </>
        ) : (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => onClose?.()}
            disabled={saving}
            style={{ fontSize: ".7rem", padding: ".22rem .65rem" }}
          >
            Fermer
          </button>
        )}
      </div>

      {/* Sélecteur d'icône (cible la ligne `pickerKey`) : ModalOverlay partagé —
          fermeture au clic sur le fond ET à Échap (l'ancien overlay recodé à la main
          ignorait Échap, cf. audit 2026-07-17). */}
      {pickerKey !== null && (
        <ModalOverlay
          onClose={() => setPickerKey(null)}
          boxStyle={{ maxWidth: 480, width: "92%", maxHeight: "80vh", overflowY: "auto" }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "1rem",
            }}
          >
            <span style={{ fontSize: ".95rem", fontWeight: 600, color: "var(--text)" }}>
              Choisir une icône
            </span>
            <button
              type="button"
              onClick={() => setPickerKey(null)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: "1.2rem",
                color: "var(--muted)",
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>
          {ICON_CATEGORIES.map((cat) => (
            <div key={cat.label} style={{ marginBottom: ".85rem" }}>
              <div
                style={{
                  fontSize: ".62rem",
                  fontWeight: 700,
                  letterSpacing: ".1em",
                  textTransform: "uppercase",
                  color: "var(--muted)",
                  marginBottom: ".3rem",
                }}
              >
                {cat.label}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {cat.icons.map((ic) => (
                  <button
                    type="button"
                    key={ic}
                    onClick={() => {
                      patch(pickerKey, { icon: ic });
                      setPickerKey(null);
                    }}
                    style={{
                      width: 36,
                      height: 36,
                      fontSize: "1.15rem",
                      border: "2px solid transparent",
                      borderRadius: 6,
                      background: "var(--surface2)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {ic}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </ModalOverlay>
      )}

      <style>
        {
          ".dem-row:hover{background:var(--surface2)}.dem-ghost:hover{background:var(--surface2)}.dem-ghost:focus{background:var(--surface2);box-shadow:inset 0 -2px 0 var(--accent)}"
        }
      </style>
    </div>
  );
}
