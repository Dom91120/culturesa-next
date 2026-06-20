"use client";

import { useRouter } from "next/navigation";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";

/** Résultat des server actions de référentiel (contrat {ok,error} partagé). */
export type RefActionResult = { ok: boolean; error?: string };

type RowBase = { id: number | null; label: string };

/**
 * Éditeur CRUD générique « en mode tampon » des référentiels à id numérique
 * (demandeurs / structures / niveaux). Mutualise état, diff create/update/delete,
 * en-tête, ligne + confirmation de suppression, pied Annuler/Enregistrer et styles
 * (audit R1). La 1re colonne est toujours le libellé (input texte) ; les colonnes
 * intermédiaires sont fournies par `renderExtraCells`. NB : services-editor reste à
 * part (id texte + icône en 1re colonne + sélecteur d'icône → modèle divergent).
 */
export function RefEditor<Init extends { id: number; label: string }, Row extends RowBase>({
  initial,
  fromInitial,
  blankRow,
  gridTemplate,
  labels,
  extraHeaders,
  renderExtraCells,
  isValid = (r) => r.label.trim() !== "",
  isDirty,
  onCreate,
  onUpdate,
  onDelete,
  confirmExtra,
  addDisabled = false,
  onClose,
}: {
  initial: Init[];
  /** Mappe une entrée initiale vers une ligne d'édition (sans `key`, ajouté en interne). */
  fromInitial: (init: Init) => Row;
  /** Ligne vierge pour « Ajouter » (id null + valeurs par défaut, sans `key`). */
  blankRow: () => Row;
  gridTemplate: string;
  labels: {
    /** Placeholder de l'input libellé, ex. « Nom du demandeur ». */
    placeholder: string;
    /** En-tête de la colonne libellé, ex. « Demandeur ». */
    header: ReactNode;
    /** Message de confirmation de suppression, ex. « Supprimer ce demandeur ? ». */
    confirm: string;
    /** `title` du bouton corbeille, ex. « Supprimer ce demandeur ». */
    deleteTitle: string;
    /** Texte d'état vide, ex. « Aucun demandeur. Cliquez sur « Ajouter ». ». */
    empty: string;
  };
  /** En-têtes des colonnes intermédiaires (entre libellé et Action). */
  extraHeaders: { label: ReactNode; style?: CSSProperties }[];
  /** Cellules intermédiaires d'une ligne (mode normal). */
  renderExtraCells: (
    row: Row & { key: string },
    patch: (key: string, p: Partial<Row>) => void,
  ) => ReactNode;
  /** Validité d'une ligne (création ET mise à jour). Défaut : libellé non vide. */
  isValid?: (row: Row) => boolean;
  /** La ligne diffère-t-elle de son état initial ? (déclenche un update) */
  isDirty: (row: Row, init: Init) => boolean;
  onCreate: (row: Row) => Promise<RefActionResult>;
  onUpdate: (id: number, row: Row) => Promise<RefActionResult>;
  onDelete: (id: number) => Promise<RefActionResult>;
  /** Détail optionnel ajouté au message de confirmation (ex. usagers détachés). */
  confirmExtra?: (row: Row) => ReactNode;
  addDisabled?: boolean;
  onClose?: () => void;
}) {
  type Keyed = Row & { key: string };
  const counter = useRef(0);
  const [rows, setRows] = useState<Keyed[]>(() =>
    initial.map((d) => ({ ...fromInitial(d), key: `db-${d.id}` })),
  );
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const [saving, startSaving] = useTransition();

  function patch(key: string, p: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  }
  function add() {
    const key = `new-${counter.current++}`;
    setRows((rs) => [...rs, { ...blankRow(), key }]);
    setConfirmKey(null);
  }
  function remove(key: string) {
    setConfirmKey(null);
    setRows((rs) => rs.filter((r) => r.key !== key));
  }

  // Réinitialise le tampon sur l'état serveur courant.
  function resetRows() {
    setRows(initial.map((d) => ({ ...fromInitial(d), key: `db-${d.id}` })));
  }

  // « Modification/création en cours » : une ligne nouvelle, une suppression en attente
  // ou une ligne modifiée par rapport à l'état initial. Pilote l'affichage du pied :
  // « Fermer » au repos, « Annuler / Enregistrer » dès qu'il y a une modification.
  const initialById = new Map(initial.map((d) => [d.id, d]));
  const currentIds = new Set(rows.map((r) => r.id).filter((id): id is number => id != null));
  const dirty =
    rows.some((r) => r.id == null) ||
    initial.some((d) => !currentIds.has(d.id)) ||
    rows.some((r) => {
      const init = r.id != null ? initialById.get(r.id) : undefined;
      return !!init && isDirty(r, init);
    });

  // Resynchronise le tampon sur les données serveur après un enregistrement
  // (réconcilie les nouveaux id ⇒ évite une re-création au prochain save) ou lors d'un
  // rafraîchissement externe sans modification locale en cours.
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
      setConfirmKey(null);
      setError(null);
    }
    justSaved.current = false;
  }, [initSig]);

  // Annule les modifications en cours (revient au tampon serveur), sans fermer la modale.
  function cancelEdits() {
    resetRows();
    setConfirmKey(null);
    setError(null);
  }

  // Applique en lot suppressions / créations / mises à jour, puis laisse la modale ouverte
  // (le pied repasse sur « Fermer » une fois le tampon resynchronisé).
  function saveAll() {
    const toDelete = initial.filter((d) => !currentIds.has(d.id));
    const toCreate = rows.filter((r) => r.id == null && isValid(r));
    const toUpdate = rows.filter((r) => {
      if (r.id == null || !isValid(r)) return false;
      const init = initialById.get(r.id);
      return !!init && isDirty(r, init);
    });

    // Rien à enregistrer (ex. ligne vierge ajoutée puis laissée vide) : on nettoie le
    // tampon et on repasse en lecture sans appel serveur.
    if (toDelete.length === 0 && toCreate.length === 0 && toUpdate.length === 0) {
      setRows((rs) => rs.filter((r) => r.id != null));
      setConfirmKey(null);
      return;
    }

    startSaving(async () => {
      try {
        for (const d of toDelete) {
          const res = await onDelete(d.id);
          if (!res.ok) throw new Error(res.error);
        }
        for (const r of toCreate) {
          const res = await onCreate(r);
          if (!res.ok) throw new Error(res.error);
        }
        for (const r of toUpdate) {
          const res = await onUpdate(r.id as number, r);
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

  // Confirmation : la cellule s'étend du libellé+1 jusqu'à la fin (colonnes = libellé
  // + intermédiaires + action). gridColumn 1-based, fin exclusive ⇒ extraHeaders+3.
  const confirmSpanEnd = extraHeaders.length + 3;

  return (
    <div>
      {/* En-tête : erreur éventuelle + bouton d'ajout (le titre est porté par la modale). */}
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
          disabled={addDisabled}
          style={{ fontSize: ".64rem", padding: ".18rem .5rem" }}
        >
          ＋ Ajouter
        </button>
      </div>

      {/* En-têtes de colonnes (discrets) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: gridTemplate,
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
        <span style={{ paddingLeft: ".5rem" }}>{labels.header}</span>
        {extraHeaders.map((h, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: en-têtes statiques
          <span key={i} style={h.style}>
            {h.label}
          </span>
        ))}
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
              gridTemplateColumns: gridTemplate,
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
              placeholder={labels.placeholder}
              onChange={(e) => patch(r.key, { label: e.target.value } as Partial<Row>)}
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
                  gridColumn: `2 / ${confirmSpanEnd}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  gap: ".5rem",
                }}
              >
                <span style={{ fontSize: ".74rem", color: "var(--muted)" }}>
                  {labels.confirm}
                  {confirmExtra?.(r)}
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
                {renderExtraCells(r, patch)}
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setConfirmKey(r.key)}
                  title={labels.deleteTitle}
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
          {labels.empty}
        </div>
      )}

      {/* Pied : « Fermer » au repos ; « Annuler / Enregistrer » dès qu'une modification
          ou création est en cours (mode tampon, enregistrement explicite). */}
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

      <style>
        {
          ".dem-row:hover{background:var(--surface2)}.dem-ghost:hover{background:var(--surface2)}.dem-ghost:focus{background:var(--surface2);box-shadow:inset 0 -2px 0 var(--accent)}"
        }
      </style>
    </div>
  );
}
