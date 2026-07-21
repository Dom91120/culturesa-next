"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ModalOverlay } from "@/components/agenda-shared";
import { TimeStepper } from "@/components/time-stepper";
import { GHOST_DANGER_STYLE } from "@/components/ui-styles";
import { setShowPreviousExercicesAction } from "../exercice/actions";
import {
  createExerciceAction,
  createPeriodAction,
  deleteExerciceAction,
  deletePeriodAction,
  saveExerciceBookingDelayAction,
  saveExerciceMaximaAction,
  saveOpeningConfigAction,
  setExerciceVisibleAction,
  updateExerciceAction,
  updatePeriodAction,
} from "./actions";

type ExerciceType = "civile" | "scolaire";

export type UiPeriod = {
  id: number;
  label: string;
  etiquette: string | null;
  dateStart: string; // "YYYY-MM-DD" ou ""
  dateEnd: string;
  // Ouverture des réservations usager ("YYYY-MM-DD" ou "" = toujours ouvert).
  disponibilite: string;
  color: string;
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
  // Délai limite de réservation (porté par l'exercice, encodage legacy).
  bookingDelay: number;
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
  activeDays: ["lun", "mar", "mer", "jeu", "ven"],
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

// Jours de semaine toujours ouverts : cases cochées et verrouillées (non décochables).
// Seuls le samedi et le dimanche restent optionnels.
const LOCKED_DAYS = ["lun", "mar", "mer", "jeu", "ven"];
// Garantit que les jours verrouillés sont toujours présents dans la valeur persistée,
// en préservant l'ordre de DAYS (les week-ends éventuels conservés).
const withLockedDays = (days: string[]): string[] =>
  DAYS.map((d) => d.key).filter((k) => LOCKED_DAYS.includes(k) || days.includes(k));

// « Délai limite de réservation » (porté par l'exercice) : délai minimum avant une séance.
// Négatif = jours ouvrés, ≥1000 = calendaire (encodage legacy, cf. lib/booking-delay).
const BOOKING_DELAY_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Aucun délai" },
  { value: -1, label: "1 jour ouvré" },
  { value: -2, label: "2 jours ouvrés" },
  { value: -3, label: "3 jours ouvrés" },
  { value: 1007, label: "1 semaine" },
  { value: 1014, label: "2 semaines" },
  { value: 1021, label: "3 semaines" },
  { value: 1030, label: "1 mois" },
];

// Champ select « Délai de réservation » (calé sur le style des inputs horaires compacts).
const delaySelectStyle: React.CSSProperties = {
  height: 21,
  boxSizing: "border-box",
  fontSize: ".78rem",
  fontWeight: 400,
  padding: "0 .35rem",
  borderRadius: "var(--rad-sm)",
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text)",
};

/** Style des sous-panels (fond --surface2, bordure, coins arrondis), calqué sur l'onglet
 *  Configuration. Le panel conteneur (--surface1) les empile. */
const SUB_PANEL: React.CSSProperties = {
  background: "var(--surface2)",
  border: "1px solid var(--border)",
  borderRadius: "var(--rad-sm)",
  padding: "1.25rem",
};

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

