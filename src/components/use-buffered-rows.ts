"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

/** Résultat des server actions de référentiel (contrat {ok,error} partagé). */
export type RefActionResult = { ok: boolean; error?: string };

/**
 * Logique « mode tampon » partagée des éditeurs de référentiels (RefEditor générique
 * ET NiveauxEditor, qui a un rendu propre — tri/édition par ligne/drag). Mutualise :
 * état des lignes à clés (`db-`/`new-`), diff create/update/delete, calcul `dirty`,
 * resync sur les données serveur (par signature JSON) après enregistrement ou refresh
 * externe, `saveAll` en lot et `cancelEdits`. Le RENDU et l'état purement UI (édition,
 * confirmation, drag) restent au composant — voir `extraDirty` et `onSyncReset`.
 */
export function useBufferedRows<
  Id extends string | number,
  Init extends { id: Id },
  Row extends { id: Id | null },
>(opts: {
  initial: Init[];
  /** Mappe une entrée serveur vers une ligne d'édition (sans `key`, ajouté en interne). */
  fromInitial: (init: Init) => Row;
  /** Validité d'une ligne (création ET mise à jour). */
  isValid: (row: Row) => boolean;
  /** La ligne diffère-t-elle de son état initial ? (déclenche un update) */
  isDirty: (row: Row, init: Init) => boolean;
  onCreate: (row: Row) => Promise<RefActionResult>;
  onUpdate: (id: Id, row: Row) => Promise<RefActionResult>;
  onDelete: (id: Id) => Promise<RefActionResult>;
  /** Condition `dirty` supplémentaire propre au composant (ex. une ligne en édition). */
  extraDirty?: boolean;
  /** Appelé quand le tampon est réinitialisé (resync/cancel/rien-à-enregistrer) : le
   *  composant y remet à zéro son état UI local (édition, confirmation, drag…). */
  onSyncReset?: () => void;
}) {
  type Keyed = Row & { key: string };
  const { initial, fromInitial, isValid, isDirty, onCreate, onUpdate, onDelete } = opts;
  const counter = useRef(0);
  const [rows, setRows] = useState<Keyed[]>(() =>
    initial.map((d) => ({ ...fromInitial(d), key: `db-${d.id}` })),
  );
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const [saving, startSaving] = useTransition();

  function patch(key: string, p: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  }
  /** Ajoute une ligne vierge (id null) et renvoie sa clé (utile pour passer en édition). */
  function addRow(blank: Row): string {
    const key = `new-${counter.current++}`;
    setRows((rs) => [...rs, { ...blank, key }]);
    return key;
  }
  function removeRow(key: string) {
    setRows((rs) => rs.filter((r) => r.key !== key));
  }
  function resetRows() {
    setRows(initial.map((d) => ({ ...fromInitial(d), key: `db-${d.id}` })));
  }

  const initialById = new Map(initial.map((d) => [d.id, d]));
  const currentIds = new Set(rows.map((r) => r.id).filter((id): id is Id => id != null));
  const dirty =
    !!opts.extraDirty ||
    rows.some((r) => r.id == null) ||
    initial.some((d) => !currentIds.has(d.id)) ||
    rows.some((r) => {
      const init = r.id != null ? initialById.get(r.id) : undefined;
      return !!init && isDirty(r, init);
    });

  // Resync sur les données serveur après un enregistrement (réconcilie les nouveaux id ⇒
  // évite une re-création au prochain save) ou lors d'un rafraîchissement externe sans
  // modification locale en cours.
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
      setError(null);
      opts.onSyncReset?.();
    }
    justSaved.current = false;
  }, [initSig]);

  /** Annule les modifications en cours (revient au tampon serveur), sans fermer la modale. */
  function cancelEdits() {
    resetRows();
    setError(null);
    opts.onSyncReset?.();
  }

  /** Applique en lot suppressions / créations / mises à jour ; laisse la modale ouverte. */
  function saveAll() {
    const toDelete = initial.filter((d) => !currentIds.has(d.id));
    const toCreate = rows.filter((r) => r.id == null && isValid(r));
    const toUpdate = rows.filter((r) => {
      if (r.id == null || !isValid(r)) return false;
      const init = initialById.get(r.id);
      return !!init && isDirty(r, init);
    });

    // Rien à enregistrer (ex. ligne vierge laissée vide) : on nettoie et on repasse en
    // lecture sans appel serveur.
    if (toDelete.length === 0 && toCreate.length === 0 && toUpdate.length === 0) {
      setRows((rs) => rs.filter((r) => r.id != null));
      opts.onSyncReset?.();
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
          const res = await onUpdate(r.id as Id, r);
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

  return {
    rows,
    setRows,
    patch,
    addRow,
    removeRow,
    resetRows,
    dirty,
    error,
    setError,
    saving,
    saveAll,
    cancelEdits,
  };
}
