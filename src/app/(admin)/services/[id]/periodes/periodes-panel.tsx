"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  createPeriodAction,
  deletePeriodAction,
  reactivatePeriodsAction,
  saveOpeningConfigAction,
  updatePeriodAction,
} from "./actions";

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

type Exercice = { id: number; label: string };

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

/** Incrémente/décrémente une heure « HH:MM » par pas de 15 min, calé sur la grille. */
function stepTime(value: string, deltaMin: number): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  let total = m ? Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2])) : 0;
  const onGrid = total % 15 === 0;
  if (onGrid) total += deltaMin;
  else total = deltaMin > 0 ? Math.ceil(total / 15) * 15 : Math.floor(total / 15) * 15;
  total = Math.max(0, Math.min(23 * 60 + 45, total));
  const h = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
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
          ? await createPeriodAction(base)
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

  function deleteSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (
      !window.confirm(
        `Supprimer ${ids.length} période(s) ? Les réservations liées seront aussi supprimées.`,
      )
    ) {
      return;
    }
    setListError(null);
    startTransition(async () => {
      for (const id of ids) {
        const res = await deletePeriodAction({ serviceId, id });
        if (res && !res.ok) {
          setListError(res.error ?? "Échec de la suppression.");
          return;
        }
      }
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
            style={{
              marginLeft: "auto",
              borderColor: "color-mix(in srgb, var(--accent) 30%, transparent)",
              color: "var(--accent)",
              padding: ".18rem .5rem",
              fontSize: ".62rem",
              whiteSpace: "nowrap",
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

/**
 * Champ heure « HH:MM » avec boutons ▲▼ par pas de 15 min (port legacy).
 * Clic-maintenu : 1er pas immédiat, puis répétition (90 ms) après un délai de 400 ms
 * tant que le bouton reste enfoncé. La répétition lit la valeur COURANTE (valueRef)
 * pour accumuler correctement à chaque tick.
 */
function TimeStepper({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const valueRef = useRef(value);
  valueRef.current = value;
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stop() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);
    timeoutRef.current = null;
    intervalRef.current = null;
  }

  function startHold(delta: number) {
    stop(); // garde-fou anti-répétition résiduelle
    onChange(stepTime(valueRef.current, delta)); // 1er pas immédiat
    timeoutRef.current = setTimeout(() => {
      intervalRef.current = setInterval(() => onChange(stepTime(valueRef.current, delta)), 90);
    }, 400);
  }

  // Nettoyage à l'unmount (utilise uniquement des refs stables).
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return (
    <span className="time-step-wrap">
      <input
        type="text"
        value={value}
        maxLength={5}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: 50,
          // Hauteur calée sur la pile des flèches ▲/▼ : 2 × 10px + 1px de gap = 21px
          // (cf. .time-step-btn / .time-step-btns dans app-legacy.css).
          height: 21,
          boxSizing: "border-box",
          fontSize: ".78rem",
          padding: "0 .35rem",
          borderRadius: "var(--rad-sm)",
          border: "1px solid var(--border)",
          background: "var(--surface2)",
          color: "var(--text)",
          textAlign: "center",
        }}
      />
      <span className="time-step-btns">
        <button
          type="button"
          className="time-step-btn"
          tabIndex={-1}
          aria-label="Augmenter"
          onPointerDown={(e) => {
            e.preventDefault();
            startHold(15);
          }}
          onPointerUp={stop}
          onPointerLeave={stop}
          onPointerCancel={stop}
        >
          ▲
        </button>
        <button
          type="button"
          className="time-step-btn"
          tabIndex={-1}
          aria-label="Diminuer"
          onPointerDown={(e) => {
            e.preventDefault();
            startHold(-15);
          }}
          onPointerUp={stop}
          onPointerLeave={stop}
          onPointerCancel={stop}
        >
          ▼
        </button>
      </span>
    </span>
  );
}
