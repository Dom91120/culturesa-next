"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { TimeStepper } from "@/components/time-stepper";
import { setShowPreviousExercicesAction } from "../exercice/actions";
import {
  createExerciceAction,
  createPeriodAction,
  deleteExerciceAction,
  deletePeriodAction,
  reactivatePeriodsAction,
  saveExerciceMaximaAction,
  saveOpeningConfigAction,
  setExerciceVisibleAction,
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
  // Ouverture des réservations usager ("YYYY-MM-DD" ou "" = toujours ouvert).
  disponibilite: string;
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
  // « Affiché aux utilisateurs » : l'unique exercice accessible côté usager.
  visibleToUsers: boolean;
  // Maximums de réservation par usager (par période / sur l'exercice « par an »).
  maxReservations: number;
  maxReservationsPeriod: number;
  // Réglages d'ouverture RÉSOLUS de l'exercice (surcharge ?? défauts du service).
  opening: Opening;
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
  showPreviousExercices: boolean;
};

// Réglages affichés quand le service n'a AUCUN exercice (blocs masqués de toute
// façon — valeurs de confort pour initialiser les états React).
const NO_EXERCICE_OPENING: Opening = {
  activeDays: [],
  openOnHolidays: false,
  openOnSchoolHolidays: false,
  morningStart: "09:00",
  morningEnd: "12:00",
  afternoonStart: "14:00",
  afternoonEnd: "18:00",
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
  // Même hauteur de boîte que les champs horaires (TimeStepper compact = 17px), texte
  // centré : le libellé Matin / Après-midi est ainsi parfaitement aligné sur ses 2 champs.
  display: "inline-flex",
  alignItems: "center",
  height: 17,
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

/** « 2025-09-01 » → « 01/09/25 » (JJ/MM/AA — colonnes Début/Fin/Dispo du tableau). */
function fmtDateShort(value: string): string {
  const m = /^\d{2}(\d{2})-(\d{2})-(\d{2})$/.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}

type ModalForm = {
  id: number | null;
  label: string;
  etiquette: string;
  dateStart: string;
  dateEnd: string;
  // Ouverture des réservations usager ("" = réservable sans restriction).
  disponibilite: string;
  color: string;
};

const EMPTY_FORM: ModalForm = {
  id: null,
  label: "",
  etiquette: "",
  dateStart: "",
  dateEnd: "",
  disponibilite: "",
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

export function PeriodesPanel({
  serviceId,
  initialPeriods,
  exercices,
  showPreviousExercices,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Réglage service « Afficher les exercices précédents » (optimiste, autosave).
  const [showPrevious, setShowPrevious] = useState(showPreviousExercices);

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
      disponibilite: p.disponibilite,
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
      disponibilite: form.disponibilite || null,
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
  // Un exercice qui a déjà des périodes est « verrouillé » : suppression interdite (pas de
  // corbeille) et, en édition, seul son libellé reste modifiable — le type et les dates
  // structurent les périodes existantes.
  const currentExerciceHasPeriods =
    currentExercice != null && initialPeriods.some((p) => p.exerciceId === currentExercice.id);
  const [exoModalOpen, setExoModalOpen] = useState(false);
  // Confirmation de suppression d'exercice via une modale --danger (cf. plus bas).
  const [confirmDeleteExo, setConfirmDeleteExo] = useState(false);
  // Idem pour la suppression de période(s) sélectionnée(s).
  const [confirmDeletePeriods, setConfirmDeletePeriods] = useState(false);
  const [exoForm, setExoForm] = useState<ExerciceForm>(emptyExerciceForm);
  const [exoError, setExoError] = useState<string | null>(null);
  // Édition d'un exercice déjà pourvu de périodes : type et dates figés (seul le libellé
  // reste modifiable). Ne s'applique jamais en création (exoForm.id null).
  const exoFieldsLocked = exoForm.id !== null && currentExerciceHasPeriods;
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

  // ── « Affiché aux utilisateurs » : l'UNIQUE exercice accessible côté usager. ─
  // État optimiste (id de l'exercice coché, null = aucun), resynchronisé sur les
  // props après chaque router.refresh().
  const [visibleExerciceId, setVisibleExerciceId] = useState<number | null>(
    exercices.find((e) => e.visibleToUsers)?.id ?? null,
  );
  useEffect(() => {
    setVisibleExerciceId(exercices.find((e) => e.visibleToUsers)?.id ?? null);
  }, [exercices]);

  function toggleVisibleToUsers(checked: boolean) {
    if (!currentExercice) return;
    const exerciceId = currentExercice.id;
    const previous = visibleExerciceId;
    setListError(null);
    // Cocher décoche l'exercice précédemment visible (unicité par service).
    setVisibleExerciceId(checked ? exerciceId : null);
    startTransition(async () => {
      const res = await setExerciceVisibleAction({ serviceId, exerciceId, visible: checked });
      if (res && !res.ok) {
        setVisibleExerciceId(previous);
        setListError(res.error ?? "Échec de l'enregistrement.");
        return;
      }
      router.refresh();
    });
  }

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

  // ── Jours d'ouverture + fériés + plages horaires — PAR EXERCICE. ────────────
  // Les réglages affichés/édités sont ceux de l'exercice sélectionné (◀ ▶) —
  // unique porteur ; sans exercice, les blocs sont masqués plus bas.
  const currentOpening = currentExercice?.opening ?? NO_EXERCICE_OPENING;
  const [activeDays, setActiveDays] = useState<string[]>(currentOpening.activeDays);
  const [openOnHolidays, setOpenOnHolidays] = useState(currentOpening.openOnHolidays);
  const [openOnSchoolHolidays, setOpenOnSchoolHolidays] = useState(
    currentOpening.openOnSchoolHolidays,
  );
  const [morningStart, setMorningStart] = useState(currentOpening.morningStart);
  const [morningEnd, setMorningEnd] = useState(currentOpening.morningEnd);
  const [afternoonStart, setAfternoonStart] = useState(currentOpening.afternoonStart);
  const [afternoonEnd, setAfternoonEnd] = useState(currentOpening.afternoonEnd);
  const [openingError, setOpeningError] = useState<string | null>(null);
  const [openingSaved, setOpeningSaved] = useState(false);
  // Vrai dès que l'usager a modifié une plage horaire → arme l'auto-save débouncé
  // (évite une sauvegarde au montage / après router.refresh).
  const hoursTouchedRef = useRef(false);

  // ── Maximums de réservation — PAR EXERCICE (par période / sur l'exercice). ──
  const [maxReservations, setMaxReservations] = useState(currentExercice?.maxReservations ?? 1);
  const [maxReservationsPeriod, setMaxReservationsPeriod] = useState(
    currentExercice?.maxReservationsPeriod ?? 1,
  );
  // Auto-save DÉBOUNCÉ des maximums (clics rapides sur ± coalescés en un appel).
  const maximaRef = useRef({ maxReservations, maxReservationsPeriod });
  const maximaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Nettoyage au DÉMONTAGE uniquement (deps []) — sans quoi le timer débouncé
  // serait annulé à chaque re-render.
  useEffect(
    () => () => {
      if (maximaTimer.current) clearTimeout(maximaTimer.current);
    },
    [],
  );

  function stepMaxima(field: "maxReservations" | "maxReservationsPeriod", delta: number) {
    if (currentExerciceId == null) return;
    const exerciceId = currentExerciceId;
    const next = { ...maximaRef.current };
    next[field] = Math.max(1, next[field] + delta);
    maximaRef.current = next;
    setMaxReservations(next.maxReservations);
    setMaxReservationsPeriod(next.maxReservationsPeriod);
    setOpeningSaved(false);
    setOpeningError(null);
    if (maximaTimer.current) clearTimeout(maximaTimer.current);
    maximaTimer.current = setTimeout(() => {
      startTransition(async () => {
        const res = await saveExerciceMaximaAction({ serviceId, exerciceId, ...maximaRef.current });
        if (res && !res.ok) {
          setOpeningError(res.error ?? "Échec de l'enregistrement.");
          return;
        }
        setOpeningSaved(true);
        router.refresh();
      });
    }, 700);
  }

  // Changement d'exercice (◀ ▶) : recharge les réglages de l'exercice affiché.
  // hoursTouchedRef repasse à false AVANT les setters → l'auto-save débouncé des
  // plages horaires ne se déclenche pas sur cette resynchronisation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resynchronisation pilotée par l'exercice affiché
  useEffect(() => {
    hoursTouchedRef.current = false;
    const o = currentExercice?.opening ?? NO_EXERCICE_OPENING;
    setActiveDays(o.activeDays);
    setOpenOnHolidays(o.openOnHolidays);
    setOpenOnSchoolHolidays(o.openOnSchoolHolidays);
    setMorningStart(o.morningStart);
    setMorningEnd(o.morningEnd);
    setAfternoonStart(o.afternoonStart);
    setAfternoonEnd(o.afternoonEnd);
    setOpeningError(null);
    // Maximums de l'exercice affiché (resynchronisés sans déclencher de save).
    if (maximaTimer.current) clearTimeout(maximaTimer.current);
    maximaRef.current = {
      maxReservations: currentExercice?.maxReservations ?? 1,
      maxReservationsPeriod: currentExercice?.maxReservationsPeriod ?? 1,
    };
    setMaxReservations(maximaRef.current.maxReservations);
    setMaxReservationsPeriod(maximaRef.current.maxReservationsPeriod);
  }, [currentExerciceId]);

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
    // Les réglages appartiennent à un exercice : sans exercice, rien à enregistrer
    // (les blocs sont masqués — garde défensive).
    if (currentExerciceId == null) return;
    setOpeningError(null);
    startTransition(async () => {
      const res = await saveOpeningConfigAction({
        serviceId,
        // Réglages écrits sur l'exercice affiché (unique porteur).
        exerciceId: currentExerciceId,
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
      {/* Ligne de titre : « Périodes » suivi (aligné à gauche) de la case
          « Afficher les exercices précédents », espacée de 2.5rem. */}
      <div
        className="panel-title pr-title"
        style={{
          fontWeight: 500,
          display: "flex",
          alignItems: "center",
          gap: "2.5rem",
          flexWrap: "wrap",
          marginBottom: 0,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
          <span className="dot" style={{ background: "var(--warn)" }} />
          Périodes
        </span>
        {/* Réglage service : afficher aussi les exercices passés dans la nav ◀ ▶. */}
        {hasExercices && (
          <label
            className="check"
            style={{
              fontSize: ".62rem",
              whiteSpace: "nowrap",
              color: "var(--muted)",
              fontWeight: 400,
            }}
          >
            <input
              type="checkbox"
              checked={showPrevious}
              disabled={pending}
              onChange={(e) => {
                const next = e.target.checked;
                setShowPrevious(next); // optimiste
                setListError(null);
                startTransition(async () => {
                  const res = await setShowPreviousExercicesAction(serviceId, next);
                  if (res && !res.ok) {
                    setShowPrevious(!next); // rollback
                    setListError(res.error ?? "Échec de l'enregistrement.");
                    return;
                  }
                  router.refresh();
                });
              }}
            />{" "}
            Afficher les exercices précédents
          </label>
        )}
      </div>

      {/* ── Multi-colonnage : tableau des périodes · actions · plages horaires ── */}
      <div id="periods-row">
        {/* Colonne gauche (tableau + bouton Ajouter) : la colonne « Plages horaires »
            bascule dessous quand la largeur manque (flex-wrap de #periods-row). */}
        <div className="pr-left">
          {/* Navigation d'exercice, sur 3 lignes au-dessus du sous-titre « Périodes … » :
              1) « Exercice ◀ … ▶ » — 2) type + dates + ✏️ (+ 🗑️) — 3) case usagers.
              Rythme vertical CALQUÉ sur la colonne « Plages horaires » d'en face :
              ligne 1 = hauteur du sous-titre (.85rem × 1.5), puis .75rem d'écart,
              lignes 2 et 3 = 17px (TimeStepper compact) espacées de .3rem (rowGap). */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 0,
              margin: "2rem 0 0",
            }}
          >
            <div className="pr-head" style={{ minHeight: "calc(.85rem * 1.5)" }}>
              {/* Libellé de la ligne, à gauche de la navigation ◀ … ▶. */}
              <span style={{ fontSize: ".85rem", fontWeight: 500 }}>Exercice</span>
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
              {/* « Nouvel exercice » : visible uniquement quand le service n'a AUCUN exercice
                  (sinon on crée les exercices suivants via la bascule). */}
              {!hasExercices && (
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
              )}
            </div>

            {/* Ligne 2 : type + dates de l'exercice + actions (édition / suppression) —
                hauteur 17px alignée sur la ligne « Matin » d'en face. */}
            {currentExercice && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: ".5rem",
                  height: 17,
                  marginTop: ".75rem",
                }}
              >
                {(currentExercice.dateStart || currentExercice.dateEnd) && (
                  <span style={{ fontSize: ".72rem", color: "var(--muted)", whiteSpace: "nowrap" }}>
                    {currentExercice.type === "civile" ? "Année civile" : "Année scolaire"} ·{" "}
                    {fmtDate(currentExercice.dateStart)} → {fmtDate(currentExercice.dateEnd)}
                  </span>
                )}
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={openEditExercice}
                  title="Modifier l'exercice"
                  style={{
                    borderColor: "color-mix(in srgb, var(--accent) 40%, transparent)",
                    color: "var(--accent)",
                    padding: "0 .3rem",
                    fontSize: ".62rem",
                    height: 17,
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  ✏️
                </button>
                {/* Corbeille masquée si l'exercice a des périodes : suppression interdite. */}
                {!currentExerciceHasPeriods && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={deleteExercice}
                    disabled={pending}
                    title="Supprimer l'exercice"
                    style={{
                      borderColor: "rgba(220,80,80,.4)",
                      color: "#e05555",
                      padding: "0 .5rem",
                      fontSize: ".62rem",
                      height: 17,
                      display: "inline-flex",
                      alignItems: "center",
                    }}
                  >
                    🗑️
                  </button>
                )}
              </div>
            )}

            {/* Ligne 3 : « Affiché aux utilisateurs » — l'UNIQUE exercice du service
                accessible côté usager (cocher décoche l'exercice précédemment visible).
                Hauteur 17px alignée sur la ligne « Après-midi » d'en face. */}
            {currentExercice && (
              <label
                title="Un seul exercice par service peut être affiché : c'est celui que voient les utilisateurs dans Réservations."
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: ".3rem",
                  cursor: "pointer",
                  fontSize: ".62rem",
                  fontWeight: 500,
                  width: "fit-content",
                  height: 17,
                  marginTop: ".3rem",
                }}
              >
                <input
                  type="checkbox"
                  className="admin-cb"
                  checked={visibleExerciceId === currentExercice.id}
                  onChange={(e) => toggleVisibleToUsers(e.target.checked)}
                  disabled={pending}
                  style={{ accentColor: "var(--accent)", width: 13, height: 13 }}
                />
                Affiché aux utilisateurs
              </label>
            )}
          </div>

          <div className="pr-editor">
            {/* Sous-titre discret entre « Exercices » et le tableau des périodes,
                suffixé du libellé de l'exercice affiché. marginTop = somme des espaces
                de la colonne d'en face sous « Après-midi » (gap .5rem + ligne de statut
                .75rem + marge .9rem) → aligné sur « Jours d'ouverture … ». */}
            <div
              className="panel-subtitle"
              style={{
                fontSize: ".85rem",
                fontWeight: 500,
                marginTop: "calc(.5rem + .75rem + .9rem)",
              }}
            >
              Périodes{exerciceLabel !== "—" ? ` ${exerciceLabel}` : ""}
            </div>
            {visiblePeriods.length > 0 ? (
              <table className="periods-table">
                <thead>
                  <tr>
                    <th style={{ width: 18 }}>
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
                    <th className="td-left">Libellé</th>
                    <th>Début</th>
                    <th>Fin</th>
                    <th title="Date d'ouverture des réservations côté usager — vide : réservable sans restriction">
                      Dispo
                    </th>
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
                      <td>{fmtDateShort(p.dateStart)}</td>
                      <td>{fmtDateShort(p.dateEnd)}</td>
                      {/* Lecture seule : la valeur se modifie via la modale (✏️ Modifier). */}
                      <td title="Date d'ouverture des réservations côté usager — vide : réservable sans restriction. Modifiable via ✏️ Modifier.">
                        {fmtDateShort(p.disponibilite)}
                      </td>
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

          {/* Bouton « Ajouter » + actions de sélection : sous le tableau, dans la colonne
              gauche (largeur du tableau, ne s'étend pas sous « Plages horaires »). */}
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
        </div>
        {/* Plages horaires : à droite du tableau, bascule dessous quand la place manque.
            Les réglages appartiennent à l'exercice → bloc masqué sans exercice. */}
        {/* marginTop : aligne « Plages horaires … » sur la ligne « Exercice ◀ … ▶ »
            de la colonne gauche (même décalage que le bloc de navigation). */}
        {currentExercice && (
          <div className="pr-hours" style={{ marginTop: "2rem" }}>
            <div
              className="panel-subtitle"
              style={{ fontSize: ".85rem", fontWeight: 500, whiteSpace: "nowrap" }}
            >
              Plages horaires{exerciceLabel !== "—" ? ` ${exerciceLabel}` : ""}
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
                  compact
                  value={morningStart}
                  onChange={(v) => {
                    hoursTouchedRef.current = true;
                    setOpeningSaved(false);
                    setMorningStart(v);
                  }}
                />
                <TimeStepper
                  compact
                  value={morningEnd}
                  onChange={(v) => {
                    hoursTouchedRef.current = true;
                    setOpeningSaved(false);
                    setMorningEnd(v);
                  }}
                />
                <span style={timeLabelStyle}>Après-midi</span>
                <TimeStepper
                  compact
                  value={afternoonStart}
                  onChange={(v) => {
                    hoursTouchedRef.current = true;
                    setOpeningSaved(false);
                    setAfternoonStart(v);
                  }}
                />
                <TimeStepper
                  compact
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
                style={{ display: "flex", alignItems: "center", gap: ".5rem", minHeight: ".75rem" }}
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

            {/* ── Jours d'ouverture : même colonne, sous les plages horaires ── */}
            <div
              className="panel-subtitle"
              style={{ fontSize: ".85rem", fontWeight: 500, marginTop: ".9rem" }}
            >
              Jours d&apos;ouverture{exerciceLabel !== "—" ? ` ${exerciceLabel}` : ""}
            </div>
            {/* 2 lignes : lundi → vendredi, puis samedi + dimanche + fériés + vacances.
                paddingTop = padding haut des th du tableau d'en face (.25rem) → la ligne
                lun-ven est centrée à la même hauteur que « Coul Étiq Libellé … »
                (padding et non margin : la marge fusionnerait avec celle du sous-titre). */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: ".45rem",
                paddingTop: ".25rem",
              }}
            >
              <div
                style={{ display: "flex", gap: ".55rem", flexWrap: "wrap", alignItems: "center" }}
              >
                {DAYS.slice(0, 5).map((d) => (
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
                    {d.label}
                  </label>
                ))}
              </div>
              <div
                style={{ display: "flex", gap: ".55rem", flexWrap: "wrap", alignItems: "center" }}
              >
                {DAYS.slice(5).map((d) => (
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
                    {d.label}
                  </label>
                ))}
                {/* Séparateur : jours de semaine ↔ fériés / vacances. */}
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
                  Vacances
                </label>
              </div>
            </div>

            {/* ── Maximums de réservation : même colonne, sous les jours d'ouverture.
                Par usager, portés par l'EXERCICE (« par an » = sur l'exercice). */}
            <div
              className="panel-subtitle"
              style={{ fontSize: ".85rem", fontWeight: 500, marginTop: "2.15rem" }}
            >
              Réservations maxi{exerciceLabel !== "—" ? ` ${exerciceLabel}` : ""}
            </div>
            {/* Une ligne par compteur (− n + libellé), interligne calé sur celui des
                jours d'ouverture (.45rem). */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                columnGap: "1rem",
                rowGap: ".45rem",
              }}
            >
              <MaxStepper
                label="par période"
                value={maxReservationsPeriod}
                onMinus={() => stepMaxima("maxReservationsPeriod", -1)}
                onPlus={() => stepMaxima("maxReservationsPeriod", 1)}
              />
              <MaxStepper
                label="par an"
                value={maxReservations}
                onMinus={() => stepMaxima("maxReservations", -1)}
                onPlus={() => stepMaxima("maxReservations", 1)}
              />
            </div>
          </div>
        )}
      </div>

      {listError && (
        <div className="field-error" style={{ display: "block", marginBottom: ".75rem" }}>
          {listError}
        </div>
      )}

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
                <div style={{ display: "flex", gap: "1rem", opacity: exoFieldsLocked ? 0.5 : 1 }}>
                  {(["scolaire", "civile"] as ExerciceType[]).map((t) => (
                    <label
                      key={t}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: ".35rem",
                        cursor: exoFieldsLocked ? "not-allowed" : "pointer",
                      }}
                    >
                      <input
                        type="radio"
                        name="exo-type"
                        checked={exoForm.type === t}
                        onChange={() => changeExoType(t)}
                        disabled={exoFieldsLocked}
                      />
                      <span style={{ fontSize: ".75rem" }}>
                        {t === "scolaire" ? "Année scolaire" : "Année civile"}
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
              {exoFieldsLocked && (
                <p style={{ fontSize: ".72rem", color: "var(--muted)", margin: 0 }}>
                  Cet exercice a des périodes : seul le libellé est modifiable.
                </p>
              )}
              <div style={{ display: "flex", gap: ".75rem", opacity: exoFieldsLocked ? 0.5 : 1 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: ".25rem", flex: 1 }}>
                  <span style={{ fontSize: ".75rem", color: "var(--muted)" }}>Début</span>
                  <input
                    type="date"
                    value={exoForm.dateStart}
                    onChange={(e) => setExoForm((f) => ({ ...f, dateStart: e.target.value }))}
                    disabled={exoFieldsLocked}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: ".25rem", flex: 1 }}>
                  <span style={{ fontSize: ".75rem", color: "var(--muted)" }}>Fin</span>
                  <input
                    type="date"
                    value={exoForm.dateEnd}
                    onChange={(e) => setExoForm((f) => ({ ...f, dateEnd: e.target.value }))}
                    disabled={exoFieldsLocked}
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
              <label style={{ display: "flex", flexDirection: "column", gap: ".25rem" }}>
                <span style={{ fontSize: ".75rem", color: "var(--muted)" }}>
                  Disponibilité — ouverture des réservations côté usager (vide : réservable sans
                  restriction)
                </span>
                <input
                  type="date"
                  value={form.disponibilite}
                  onChange={(e) => setForm((f) => ({ ...f, disponibilite: e.target.value }))}
                />
              </label>
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

/** Compteur « − n + » des maximums de réservation (repris du panneau Réservations,
 *  dont le bloc a déménagé ici — portée par exercice). Minimum 1.
 *  Compteur À GAUCHE du libellé, sur une seule ligne, en taille réduite. */
function MaxStepper({
  label,
  value,
  onMinus,
  onPlus,
}: {
  label: string;
  value: number;
  onMinus: () => void;
  onPlus: () => void;
}) {
  const round: React.CSSProperties = {
    width: 14,
    height: 14,
    borderRadius: "50%",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    fontSize: ".68rem",
    lineHeight: 1,
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
      <button
        type="button"
        className="btn btn-ghost"
        style={round}
        onClick={onMinus}
        disabled={value <= 1}
        aria-label={`${label} : diminuer`}
      >
        −
      </button>
      <span
        style={{
          fontSize: ".82rem",
          fontWeight: 700,
          color: "var(--warn)",
          minWidth: "1.5ch",
          textAlign: "center",
        }}
      >
        {value}
      </span>
      <button
        type="button"
        className="btn btn-ghost"
        style={round}
        onClick={onPlus}
        aria-label={`${label} : augmenter`}
      >
        +
      </button>
      <span style={{ fontSize: ".78rem", color: "var(--muted)" }}>{label}</span>
    </div>
  );
}