/** « 2025-09-01 » → « 01/09/2025 » (JJ/MM/AAAA, format legacy fr-FR). */
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

  // ── Délai limite de réservation — PAR EXERCICE (comme les maximums). ─────────
  const [bookingDelay, setBookingDelay] = useState(currentExercice?.bookingDelay ?? 0);
  const [bookingSaved, setBookingSaved] = useState(false);
  function saveBookingDelay(value: number) {
    if (currentExerciceId == null) return;
    const exerciceId = currentExerciceId;
    setBookingDelay(value);
    setListError(null);
    setBookingSaved(false);
    startTransition(async () => {
      const res = await saveExerciceBookingDelayAction({
        serviceId,
        exerciceId,
        bookingDelay: value,
      });
      if (res && !res.ok) {
        setListError(res.error ?? "Échec de l'enregistrement.");
        return;
      }
      setBookingSaved(true);
      window.setTimeout(() => setBookingSaved(false), 1800);
      router.refresh();
    });
  }

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
    // Règle : « par an » ≤ « par période » × nombre de périodes de l'exercice. Baisser
    // « par période » abaisse le plafond → on rabote « par an » ; augmenter « par an »
    // est déjà borné (bouton + désactivé au plafond).
    const nbPeriods = visiblePeriods.length;
    if (nbPeriods > 0) {
      next.maxReservations = Math.min(next.maxReservations, next.maxReservationsPeriod * nbPeriods);
    }
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
    // Délai limite de réservation de l'exercice affiché.
    setBookingDelay(currentExercice?.bookingDelay ?? 0);
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
        // Les jours de semaine sont toujours ouverts (cases verrouillées) : on force leur
        // présence dans la valeur persistée, quel que soit l'état côté client.
        activeDays: withLockedDays(overrides.activeDays ?? activeDays) as (
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
    <section className="panel">
      {/* En-tête (dans le panel parent, AU-DESSUS des sous-panels) : navigation d'exercice,
          visibilité usagers et gestion des exercices précédents. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: ".3rem",
          margin: ".75rem 0 1.75rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "2.5rem", flexWrap: "wrap" }}>
          <div className="pr-head" style={{ minHeight: "calc(.85rem * 1.5)" }}>
            {/* « Exercice » comme titre du panneau (style panel-title : pastille + .95rem). */}
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: ".5rem",
                fontSize: ".95rem",
                fontWeight: 300,
                letterSpacing: "-.01em",
              }}
            >
              <span className="dot" style={{ background: "var(--warn)" }} />
              Exercice
            </span>
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
            {currentExercice && (
              <>
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
                {!currentExerciceHasPeriods && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={deleteExercice}
                    disabled={pending}
                    title="Supprimer l'exercice"
                    style={{
                      ...GHOST_DANGER_STYLE,
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
              </>
            )}
          </div>
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
                  setShowPrevious(next);
                  setListError(null);
                  startTransition(async () => {
                    const res = await setShowPreviousExercicesAction(serviceId, next);
                    if (res && !res.ok) {
                      setShowPrevious(!next);
                      setListError(res.error ?? "Échec de l'enregistrement.");
                      return;
                    }
                    router.refresh();
                  });
                }}
              />{" "}
              Gérer les exercices précédents
            </label>
          )}
        </div>
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
              // Aligné sur le texte « Exercice » : décalage = pastille (8px) + gap (.5rem).
              marginLeft: "calc(8px + .5rem)",
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
            Afficher aux utilisateurs
          </label>
        )}
      </div>

      {/* Deux sous-panels (--surface2), à la manière de l'onglet Configuration. */}
      <div style={{ display: "flex", flexDirection: "column", gap: ".85rem" }}>
        <section style={SUB_PANEL}>
          {/* ── Colonne du sous-panel « Périodes ». L'ordre d'AFFICHAGE est piloté par la
          propriété `order` de chaque section (l'ordre du DOM diffère) :
          2 Périodes · 3 Jours d'ouverture · 4 Plages horaires. ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1.6rem" }}>
            {/* ── Plages horaires (exercice affiché). ── */}
            {currentExercice && (
              <div style={{ order: 4 }}>
                <div className="panel-subtitle" style={{ fontSize: ".85rem", fontWeight: 500 }}>
                  Plages horaires{exerciceLabel !== "—" ? ` ${exerciceLabel}` : ""}
                </div>
                {/* Matin, Après-midi et le statut d'auto-save sur une seule ligne. Le statut
                n'est rendu que s'il a quelque chose à dire → aucune ligne réservée quand
                inactif (espaces homogènes entre les sections). */}
                <div
                  className="defaults-row"
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    columnGap: "1.5rem",
                    rowGap: ".3rem",
                    margin: 0,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
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
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
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
                  {(openingError || pending || openingSaved) && (
                    <span
                      style={{
                        fontSize: ".78rem",
                        whiteSpace: "nowrap",
                        color: openingError
                          ? "var(--danger)"
                          : pending
                            ? "var(--muted)"
                            : "var(--accent)",
                      }}
                    >
                      {openingError ? openingError : pending ? "Enregistrement…" : "✓ Enregistré"}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* ── Jours d'ouverture (exercice affiché). ── */}
            {currentExercice && (
              <div style={{ order: 3 }}>
                <div className="panel-subtitle" style={{ fontSize: ".85rem", fontWeight: 500 }}>
                  Jours d&apos;ouverture{exerciceLabel !== "—" ? ` ${exerciceLabel}` : ""}
                </div>
                {/* Tous les jours + fériés + vacances scolaires sur une seule ligne (repli
                automatique si la largeur manque). */}
                <div
                  style={{ display: "flex", gap: ".55rem", flexWrap: "wrap", alignItems: "center" }}
                >
                  {DAYS.map((d) => {
                    // Jours de semaine : toujours cochés et verrouillés (non décochables).
                    const locked = LOCKED_DAYS.includes(d.key);
                    return (
                      <label
                        key={d.key}
                        title={locked ? `${d.full} (toujours ouvert)` : d.full}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: ".3rem",
                          cursor: locked ? "default" : "pointer",
                          fontSize: ".62rem",
                          fontWeight: 500,
                        }}
                      >
                        <input
                          type="checkbox"
                          className="admin-cb"
                          checked={locked || activeDays.includes(d.key)}
                          disabled={locked}
                          onChange={() => {
                            if (!locked) toggleDay(d.key);
                          }}
                          style={{ accentColor: "var(--accent)", width: 13, height: 13 }}
                        />
                        {d.full}
                      </label>
                    );
                  })}
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
                    Vacances scolaires
                  </label>
                </div>
              </div>
            )}

            {/* ── Périodes : tableau + barre d'ajout / actions. ── */}
            <div style={{ order: 2 }}>
              <div className="panel-subtitle" style={{ fontSize: ".85rem", fontWeight: 500 }}>
                Périodes{exerciceLabel !== "—" ? ` ${exerciceLabel}` : ""}
              </div>
              {/* Largeur calée sur le tableau (fit-content) → la barre « Ajouter » s'aligne à
              droite DU TABLEAU, pas du panneau. */}
              <div style={{ width: "fit-content", maxWidth: "100%" }}>
                <div style={{ overflowX: "auto", maxWidth: "100%" }}>
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
                            Disponibilité
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {visiblePeriods.map((p) => (
                          <tr key={p.id}>
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
                            {/* Lecture seule : la valeur se modifie via la modale (✏️ Modifier). */}
                            <td title="Date d'ouverture des réservations côté usager — vide : réservable sans restriction. Modifiable via ✏️ Modifier.">
                              {fmtDate(p.disponibilite)}
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

                {/* Bouton « Ajouter » + actions de sélection, sous le tableau. */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: ".5rem",
                    marginTop: ".5rem",
                    flexWrap: "wrap",
                  }}
                >
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
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={deleteSelected}
                        disabled={pending}
                        style={{
                          ...GHOST_DANGER_STYLE,
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
            </div>
          </div>

          {listError && (
            <div className="field-error" style={{ display: "block", marginBottom: ".75rem" }}>
              {listError}
            </div>
          )}
        </section>

        {/* ── Sous-panel « Réservations » : maximums (par exercice) + délai limite (service). ── */}
        <section style={SUB_PANEL}>
          <div style={{ display: "flex", flexDirection: "column", gap: "1.6rem" }}>
            {/* ── Réservations maxi (exercice affiché). Par usager, portés par l'EXERCICE. ── */}
            {currentExercice && (
              <div style={{ order: 5 }}>
                <div className="panel-subtitle" style={{ fontSize: ".85rem", fontWeight: 500 }}>
                  Réservations maxi{exerciceLabel !== "—" ? ` ${exerciceLabel}` : ""}
                </div>
                {/* Une ligne par compteur (− n + libellé). */}
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
                  {/* Plafond « par an » = « par période » × nb périodes de l'exercice. */}
                  <MaxStepper
                    label="par an"
                    value={maxReservations}
                    onMinus={() => stepMaxima("maxReservations", -1)}
                    onPlus={() => stepMaxima("maxReservations", 1)}
                    max={
                      visiblePeriods.length > 0
                        ? maxReservationsPeriod * visiblePeriods.length
                        : undefined
                    }
                  />
                </div>
              </div>
            )}

            {/* ── Délai limite de réservation (exercice affiché). ── */}
            {currentExercice && (
              <div style={{ order: 6 }}>
                <div className="panel-subtitle" style={{ fontSize: ".85rem", fontWeight: 500 }}>
                  Délai limite de réservation{exerciceLabel !== "—" ? ` ${exerciceLabel}` : ""}
                </div>
                <label
                  title="Délai minimum avant une séance"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: ".6rem",
                    fontSize: ".62rem",
                    flexWrap: "wrap",
                    minHeight: 21,
                  }}
                >
                  Délai
                  <select
                    value={bookingDelay}
                    onChange={(e) => saveBookingDelay(Number(e.target.value))}
                    style={delaySelectStyle}
                  >
                    {BOOKING_DELAY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {bookingSaved && (
                    <span style={{ fontSize: ".78rem", color: "var(--accent)" }}>✓ Enregistré</span>
                  )}
                </label>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* ── Modale exercice (création / édition) ───────────────────────────── */}
      {exoModalOpen && (
        <ModalOverlay
          onClose={() => setExoModalOpen(false)}
          dismissOnBackdrop={false}
          labelledBy="exo-modal-title"
        >
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
        </ModalOverlay>
      )}

      {/* ── Modale de confirmation de suppression d'un exercice (--danger) ───── */}
      {confirmDeleteExo && currentExercice && (
        <ModalOverlay
          onClose={() => setConfirmDeleteExo(false)}
          boxStyle={{ maxWidth: 460, width: "95vw" }}
        >
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
          <button type="button" className="modal-close" onClick={() => setConfirmDeleteExo(false)}>
            ×
          </button>
        </ModalOverlay>
      )}

      {/* ── Modale de confirmation de suppression de période(s) (--danger) ───── */}
      {confirmDeletePeriods && selectedCount > 0 && (
        <ModalOverlay
          onClose={() => setConfirmDeletePeriods(false)}
          boxStyle={{ maxWidth: 460, width: "95vw" }}
        >
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
        </ModalOverlay>
      )}

      {/* ── Modale création / édition ──────────────────────────────────────── */}
      {modalOpen && (
        <ModalOverlay
          onClose={closeModal}
          dismissOnBackdrop={false}
          labelledBy="period-modal-title"
        >
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
        </ModalOverlay>
      )}
    </section>
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
  max,
}: {
  label: string;
  value: number;
  onMinus: () => void;
  onPlus: () => void;
  /** Plafond : au-delà (value ≥ max), le bouton + est désactivé. */
  max?: number;
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
        disabled={max != null && value >= max}
        aria-label={`${label} : augmenter`}
      >
        +
      </button>
      <span style={{ fontSize: ".78rem", color: "var(--muted)" }}>{label}</span>
    </div>
  );
}
