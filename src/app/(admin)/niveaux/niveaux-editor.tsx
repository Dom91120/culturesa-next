"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { createNiveauAction, deleteNiveauAction, updateNiveauAction } from "./actions";

type DemandeurOption = { id: number; label: string };
type Initial = { id: number; label: string; demandeurId: number | null; position: number };
type Row = {
  id: number | null;
  label: string;
  demandeurId: number | null;
  position: number;
  key: string;
};

// Poignée · Demandeur · Position · Niveau · Action.
const GRID = "28px 180px 72px 1fr 96px";

const FIELD_STYLE = {
  fontSize: ".78rem",
  padding: ".2rem .35rem",
  borderRadius: "var(--rad-sm)",
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text)",
  width: "100%",
  boxSizing: "border-box",
} as const;

const ACTION_BTN = {
  fontSize: ".75rem",
  padding: ".15rem .4rem",
  lineHeight: 1,
} as const;

/**
 * Éditeur des niveaux scolaires (modale du référentiel, Administration > Configuration).
 * MODE TAMPON : modifications locales jusqu'au clic sur « Enregistrer ». Vue triée par
 * demandeur puis position ; lignes en LECTURE SEULE, éditables via l'icône ✏️ (demandeur,
 * niveau et position modifiables en édition). NB : modèle distinct de
 * `RefEditor` (lecture seule + bascule d'édition), comme services-editor.
 */
