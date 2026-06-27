"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { TimeStepper } from "@/components/time-stepper";
import {
  createExerciceAction,
  createPeriodAction,
  deleteExerciceAction,
  deletePeriodAction,
  reactivatePeriodsAction,
  saveOpeningConfigAction,
  updateExerciceAction,
  updatePeriodAction,
} from "./actions";

type ExerciceType = "civile" | "scolaire";

type PeriodState = "actif" | "desactive" | "archive";

export type UiPeriod = {
  id: number;
  label: string;
  etiquette: string | null;
  dateStart: string; // "YYYY-MM-DD" ou ""
  dateEnd: string;
  color: string;
  state: PeriodState;
  exerciceId: number | null;
};

type Exercice = {
  id: number;
  label: string;
  type: ExerciceType;
  dateStart: string; // "YYYY-MM-DD" ou ""
  dateEnd: string;
};

type Opening = {
  activeDays: string[];
  openOnHolidays: boolean;
  openOnSchoolHolidays: boolean;
  morningStart: string;
  morningEnd: string;
  afternoonStart: string;
  afternoonEnd: string;
};

type Props = {
  serviceId: string;
  initialPeriods: UiPeriod[];
  exercices: Exercice[];
  opening: Opening;
};

// Ordre + libellés des jours (legacy : ALL_DKEYS / ALL_DAYS).
const DAYS: { key: string; label: string; full: string }[] = [
  { key: "lun", label: "Lun", full: "Lundi" },
  { key: "mar", label: "Mar", full: "Mardi" },
  { key: "mer", label: "Mer", full: "Mercredi" },
  { key: "jeu", label: "Jeu", full: "Jeudi" },
  { key: "ven", label: "Ven", full: "Vendredi" },
  { key: "sam", label: "Sam", full: "Samedi" },
  { key: "dim", label: "Dim", full: "Dimanche" },
];

// Libellé « Matin » / « Après-midi » de la grille des plages horaires.
const timeLabelStyle: React.CSSProperties = {
  // Même hauteur de boîte que les champs horaires (TimeStepper = 21px), texte centré :
  // le libellé Matin / Après-midi est ainsi parfaitement aligné sur ses 2 champs.
  display: "inline-flex",
  alignItems: "center",
  height: 21,
  lineHeight: 1,
  fontSize: ".62rem",
  fontWeight: 700,
  letterSpacing: ".09em",
  textTransform: "uppercase",
  color: "var(--muted)",
  whiteSpace: "nowrap",
};

/** Tri legacy : dateStart croissant (nulls en dernier), puis id. */
function sortPeriods(periods: UiPeriod[]): UiPeriod[] {
  return periods.slice().sort((a, b) => {
    const as = a.dateStart;
    const bs = b.dateStart;
    if (as && bs) return as < bs ? -1 : as > bs ? 1 : a.id - b.id;
    if (as) return -1;
    if (bs) return 1;
    return a.id - b.id;
  });
}

/** « 2025-09-01 » → « 01/09/2025 » (format legacy fr-FR). */
function fmtDate(value: string): string {
  if (!value) return "—";
  return new Date(`${value}T00:00`).toLocaleDateString("fr-FR");
}

type ModalForm = {
  id: number | null;
  label: string;
  etiquette: string;
  dateStart: string;
  dateEnd: string;
  color: string;
};

const EMPTY_FORM: ModalForm = {
  id: null,
  label: "",
  etiquette: "",
  dateStart: "",
  dateEnd: "",
  color: "#6dceaa",
};

type ExerciceForm = {
  id: number | null;
  label: string;
  type: ExerciceType;
  dateStart: string;
  dateEnd: string;
};

/** Libellé + dates par défaut selon le type d'exercice (année en cours).
 *  Civile → « 2025 » (01/01→31/12) ; Scolaire → « 2025-2026 » (01/09→31/08, mois ≥ août). */
function exerciceDefaults(type: ExerciceType): {
  label: string;
  dateStart: string;
  dateEnd: string;
} {
  const now = new Date();
  const y = now.getFullYear();
  if (type === "civile") {
    return { label: `${y}`, dateStart: `${y}-01-01`, dateEnd: `${y}-12-31` };
  }
  const ssy = now.getMonth() + 1 >= 8 ? y : y - 1;
  return { label: `${ssy}-${ssy + 1}`, dateStart: `${ssy}-09-01`, dateEnd: `${ssy + 1}-08-31` };
}

function emptyExerciceForm(): ExerciceForm {
  return { id: null, ...exerciceDefaults("scolaire"), type: "scolaire" };
}