export function NiveauxEditor({
  initial,
  demandeurs,
  onClose,
}: {
  initial: Initial[];
  demandeurs: DemandeurOption[];
  onClose?: () => void;
}) {
  const counter = useRef(0);
  const [rows, setRows] = useState<Row[]>(() => initial.map((n) => ({ ...n, key: `db-${n.id}` })));
  const [editKey, setEditKey] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [dragAfter, setDragAfter] = useState(false); // dépôt après la ligne survolée ?
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const [saving, startSaving] = useTransition();

  const demLabel = new Map(demandeurs.map((d) => [d.id, d.label]));
  const demandeurOf = (id: number | null) => (id != null ? (demLabel.get(id) ?? "—") : "—");
  // Rang pédagogique d'un libellé de demandeur : « maternel(le) » avant « élémentaire ».
  const levelRank = (l: string) =>
    /maternel/i.test(l) ? 0 : /élémentaire|elementaire/i.test(l) ? 1 : 2;
  // Famille du demandeur = libellé sans le descripteur de niveau (regroupe p. ex.
  // « Ecole maternelle » et « Ecole élémentaire » sous « ecole »).
  const family = (l: string) =>
    l
      .toLowerCase()
      .replace(/maternel(le)?|élémentaire|elementaire/g, "")
      .replace(/\s+/g, " ")
      .trim();
  // Ordre d'affichage : par famille de demandeur, « maternelle » avant « élémentaire »,
  // puis position (ordre manuel dans le demandeur), puis libellé.
  const sortRows = (a: Row, z: Row) => {
    // Lignes non enregistrées (« + Ajouter ») toujours en fin de tableau.
    if ((a.id == null) !== (z.id == null)) return a.id == null ? 1 : -1;
    const la = demandeurOf(a.demandeurId);
    const lz = demandeurOf(z.demandeurId);
    return (
      family(la).localeCompare(family(lz)) ||
      levelRank(la) - levelRank(lz) ||
      la.localeCompare(lz) ||
      a.position - z.position ||
      a.label.localeCompare(z.label)
    );
  };

  function patch(key: string, p: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  }
  function add() {
    const key = `new-${counter.current++}`;
    setRows((rs) => [...rs, { id: null, label: "", demandeurId: null, position: 0, key }]);
    setConfirmKey(null);
    setEditKey(key); // la nouvelle ligne démarre en édition
  }
  function remove(key: string) {
    setConfirmKey(null);
    if (editKey === key) setEditKey(null);
    setRows((rs) => rs.filter((r) => r.key !== key));
  }

  // Glisser-déposer : réordonne DANS le même demandeur (ignoré sinon), puis renumérote
  // toutes les positions (1..n par demandeur) selon le nouvel ordre d'affichage.
  function reorder(sourceKey: string, targetKey: string, after: boolean) {
    setRows((rs) => {
      const src = rs.find((r) => r.key === sourceKey);
      const tgt = rs.find((r) => r.key === targetKey);
      if (!src || !tgt || src.key === tgt.key || src.demandeurId !== tgt.demandeurId) return rs;
      const order = [...rs].sort(sortRows).filter((r) => r.key !== sourceKey);
      const ti = order.findIndex((r) => r.key === targetKey);
      // Insère AVANT (curseur en moitié haute) ou APRÈS (moitié basse) la cible — `after`
      // permet d'atteindre la dernière position du demandeur (dépôt sous la dernière ligne).
      order.splice(ti + (after ? 1 : 0), 0, src);
      const counters = new Map<number, number>();
      const posByKey = new Map<string, number>();
      for (const r of order) {
        const g = r.demandeurId ?? -1;
        const n = (counters.get(g) ?? 0) + 1;
        counters.set(g, n);
        posByKey.set(r.key, n);
      }
      return rs.map((r) => ({ ...r, position: posByKey.get(r.key) ?? r.position }));
    });
  }

  function resetRows() {
    setRows(initial.map((n) => ({ ...n, key: `db-${n.id}` })));
  }

  // « Modification/création en cours » : une ligne en édition (✏️), une ligne nouvelle,
  // une suppression en attente ou une ligne (libellé/demandeur/position) modifiée. Pilote
  // le pied : « Fermer » au repos, « Annuler / Enregistrer » sinon.
  const initialById = new Map(initial.map((n) => [n.id, n]));
  const currentIds = new Set(rows.map((r) => r.id).filter((id): id is number => id != null));
  const dirty =
    editKey !== null ||
    rows.some((r) => r.id == null) ||
    initial.some((n) => !currentIds.has(n.id)) ||
    rows.some((r) => {
      if (r.id == null) return false;
      const init = initialById.get(r.id);
      return (
        !!init &&
        (init.label !== r.label.trim() ||
          init.demandeurId !== r.demandeurId ||
          init.position !== r.position)
      );
    });

  // Resynchronise le tampon après un enregistrement (réconcilie les nouveaux id) ou lors
  // d'un rafraîchissement externe sans modification locale en cours.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const justSaved = useRef(false);
  const initSig = JSON.stringify(initial);
  const lastSig = useRef(initSig);
  // biome-ignore lint/correctness/useExhaustiveDependencies: resync piloté par la signature des données serveur
  useEffect(() => {
    if (initSig === lastSig.current) return;
    lastSig.current = initSig;
    if (justSaved.current || !dirtyRef.current) {
      resetRows();
      setEditKey(null);
      setConfirmKey(null);
      setError(null);
    }
    justSaved.current = false;
  }, [initSig]);

  // Annule les modifications en cours (revient au tampon serveur), sans fermer la modale.
  function cancelEdits() {
    resetRows();
    setEditKey(null);
    setConfirmKey(null);
    setDragKey(null);
    setDragOverKey(null);
    setDragAfter(false);
    setError(null);
  }

  function saveAll() {
    const toDelete = initial.filter((n) => !currentIds.has(n.id));
    const toCreate = rows.filter((r) => r.id == null && r.label.trim() !== "");
    const toUpdate = rows.filter((r) => {
      if (r.id == null || r.label.trim() === "") return false;
      const init = initialById.get(r.id);
      return (
        !!init &&
        (init.label !== r.label.trim() ||
          init.demandeurId !== r.demandeurId ||
          init.position !== r.position)
      );
    });

    // Rien à enregistrer (ex. ligne vierge laissée vide) : on nettoie et on repasse en
    // lecture sans appel serveur.
    if (toDelete.length === 0 && toCreate.length === 0 && toUpdate.length === 0) {
      setRows((rs) => rs.filter((r) => r.id != null));
      setEditKey(null);
      setConfirmKey(null);
      return;
    }

    startSaving(async () => {
      try {
        for (const n of toDelete) {
          const res = await deleteNiveauAction(n.id);
          if (!res.ok) throw new Error(res.error);
        }
        for (const r of toCreate) {
          const res = await createNiveauAction({
            label: r.label.trim(),
            demandeurId: r.demandeurId,
            position: r.position,
          });
          if (!res.ok) throw new Error(res.error);
        }
        for (const r of toUpdate) {
          const res = await updateNiveauAction(r.id as number, {
            label: r.label.trim(),
            demandeurId: r.demandeurId,
            position: r.position,
          });
          if (!res.ok) throw new Error(res.error);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Échec de l'enregistrement.");
        return;
      }
      justSaved.current = true;
      router.refresh();
    });
  }

  // Tri d'affichage (source `rows` inchangée).
  const sorted = [...rows].sort(sortRows);

  return (
    <div>
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
        <span />
        <span style={{ paddingLeft: ".5rem" }}>Demandeur</span>
        <span style={{ textAlign: "center" }}>Position</span>
        <span>Niveau</span>
        <span style={{ textAlign: "center" }}>Action</span>
      </div>

      {sorted.map((r, i) => {
        const editing = editKey === r.key;
        const confirming = confirmKey === r.key;
        // « Après » n'a de sens que sur la DERNIÈRE ligne d'un demandeur (déposer en fin de
        // groupe) ; ailleurs, un seul interstice « avant la ligne » → pas de double zone.
        const isGroupLast = i === sorted.length - 1 || sorted[i + 1].demandeurId !== r.demandeurId;
        return (
          <div
            key={r.key}
            className="dem-row"
            onDragOver={(e) => {
              if (!dragKey || dragKey === r.key) return;
              const src = rows.find((x) => x.key === dragKey);
              if (!src || src.demandeurId !== r.demandeurId) return;
              e.preventDefault(); // autorise le dépôt (même demandeur uniquement)
              const rect = e.currentTarget.getBoundingClientRect();
              const after = isGroupLast && e.clientY > rect.top + rect.height / 2;
              if (dragOverKey !== r.key) setDragOverKey(r.key);
              if (dragAfter !== after) setDragAfter(after);
            }}
            onDragLeave={() => {
              if (dragOverKey === r.key) setDragOverKey(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragKey) {
                const rect = e.currentTarget.getBoundingClientRect();
                reorder(dragKey, r.key, isGroupLast && e.clientY > rect.top + rect.height / 2);
              }
              setDragKey(null);
              setDragOverKey(null);
            }}
            style={{
              display: "grid",
              gridTemplateColumns: GRID,
              gap: ".75rem",
              alignItems: "center",
              padding: ".4rem .75rem",
              borderRadius: "var(--rad-sm)",
              borderTop:
                dragOverKey === r.key && !dragAfter
                  ? "2px solid var(--accent)"
                  : "1px solid var(--border)",
              borderBottom:
                dragOverKey === r.key && dragAfter ? "2px solid var(--accent)" : undefined,
              opacity: dragKey === r.key ? 0.4 : 1,
            }}
          >
            {/* Poignée de déplacement (1re colonne) : drag DANS le même demandeur. */}
            <span
              draggable
              onDragStart={(e) => {
                setDragKey(r.key);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", r.key);
              }}
              onDragEnd={() => {
                setDragKey(null);
                setDragOverKey(null);
                setDragAfter(false);
              }}
              title="Déplacer (réordonner dans le demandeur)"
              aria-label="Déplacer la ligne"
              style={{
                cursor: "grab",
                fontSize: ".95rem",
                color: "var(--muted)",
                userSelect: "none",
                lineHeight: 1,
                justifySelf: "center",
              }}
            >
              ⠿
            </span>
            {/* Demandeur : modifiable en mode édition (✏️) ; texte en lecture seule sinon. */}
            {editing ? (
              <select
                value={r.demandeurId ?? ""}
                onChange={(e) =>
                  patch(r.key, {
                    demandeurId: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                style={FIELD_STYLE}
              >
                <option value="">— aucun —</option>
                {demandeurs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            ) : (
              <span style={{ fontSize: ".82rem", paddingLeft: ".5rem", color: "var(--text)" }}>
                {demandeurOf(r.demandeurId)}
              </span>
            )}

            {confirming ? (
              <div
                style={{
                  gridColumn: "3 / 6",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  gap: ".5rem",
                }}
              >
                <span style={{ fontSize: ".74rem", color: "var(--muted)" }}>
                  Supprimer ce niveau ?
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
                {/* Position */}
                {editing ? (
                  <input
                    type="number"
                    min={0}
                    value={r.position}
                    onChange={(e) =>
                      patch(r.key, { position: Math.max(0, Number(e.target.value) || 0) })
                    }
                    style={{ ...FIELD_STYLE, textAlign: "center" }}
                  />
                ) : (
                  <span style={{ textAlign: "center", fontSize: ".82rem", color: "var(--muted)" }}>
                    {r.position}
                  </span>
                )}

                {/* Niveau */}
                {editing ? (
                  <input
                    type="text"
                    value={r.label}
                    placeholder="Nom du niveau"
                    // biome-ignore lint/a11y/noAutofocus: focus le champ à l'ouverture de l'édition
                    autoFocus
                    onChange={(e) => patch(r.key, { label: e.target.value })}
                    style={FIELD_STYLE}
                  />
                ) : (
                  <span style={{ fontSize: ".85rem", fontWeight: 600, color: "var(--text)" }}>
                    {r.label || <span style={{ color: "var(--muted)" }}>(sans nom)</span>}
                  </span>
                )}

                {/* Action : éditer/terminer + supprimer */}
                <div style={{ display: "flex", justifyContent: "center", gap: ".25rem" }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setEditKey(editing ? null : r.key)}
                    title={editing ? "Terminer l'édition" : "Modifier ce niveau"}
                    aria-label={editing ? "Terminer l'édition" : "Modifier ce niveau"}
                    style={ACTION_BTN}
                  >
                    {editing ? "✓" : "✏️"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setConfirmKey(r.key)}
                    title="Supprimer ce niveau"
                    aria-label="Supprimer ce niveau"
                    style={{
                      ...ACTION_BTN,
                      color: "#e05555",
                      borderColor: "rgba(220,80,80,.4)",
                    }}
                  >
                    🗑️
                  </button>
                </div>
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
          Aucun niveau. Cliquez sur « Ajouter ».
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

      <style>{".dem-row:hover{background:var(--surface2)}"}</style>
    </div>
  );
}