export function PeriodesPanel({ serviceId, initialPeriods, exercices, opening }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // ── Navigation entre exercices (par défaut : le plus récent). ───────────────
  const sortedExercices = useMemo(
    () => exercices.slice().sort((a, b) => a.label.localeCompare(b.label)),
    [exercices],
  );
  const defaultExerciceId =
    sortedExercices.length > 0 ? sortedExercices[sortedExercices.length - 1].id : null;
  const [currentExerciceId, setCurrentExerciceId] = useState<number | null>(defaultExerciceId);

  const exerciceIndex = sortedExercices.findIndex((e) => e.id === currentExerciceId);
  const exerciceLabel = exerciceIndex >= 0 ? sortedExercices[exerciceIndex].label : "—";
  const canPrev = exerciceIndex > 0;
  const canNext = exerciceIndex >= 0 && exerciceIndex < sortedExercices.length - 1;

  // ── Sélection de périodes (cases à cocher). ─────────────────────────────────
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const visiblePeriods = useMemo(() => {
    const inExercice =
      currentExerciceId == null
        ? initialPeriods
        : initialPeriods.filter((p) => p.exerciceId === currentExerciceId);
    return sortPeriods(inExercice);
  }, [initialPeriods, currentExerciceId]);

  function changeExercice(id: number | null) {
    setCurrentExerciceId(id);
    setSelected(new Set());
  }

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll(check: boolean) {
    setSelected(check ? new Set(visiblePeriods.map((p) => p.id)) : new Set());
  }

  const selectedCount = selected.size;
  const allChecked = visiblePeriods.length > 0 && selectedCount === visiblePeriods.length;
  const someChecked = selectedCount > 0 && !allChecked;
  const anyInactiveSelected = [...selected].some((id) => {
    const p = visiblePeriods.find((x) => x.id === id);
    return p && p.state !== "actif";
  });

  // ── Modale création / édition. ──────────────────────────────────────────────
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<ModalForm>(EMPTY_FORM);
  const [modalError, setModalError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  function openCreate() {
    setModalError(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEdit() {
    const id = [...selected][0];
    const p = visiblePeriods.find((x) => x.id === id);
    if (!p) return;
    setModalError(null);
    setForm({
      id: p.id,
      label: p.label,
      etiquette: p.etiquette ?? "",
      dateStart: p.dateStart,
      dateEnd: p.dateEnd,
      color: p.color || "#6dceaa",
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setModalError(null);
  }

  function saveModal() {
    setModalError(null);
    const label = form.label.trim();
    if (!label) {
      setModalError("Le libellé est requis.");
      return;
    }
    if (form.id == null && currentExerciceId == null) {
      setModalError("Créez d'abord un exercice.");
      return;
    }
    const base = {
      serviceId,
      label,
      etiquette: form.etiquette.trim(),
      dateStart: form.dateStart || null,
      dateEnd: form.dateEnd || null,
      color: form.color || "#6dceaa",
    };
    startTransition(async () => {
      const res =
        form.id == null
          ? await createPeriodAction({ ...base, exerciceId: currentExerciceId as number })
          : await updatePeriodAction({ ...base, id: form.id });
      if (res && !res.ok) {
        setModalError(res.error ?? "Échec de l'enregistrement.");
        return;
      }
      setModalOpen(false);
      setSelected(new Set());
      router.refresh();
    });
  }

  // ── Modale exercice (création / édition). ───────────────────────────────────
  const hasExercices = sortedExercices.length > 0;
  const currentExercice = exerciceIndex >= 0 ? sortedExercices[exerciceIndex] : null;
  const [exoModalOpen, setExoModalOpen] = useState(false);
  // Confirmation de suppression d'exercice via une modale --danger (cf. plus bas).
  const [confirmDeleteExo, setConfirmDeleteExo] = useState(false);
  // Idem pour la suppression de période(s) sélectionnée(s).
  const [confirmDeletePeriods, setConfirmDeletePeriods] = useState(false);
  const [exoForm, setExoForm] = useState<ExerciceForm>(emptyExerciceForm);
  const [exoError, setExoError] = useState<string | null>(null);
  // Après création d'un exercice : sélectionner le plus récent une fois la liste rafraîchie.
  const [pendingSelectNewest, setPendingSelectNewest] = useState(false);

  // Garde-fou de sélection : applique « sélectionner le nouvel exercice », sinon recale
  // sur un exercice valide (le dernier) si la sélection courante a disparu.
  // biome-ignore lint/correctness/useExhaustiveDependencies: piloté par la liste d'exercices
  useEffect(() => {
    if (pendingSelectNewest && sortedExercices.length > 0) {
      const newest = sortedExercices.reduce((a, b) => (b.id > a.id ? b : a));
      setCurrentExerciceId(newest.id);
      setSelected(new Set());
      setPendingSelectNewest(false);
      return;
    }
    if (currentExerciceId != null && !sortedExercices.some((e) => e.id === currentExerciceId)) {
      setCurrentExerciceId(hasExercices ? sortedExercices[sortedExercices.length - 1].id : null);
    }
  }, [sortedExercices]);

  function openCreateExercice() {
    setExoError(null);
    setExoForm(emptyExerciceForm());
    setExoModalOpen(true);
  }

  function openEditExercice() {
    if (!currentExercice) return;
    setExoError(null);
    setExoForm({
      id: currentExercice.id,
      label: currentExercice.label,
      type: currentExercice.type,
      dateStart: currentExercice.dateStart,
      dateEnd: currentExercice.dateEnd,
    });
    setExoModalOpen(true);
  }

  function changeExoType(type: ExerciceType) {
    // En création, le type pré-remplit libellé + dates ; en édition, on ne touche qu'au type.
    setExoForm((f) => (f.id == null ? { ...f, type, ...exerciceDefaults(type) } : { ...f, type }));
  }

  function saveExercice() {
    setExoError(null);
    const label = exoForm.label.trim();
    if (!label) {
      setExoError("Le libellé est requis.");
      return;
    }
    const base = {
      serviceId,
      label,
      type: exoForm.type,
      dateStart: exoForm.dateStart || null,
      dateEnd: exoForm.dateEnd || null,
    };
    startTransition(async () => {
      const res =
        exoForm.id == null
          ? await createExerciceAction(base)
          : await updateExerciceAction({ ...base, id: exoForm.id });
      if (res && !res.ok) {
        setExoError(res.error ?? "Échec de l'enregistrement.");
        return;
      }
      if (exoForm.id == null) setPendingSelectNewest(true);
      setExoModalOpen(false);
      router.refresh();
    });
  }

  // Ouvre la modale de confirmation --danger ; la suppression effective est dans
  // runDeleteExercice (déclenchée par le bouton de la modale).
  function deleteExercice() {
    if (!currentExercice) return;
    setListError(null);
    setConfirmDeleteExo(true);
  }

  function runDeleteExercice() {
    if (!currentExercice) return;
    const id = currentExercice.id;
    setListError(null);
    startTransition(async () => {
      const res = await deleteExerciceAction({ serviceId, id });
      if (res && !res.ok) {
        setListError(res.error ?? "Échec de la suppression.");
        return;
      }
      setConfirmDeleteExo(false);
      setCurrentExerciceId(null);
      router.refresh();
    });
  }

  // Ouvre la modale de confirmation --danger ; la suppression effective est dans
  // runDeleteSelected (déclenchée par le bouton de la modale).
  function deleteSelected() {
    if (selected.size === 0) return;
    setListError(null);
    setConfirmDeletePeriods(true);
  }

  function runDeleteSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    setListError(null);
    startTransition(async () => {
      for (const id of ids) {
        const res = await deletePeriodAction({ serviceId, id });
        if (res && !res.ok) {
          setListError(res.error ?? "Échec de la suppression.");
          return;
        }
      }
      setConfirmDeletePeriods(false);
      setSelected(new Set());
      router.refresh();
    });
  }

  function reactivateSelected() {
    const ids = [...selected].filter((id) => {
      const p = visiblePeriods.find((x) => x.id === id);
      return p && p.state !== "actif";
    });
    if (ids.length === 0) return;
    setListError(null);
    startTransition(async () => {
      const res = await reactivatePeriodsAction({ serviceId, ids });
      if (res && !res.ok) {
        setListError(res.error ?? "Échec de la réactivation.");
        return;
      }
      setSelected(new Set());
      router.refresh();
    });
  }

  // ── Jours d'ouverture + fériés + plages horaires. ───────────────────────────
  const [activeDays, setActiveDays] = useState<string[]>(opening.activeDays);
  const [openOnHolidays, setOpenOnHolidays] = useState(opening.openOnHolidays);
  const [openOnSchoolHolidays, setOpenOnSchoolHolidays] = useState(opening.openOnSchoolHolidays);
  const [morningStart, setMorningStart] = useState(opening.morningStart);
  const [morningEnd, setMorningEnd] = useState(opening.morningEnd);
  const [afternoonStart, setAfternoonStart] = useState(opening.afternoonStart);
  const [afternoonEnd, setAfternoonEnd] = useState(opening.afternoonEnd);
  const [openingError, setOpeningError] = useState<string | null>(null);
  const [openingSaved, setOpeningSaved] = useState(false);
  // Vrai dès que l'usager a modifié une plage horaire → arme l'auto-save débouncé
  // (évite une sauvegarde au montage / après router.refresh).
  const hoursTouchedRef = useRef(false);

  // Enregistre la config d'ouverture. `overrides` permet de sauvegarder une valeur
  // qui vient d'être calculée sans attendre le re-render (setState asynchrone) — sert
  // à l'auto-save des « Jours d'ouverture ». `??` préserve `false`/`[]` (ne retombe
  // que sur null/undefined).
  type OpeningOverrides = Partial<{
    activeDays: string[];
    openOnHolidays: boolean;
    openOnSchoolHolidays: boolean;
    morningStart: string;
    morningEnd: string;
    afternoonStart: string;
    afternoonEnd: string;
  }>;
  function persistOpening(overrides: OpeningOverrides = {}) {
    setOpeningError(null);
    startTransition(async () => {
      const res = await saveOpeningConfigAction({
        serviceId,
        activeDays: (overrides.activeDays ?? activeDays) as (
          | "lun"
          | "mar"
          | "mer"
          | "jeu"
          | "ven"
          | "sam"
          | "dim"
        )[],
        openOnHolidays: overrides.openOnHolidays ?? openOnHolidays,
        openOnSchoolHolidays: overrides.openOnSchoolHolidays ?? openOnSchoolHolidays,
        morningStart: overrides.morningStart ?? morningStart,
        morningEnd: overrides.morningEnd ?? morningEnd,
        afternoonStart: overrides.afternoonStart ?? afternoonStart,
        afternoonEnd: overrides.afternoonEnd ?? afternoonEnd,
      });
      if (res && !res.ok) {
        setOpeningError(res.error ?? "Échec de l'enregistrement.");
        return;
      }
      setOpeningSaved(true);
      // Le badge « ✓ Enregistré » s'efface seul après 1,8 s (comme le panneau Réservations).
      window.setTimeout(() => setOpeningSaved(false), 1800);
      router.refresh();
    });
  }

  // Jours d'ouverture : auto-save immédiat au clic (pas de bouton « Enregistrer »).
  function toggleDay(key: string) {
    const nextDays = activeDays.includes(key)
      ? activeDays.filter((d) => d !== key)
      : [...activeDays, key];
    setActiveDays(nextDays);
    persistOpening({ activeDays: nextDays });
  }

  // Plages horaires : auto-save débouncé (700 ms). Le timer est ré-armé à chaque
  // changement → une seule sauvegarde après la fin du réglage (utile en clic-maintenu
  // sur les flèches ±15 min). persistOpening lit l'état courant au déclenchement.
  // biome-ignore lint/correctness/useExhaustiveDependencies: déclenché par les horaires uniquement
  useEffect(() => {
    if (!hoursTouchedRef.current) return;
    const t = setTimeout(() => persistOpening(), 700);
    return () => clearTimeout(t);
  }, [morningStart, morningEnd, afternoonStart, afternoonEnd]);

  return (
    <div className="panel">
      {/* Bandeau « Exercice ◀ … ▶ » : EXTRAIT du multi-colonnage, pleine largeur au-dessus. */}
      <div className="pr-head">
        <div className="panel-title pr-title" style={{ fontWeight: 500 }}>
          <span style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
            <span className="dot" style={{ background: "var(--warn)" }} />
            Exercice
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: ".6rem", flexWrap: "wrap" }}>
          {hasExercices ? (
            <div className="periode-nav">
              <button
                type="button"
                className="ex-arrow"
                onClick={() => canPrev && changeExercice(sortedExercices[exerciceIndex - 1].id)}
                disabled={!canPrev}
                aria-label="Exercice précédent"
              >
                ◀
              </button>
              <span className="ex-nav-label">{exerciceLabel}</span>
              <button
                type="button"
                className="ex-arrow"
                onClick={() => canNext && changeExercice(sortedExercices[exerciceIndex + 1].id)}
                disabled={!canNext}
                aria-label="Exercice suivant"
              >
                ▶
              </button>
            </div>
          ) : (
            <span style={{ fontSize: ".82rem", color: "var(--muted)" }}>Aucun exercice</span>
          )}

          {currentExercice && (currentExercice.dateStart || currentExercice.dateEnd) && (
            <span style={{ fontSize: ".72rem", color: "var(--muted)", whiteSpace: "nowrap" }}>
              {currentExercice.type === "civile" ? "Civile" : "Scolaire"} ·{" "}
              {fmtDate(currentExercice.dateStart)} → {fmtDate(currentExercice.dateEnd)}
            </span>
          )}

          <div style={{ display: "flex", gap: ".4rem", alignItems: "center" }}>
            {currentExercice && (
              <>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={openEditExercice}
                  title="Modifier l'exercice"
                  style={{
                    borderColor: "color-mix(in srgb, var(--accent) 40%, transparent)",
                    color: "var(--accent)",
                    padding: ".18rem .5rem",
                    fontSize: ".62rem",
                  }}
                >
                  ✏️
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={deleteExercice}
                  disabled={pending}
                  title="Supprimer l'exercice"
                  style={{
                    borderColor: "rgba(220,80,80,.4)",
                    color: "#e05555",
                    padding: ".18rem .5rem",
                    fontSize: ".62rem",
                  }}
                >
                  🗑️
                </button>
              </>
            )}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={openCreateExercice}
              style={{
                borderColor: "color-mix(in srgb, var(--warn) 45%, transparent)",
                color: "var(--warn)",
                padding: ".18rem .5rem",
                fontSize: ".62rem",
                whiteSpace: "nowrap",
              }}
            >
              ＋ Nouvel exercice
            </button>
          </div>
        </div>
      </div>

      {/* ── Multi-colonnage : tableau des périodes · actions · plages horaires ── */}
      <div id="periods-row">
        <div className="pr-editor">
          {/* Sous-titre discret entre « Exercice » et le tableau des périodes. */}
          <div className="panel-subtitle" style={{ fontSize: ".85rem", fontWeight: 500 }}>
            Périodes
          </div>
          {visiblePeriods.length > 0 ? (
            <table className="periods-table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}>
                    <input
                      type="checkbox"
                      className="admin-cb"
                      checked={allChecked}
                      ref={(el) => {
                        if (el) el.indeterminate = someChecked;
                      }}
                      onChange={(e) => toggleSelectAll(e.target.checked)}
                      title="Tout sélectionner"
                    />
                  </th>
                  <th>Coul</th>
                  <th>Étiq</th>
                  <th className="td-left" style={{ width: 250 }}>
                    Libellé
                  </th>
                  <th>Début</th>
                  <th>Fin</th>
                </tr>
              </thead>
              <tbody>
                {visiblePeriods.map((p) => (
                  <tr key={p.id} style={p.state === "actif" ? undefined : { opacity: 0.55 }}>
                    <td>
                      <input
                        type="checkbox"
                        className="admin-cb"
                        checked={selected.has(p.id)}
                        onChange={() => toggleSelect(p.id)}
                      />
                    </td>
                    <td>
                      <span
                        className="period-swatch"
                        style={{ background: p.color || "#6dceaa" }}
                      />
                    </td>
                    <td>{p.etiquette || "—"}</td>
                    <td className="td-left">{p.label || "—"}</td>
                    <td>{fmtDate(p.dateStart)}</td>
                    <td>{fmtDate(p.dateEnd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ color: "var(--muted)", fontSize: ".85rem", margin: ".4rem 0" }}>
              Aucune période définie.
            </p>
          )}
        </div>

        <div className="pr-add">
          {selectedCount > 0 && (
            <>
              <span style={{ fontSize: ".82rem", color: "var(--muted)" }}>
                {selectedCount} sélectionnée{selectedCount > 1 ? "s" : ""}
              </span>
              {selectedCount === 1 && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={openEdit}
                  style={{
                    borderColor: "color-mix(in srgb, var(--accent) 40%, transparent)",
                    color: "var(--accent)",
                    padding: ".25rem .65rem",
                    fontSize: ".68rem",
                  }}
                >
                  ✏️ Modifier
                </button>
              )}
              {anyInactiveSelected && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={reactivateSelected}
                  disabled={pending}
                  style={{
                    borderColor: "color-mix(in srgb, var(--accent) 40%, transparent)",
                    color: "var(--accent)",
                    padding: ".25rem .65rem",
                    fontSize: ".68rem",
                  }}
                >
                  ✓ Réactiver
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={deleteSelected}
                disabled={pending}
                style={{
                  borderColor: "rgba(220,80,80,.4)",
                  color: "#e05555",
                  padding: ".25rem .65rem",
                  fontSize: ".68rem",
                }}
              >
                🗑️ Supprimer
              </button>
            </>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={openCreate}
            disabled={!hasExercices}
            title={hasExercices ? undefined : "Créez d'abord un exercice."}
            style={{
              marginLeft: "auto",
              borderColor: "color-mix(in srgb, var(--accent) 30%, transparent)",
              color: "var(--accent)",
              padding: ".18rem .5rem",
              fontSize: ".62rem",
              whiteSpace: "nowrap",
              opacity: hasExercices ? 1 : 0.5,
              cursor: hasExercices ? "pointer" : "not-allowed",
            }}
          >
            ＋ Ajouter une période
          </button>
        </div>
        {/* Plages horaires : placées dans la colonne DROITE de la grille #periods-row,
            à côté du tableau Périodes (au lieu d'être empilées en dessous). */}
        <div className="pr-hours">
          <div className="panel-subtitle" style={{ fontSize: ".85rem", fontWeight: 500 }}>
            Plages horaires
          </div>
          <div
            className="defaults-row"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: ".5rem",
            }}
          >
            {/* Matin / Après-midi : grille « libellé | début | fin » → les deux lignes sont
                alignées en colonnes, avec un interligne réduit (rowGap). */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "auto auto auto",
                columnGap: ".5rem",
                rowGap: ".3rem",
                alignItems: "center",
                justifyContent: "start",
              }}
            >
              <span style={timeLabelStyle}>Matin</span>
              <TimeStepper
                value={morningStart}
                onChange={(v) => {
                  hoursTouchedRef.current = true;
                  setOpeningSaved(false);
                  setMorningStart(v);
                }}
              />
              <TimeStepper
                value={morningEnd}
                onChange={(v) => {
                  hoursTouchedRef.current = true;
                  setOpeningSaved(false);
                  setMorningEnd(v);
                }}
              />
              <span style={timeLabelStyle}>Après-midi</span>
              <TimeStepper
                value={afternoonStart}
                onChange={(v) => {
                  hoursTouchedRef.current = true;
                  setOpeningSaved(false);
                  setAfternoonStart(v);
                }}
              />
              <TimeStepper
                value={afternoonEnd}
                onChange={(v) => {
                  hoursTouchedRef.current = true;
                  setOpeningSaved(false);
                  setAfternoonEnd(v);
                }}
              />
            </div>
            {/* Auto-save : statut, sur sa propre ligne sous les plages. */}
            <div
              style={{ display: "flex", alignItems: "center", gap: ".5rem", minHeight: ".9rem" }}
            >
              {openingError && (
                <span className="field-error" style={{ display: "inline" }}>
                  {openingError}
                </span>
              )}
              {!openingError && pending && (
                <span style={{ fontSize: ".78rem", color: "var(--muted)" }}>Enregistrement…</span>
              )}
              {!openingError && !pending && openingSaved && (
                <span style={{ fontSize: ".78rem", color: "var(--accent)" }}>✓ Enregistré</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {listError && (
        <div className="field-error" style={{ display: "block", marginBottom: ".75rem" }}>
          {listError}
        </div>
      )}

      {/* ── Jours d'ouverture ──────────────────────────────────────────────── */}
      <div className="panel-subtitle" style={{ fontSize: ".85rem", fontWeight: 500 }}>
        Jours d&apos;ouverture
      </div>
      <div style={{ display: "flex", gap: ".55rem", alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: ".55rem", flexWrap: "wrap", alignItems: "center" }}>
          {DAYS.map((d) => (
            <label
              key={d.key}
              title={d.full}
              style={{
                display: "flex",
                alignItems: "center",
                gap: ".3rem",
                cursor: "pointer",
                fontSize: ".62rem",
                fontWeight: 500,
              }}
            >
              <input
                type="checkbox"
                className="admin-cb"
                checked={activeDays.includes(d.key)}
                onChange={() => toggleDay(d.key)}
                style={{ accentColor: "var(--accent)", width: 13, height: 13 }}
              />
              {d.full}
            </label>
          ))}
        </div>
        <span
          style={{
            width: 1,
            height: "1rem",
            background: "var(--border)",
            flexShrink: 0,
            margin: "0 .2rem",
            alignSelf: "center",
          }}
        />
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: ".3rem",
            cursor: "pointer",
            fontSize: ".62rem",
            fontWeight: 500,
          }}
        >
          <input
            type="checkbox"
            className="admin-cb"
            checked={openOnHolidays}
            onChange={(e) => {
              setOpenOnHolidays(e.target.checked);
              persistOpening({ openOnHolidays: e.target.checked });
            }}
            style={{ accentColor: "var(--accent)", width: 13, height: 13 }}
          />
          Jours fériés
        </label>
        <label
          title="Décoché : les jours de vacances scolaires sont hachurés et non réservables (agenda + réservations)."
          style={{
            display: "flex",
            alignItems: "center",
            gap: ".3rem",
            cursor: "pointer",
            fontSize: ".62rem",
            fontWeight: 500,
          }}
        >
          <input
            type="checkbox"
            className="admin-cb"
            checked={openOnSchoolHolidays}
            onChange={(e) => {
              setOpenOnSchoolHolidays(e.target.checked);
              persistOpening({ openOnSchoolHolidays: e.target.checked });
            }}
            style={{ accentColor: "var(--accent)", width: 13, height: 13 }}
          />
          Vacances scolaires
        </label>
      </div>

      {/* ── Modale exercice (création / édition) ───────────────────────────── */}
      {exoModalOpen && (
        <div className="modal-overlay open">
          <div className="modal-box" aria-labelledby="exo-modal-title">
            <div className="modal-title" id="exo-modal-title">
              <span>{exoForm.id == null ? "➕ Nouvel exercice" : "✏️ Modifier l'exercice"}</span>
              <button type="button" className="modal-close" onClick={() => setExoModalOpen(false)}>
                ✕
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: ".75rem" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: ".3rem" }}>
                <span style={{ fontSize: ".75rem", color: "var(--muted)" }}>Type</span>
                <div style={{ display: "flex", gap: "1rem" }}>
                  {(["scolaire", "civile"] as ExerciceType[]).map((t) => (
                    <label
                      key={t}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: ".35rem",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="radio"
                        name="exo-type"
                        checked={exoForm.type === t}
                        onChange={() => changeExoType(t)}
                      />
                      <span style={{ fontSize: ".82rem" }}>
                        {t === "scolaire" ? "Scolaire" : "Civile"}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <label style={{ display: "flex", flexDirection: "column", gap: ".25rem" }}>
                <span style={{ fontSize: ".75rem", color: "var(--muted)" }}>Libellé *</span>
                <input
                  type="text"
                  value={exoForm.label}
                  onChange={(e) => setExoForm((f) => ({ ...f, label: e.target.value }))}
                  placeholder="Ex. 2025-2026"
                />
              </label>
              <div style={{ display: "flex", gap: ".75rem" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: ".25rem", flex: 1 }}>
                  <span style={{ fontSize: ".75rem", color: "var(--muted)" }}>Début</span>
                  <input
                    type="date"
                    value={exoForm.dateStart}
                    onChange={(e) => setExoForm((f) => ({ ...f, dateStart: e.target.value }))}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: ".25rem", flex: 1 }}>
                  <span style={{ fontSize: ".75rem", color: "var(--muted)" }}>Fin</span>
                  <input
                    type="date"
                    value={exoForm.dateEnd}
                    onChange={(e) => setExoForm((f) => ({ ...f, dateEnd: e.target.value }))}
                  />
                </label>
              </div>

              {exoError && (
                <div className="field-error" style={{ display: "block" }}>
                  {exoError}
                </div>
              )}

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: ".5rem",
                  marginTop: ".5rem",
                }}
              >
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setExoModalOpen(false)}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={saveExercice}
                  disabled={pending}
                  style={{ background: "var(--warn)", color: "#0f1117" }}
                >
                  {pending ? "Enregistrement…" : "Enregistrer"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modale de confirmation de suppression d'un exercice (--danger) ───── */}
      {confirmDeleteExo && currentExercice && (
        // biome-ignore lint/a11y/useKeyWithClickEvents: fermeture par le bouton × / Annuler
        <div
          className="modal-overlay open"
          style={{ display: "flex" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirmDeleteExo(false);
          }}
        >
          <div className="modal-box" style={{ maxWidth: 460, width: "95vw" }}>
            <div className="modal-title" style={{ color: "var(--danger)" }}>
              🗑️ Supprimer l&apos;exercice
            </div>
            <p style={{ fontSize: ".85rem", lineHeight: 1.5, margin: "0 0 .4rem" }}>
              Vous êtes sur le point de supprimer l&apos;exercice{" "}
              <strong>« {currentExercice.label} »</strong>.
            </p>
            <p
              style={{
                fontSize: ".78rem",
                color: "var(--danger)",
                fontWeight: 600,
                margin: "0 0 1rem",
              }}
            >
              ⚠️ Possible uniquement s&apos;il n&apos;a aucune période. Action irréversible.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: ".5rem" }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setConfirmDeleteExo(false)}
                style={{ fontSize: ".78rem" }}
              >
                Annuler
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={runDeleteExercice}
                disabled={pending}
                style={{
                  fontSize: ".78rem",
                  background: "var(--danger)",
                  border: "none",
                  color: "var(--text)",
                }}
              >
                🗑️ Supprimer
              </button>
            </div>
            <button
              type="button"
              className="modal-close"
              onClick={() => setConfirmDeleteExo(false)}
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* ── Modale de confirmation de suppression de période(s) (--danger) ───── */}
      {confirmDeletePeriods && selectedCount > 0 && (
        // biome-ignore lint/a11y/useKeyWithClickEvents: fermeture par le bouton × / Annuler
        <div
          className="modal-overlay open"
          style={{ display: "flex" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirmDeletePeriods(false);
          }}
        >
          <div className="modal-box" style={{ maxWidth: 460, width: "95vw" }}>
            <div className="modal-title" style={{ color: "var(--danger)" }}>
              🗑️ Supprimer {selectedCount > 1 ? `${selectedCount} périodes` : "la période"}
            </div>
            <p style={{ fontSize: ".85rem", lineHeight: 1.5, margin: "0 0 .4rem" }}>
              Vous êtes sur le point de supprimer{" "}
              <strong>{selectedCount > 1 ? `${selectedCount} périodes` : "1 période"}</strong>.
            </p>
            <p
              style={{
                fontSize: ".78rem",
                color: "var(--danger)",
                fontWeight: 600,
                margin: "0 0 1rem",
              }}
            >
              ⚠️ Les réservations liées seront aussi supprimées. Action irréversible.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: ".5rem" }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setConfirmDeletePeriods(false)}
                style={{ fontSize: ".78rem" }}
              >
                Annuler
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={runDeleteSelected}
                disabled={pending}
                style={{
                  fontSize: ".78rem",
                  background: "var(--danger)",
                  border: "none",
                  color: "var(--text)",
                }}
              >
                🗑️ Supprimer
              </button>
            </div>
            <button
              type="button"
              className="modal-close"
              onClick={() => setConfirmDeletePeriods(false)}
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* ── Modale création / édition ──────────────────────────────────────── */}
      {modalOpen && (
        <div className="modal-overlay open">
          <div className="modal-box" aria-labelledby="period-modal-title">
            <div className="modal-title" id="period-modal-title">
              <span>{form.id == null ? "➕ Nouvelle période" : "✏️ Modifier la période"}</span>
              <button type="button" className="modal-close" onClick={closeModal}>
                ✕
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: ".75rem" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: ".25rem" }}>
                <span style={{ fontSize: ".75rem", color: "var(--muted)" }}>Libellé *</span>
                <input
                  type="text"
                  value={form.label}
                  onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                  placeholder="Ex. Période 1"
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: ".25rem" }}>
                <span style={{ fontSize: ".75rem", color: "var(--muted)" }}>Étiquette</span>
                <input
                  type="text"
                  value={form.etiquette}
                  onChange={(e) => setForm((f) => ({ ...f, etiquette: e.target.value }))}
                  placeholder="Optionnel"
                />
              </label>
              <div style={{ display: "flex", gap: ".75rem" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: ".25rem", flex: 1 }}>
                  <span style={{ fontSize: ".75rem", color: "var(--muted)" }}>Début</span>
                  <input
                    type="date"
                    value={form.dateStart}
                    onChange={(e) => setForm((f) => ({ ...f, dateStart: e.target.value }))}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: ".25rem", flex: 1 }}>
                  <span style={{ fontSize: ".75rem", color: "var(--muted)" }}>Fin</span>
                  <input
                    type="date"
                    value={form.dateEnd}
                    onChange={(e) => setForm((f) => ({ ...f, dateEnd: e.target.value }))}
                  />
                </label>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
                <span style={{ fontSize: ".75rem", color: "var(--muted)" }}>Couleur</span>
                <input
                  type="color"
                  className="period-color-input"
                  value={form.color}
                  onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                />
              </label>

              {modalError && (
                <div className="field-error" style={{ display: "block" }}>
                  {modalError}
                </div>
              )}

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: ".5rem",
                  marginTop: ".5rem",
                }}
              >
                <button type="button" className="btn btn-ghost" onClick={closeModal}>
                  Annuler
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={saveModal}
                  disabled={pending}
                  style={{ background: "var(--warn)", color: "#0f1117" }}
                >
                  {pending ? "Enregistrement…" : "Enregistrer"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
