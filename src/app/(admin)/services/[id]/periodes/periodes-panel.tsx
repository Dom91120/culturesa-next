"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ModalOverlay } from "@/components/agenda-shared";
import { Switch } from "@/components/switch";
import { TimeStepper } from "@/components/time-stepper";
import {
  AlertGlyph,
  CalendarTimeGlyph,
  CircleCheckGlyph,
  ClockGlyph,
  HistoryGlyph,
  HourglassGlyph,
  InfoGlyph,
  TargetGlyph,
} from "@/components/ui-glyphs";
import { GHOST_DANGER_STYLE } from "@/components/ui-styles";
import { PencilGlyph, TrashGlyph, UsersGlyph } from "../../../users/account-ui";
import { GlobalRow } from "../config/global-row";
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

// Bouton d'action (même style que « ＋ Ajouter un type » d'Échanges).
const actBtn: React.CSSProperties = {
  padding: ".18rem .55rem",
  fontSize: ".66rem",
  display: "inline-flex",
  alignItems: "center",
  gap: ".35rem",
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

  // Pastille d'état du titre : autosaves (ouverture, maximums, délai) + erreurs de liste.
  const statusError = openingError ?? listError;
  const statusSaved = openingSaved || bookingSaved;
  const suffix = exerciceLabel !== "—" ? ` ${exerciceLabel}` : "";

  return (
    <div className="panel">
      {/* Titre : pictogramme, navigation d'exercice ◀ ▶, dates, actions ; à droite,
          la pastille d'état des enregistrements automatiques. */}
      <div
        className="panel-title"
        style={{
          justifyContent: "space-between",
          gap: ".75rem",
          marginBottom: ".5rem",
          flexWrap: "wrap",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: ".6rem", flexWrap: "wrap" }}>
          <span className="rg-ico is-ok">
            <CalendarTimeGlyph size={16} />
          </span>
          Exercice
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
            <span style={{ color: "var(--muted)", fontWeight: 400 }}>· aucun exercice</span>
          )}
          {currentExercice && (currentExercice.dateStart || currentExercice.dateEnd) && (
            <span style={{ color: "var(--muted)", fontWeight: 400, whiteSpace: "nowrap" }}>
              · {currentExercice.type === "civile" ? "année civile" : "année scolaire"} ·{" "}
              {fmtDate(currentExercice.dateStart)} → {fmtDate(currentExercice.dateEnd)}
            </span>
          )}
          {currentExercice && (
            <span className="ms-acts" style={{ opacity: 1 }}>
              <button
                type="button"
                className="acct-action"
                onClick={openEditExercice}
                title="Modifier l'exercice"
                aria-label="Modifier l'exercice"
              >
                <PencilGlyph size={14} />
              </button>
              {!currentExerciceHasPeriods && (
                <button
                  type="button"
                  className="acct-action is-danger"
                  onClick={deleteExercice}
                  disabled={pending}
                  title="Supprimer l'exercice"
                  aria-label="Supprimer l'exercice"
                >
                  <TrashGlyph size={14} />
                </button>
              )}
            </span>
          )}
          {!hasExercices && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={openCreateExercice}
              style={{
                ...actBtn,
                borderColor: "color-mix(in srgb, var(--warn) 45%, transparent)",
                color: "var(--warn)",
              }}
            >
              ＋ Nouvel exercice
            </button>
          )}
        </span>
        <span className="acct-toolbar-right">
          <span
            className={`acct-pill ${statusError ? "role-administrateur" : pending ? "is-warn" : "is-ok"}`}
            style={{
              opacity: statusError || pending || statusSaved ? 1 : 0,
              transition: "opacity .25s",
            }}
            aria-live="polite"
          >
            {statusError ? (
              <AlertGlyph size={12} strokeWidth={2.2} />
            ) : (
              <CircleCheckGlyph size={12} strokeWidth={2.2} />
            )}{" "}
            {statusError ? statusError : pending ? "Enregistrement…" : "Enregistré"}
          </span>
        </span>
      </div>

      {/* ── Exercice : visibilité usagers, navigation dans les exercices passés. ── */}
      {hasExercices && (
        <>
          <div className="ms-grp cfg-grp">
            Exercice{suffix}
            <span className="hint">· visibilité et navigation</span>
          </div>
          {currentExercice && (
            <GlobalRow
              icon={
                <span className="rg-ico is-ok">
                  <UsersGlyph size={14} />
                </span>
              }
              label="Afficher aux utilisateurs"
              desc="Un seul exercice par service peut être affiché : c'est celui que voient les utilisateurs dans Réservations. L'activer ici désactive l'exercice précédemment affiché."
            >
              <Switch
                on={visibleExerciceId === currentExercice.id}
                onChange={toggleVisibleToUsers}
              />
            </GlobalRow>
          )}
          <GlobalRow
            icon={
              <span className="rg-ico is-neutral">
                <HistoryGlyph size={14} />
              </span>
            }
            label="Gérer les exercices précédents"
            desc="Garde les exercices passés accessibles par les flèches ◀ ▶ du titre, pour consulter ou corriger leurs réglages."
          >
            <Switch
              on={showPrevious}
              onChange={(next) => {
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
            />
          </GlobalRow>
        </>
      )}

      {/* ── Périodes : tableau + sélection / ajout. ── */}
      <div className="ms-grp cfg-grp">
        Périodes{suffix}
        <span className="hint">· découpage de l'exercice, dates et ouverture des réservations</span>
      </div>
      {visiblePeriods.length > 0 ? (
        <>
          <div className="cfg-phead">
            <span>
              <input
                type="checkbox"
                className="admin-cb"
                checked={allChecked}
                ref={(el) => {
                  if (el) el.indeterminate = someChecked;
                }}
                onChange={(e) => toggleSelectAll(e.target.checked)}
                title="Tout sélectionner"
                style={{ width: 13, height: 13, accentColor: "var(--accent)" }}
              />
            </span>
            <span>Coul</span>
            <span>Étiq</span>
            <span>Libellé</span>
            <span>Début</span>
            <span>Fin</span>
            <span title="Date d'ouverture des réservations côté usager — vide : réservable sans restriction">
              Disponibilité
            </span>
          </div>
          {visiblePeriods.map((p) => (
            <div key={p.id} className={`cfg-prow${selected.has(p.id) ? " is-selected" : ""}`}>
              <span>
                <input
                  type="checkbox"
                  className="admin-cb"
                  checked={selected.has(p.id)}
                  onChange={() => toggleSelect(p.id)}
                  style={{ width: 13, height: 13, accentColor: "var(--accent)" }}
                />
              </span>
              <span>
                <span className="period-swatch" style={{ background: p.color || "#6dceaa" }} />
              </span>
              <span>{p.etiquette || "—"}</span>
              <span className="ex-knm" style={{ minWidth: 0 }}>
                {p.label || "—"}
              </span>
              <span>{fmtDate(p.dateStart)}</span>
              <span>{fmtDate(p.dateEnd)}</span>
              {/* Lecture seule : la valeur se modifie via la modale (Modifier). */}
              <span title="Date d'ouverture des réservations côté usager — vide : réservable sans restriction. Modifiable via « Modifier ».">
                {fmtDate(p.disponibilite)}
              </span>
            </div>
          ))}
        </>
      ) : (
        <div
          style={{
            padding: ".6rem .5rem",
            fontSize: ".78rem",
            color: "var(--muted)",
            fontStyle: "italic",
          }}
        >
          Aucune période définie.
        </div>
      )}
      {/* Actions de sélection à gauche, ajout à droite, sous le tableau. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: ".5rem",
          padding: ".5rem .5rem 0",
          flexWrap: "wrap",
        }}
      >
        {selectedCount > 0 && (
          <>
            <span style={{ fontSize: ".74rem", color: "var(--muted)" }}>
              {selectedCount} sélectionnée{selectedCount > 1 ? "s" : ""}
            </span>
            {selectedCount === 1 && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={openEdit}
                style={{
                  ...actBtn,
                  borderColor: "color-mix(in srgb, var(--accent) 40%, transparent)",
                  color: "var(--accent)",
                }}
              >
                <PencilGlyph size={12} /> Modifier
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={deleteSelected}
              disabled={pending}
              style={{ ...actBtn, ...GHOST_DANGER_STYLE }}
            >
              <TrashGlyph size={12} /> Supprimer
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
            ...actBtn,
            marginLeft: "auto",
            opacity: hasExercices ? 1 : 0.5,
            cursor: hasExercices ? "pointer" : "not-allowed",
          }}
        >
          ＋ Ajouter une période
        </button>
      </div>
      {listError && (
        <div className="field-error" style={{ display: "block", margin: ".5rem .5rem 0" }}>
          {listError}
        </div>
      )}

      {currentExercice && (
        <>
          {/* ── Jours d'ouverture (exercice affiché). ── */}
          <div className="ms-grp cfg-grp">
            Jours d'ouverture{suffix}
            <span className="hint">· jours réservables de la semaine</span>
          </div>
          <GlobalRow
            icon={
              <span className="rg-ico is-ok">
                <CalendarTimeGlyph size={14} />
              </span>
            }
            label="Jours de la semaine"
            desc="Du lundi au vendredi, le service est toujours ouvert ; le samedi et le dimanche sont au choix."
          >
            <div className="cfg-chips">
              {DAYS.map((d) => {
                // Jours de semaine : toujours ouverts et verrouillés (non décochables).
                const locked = LOCKED_DAYS.includes(d.key);
                const on = locked || activeDays.includes(d.key);
                return (
                  <button
                    key={d.key}
                    type="button"
                    aria-pressed={on}
                    disabled={locked}
                    title={locked ? `${d.full} (toujours ouvert)` : d.full}
                    className={`acct-chip${on ? " is-on" : ""}${locked ? " cfg-chip-locked" : ""}`}
                    onClick={() => {
                      if (!locked) toggleDay(d.key);
                    }}
                  >
                    {d.full}
                  </button>
                );
              })}
            </div>
          </GlobalRow>
          <GlobalRow
            icon={
              <span className="rg-ico is-warn">
                <CalendarTimeGlyph size={14} />
              </span>
            }
            label="Jours fériés"
            desc="Les jours fériés sont réservables ; désactivé, ils sont fermés dans l'agenda et les réservations."
          >
            <Switch
              on={openOnHolidays}
              onChange={(v) => {
                setOpenOnHolidays(v);
                persistOpening({ openOnHolidays: v });
              }}
            />
          </GlobalRow>
          <GlobalRow
            icon={
              <span className="rg-ico is-warn">
                <CalendarTimeGlyph size={14} />
              </span>
            }
            label="Vacances scolaires"
            desc="Les jours de vacances scolaires sont réservables ; désactivé, ils sont hachurés et non réservables (agenda et réservations)."
          >
            <Switch
              on={openOnSchoolHolidays}
              onChange={(v) => {
                setOpenOnSchoolHolidays(v);
                persistOpening({ openOnSchoolHolidays: v });
              }}
            />
          </GlobalRow>

          {/* ── Plages horaires (exercice affiché). ── */}
          <div className="ms-grp cfg-grp">
            Plages horaires{suffix}
            <span className="hint">· demi-journées proposées à la réservation</span>
          </div>
          <GlobalRow
            icon={
              <span className="rg-ico is-ok">
                <ClockGlyph size={14} />
              </span>
            }
            label="Matin"
            desc="Début et fin de la demi-journée du matin."
          >
            <div className="cfg-ctl">
              <TimeStepper
                compact
                value={morningStart}
                onChange={(v) => {
                  hoursTouchedRef.current = true;
                  setOpeningSaved(false);
                  setMorningStart(v);
                }}
              />
              <span style={{ fontSize: ".74rem", color: "var(--muted)" }}>→</span>
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
          </GlobalRow>
          <GlobalRow
            icon={
              <span className="rg-ico is-ok">
                <ClockGlyph size={14} />
              </span>
            }
            label="Après-midi"
            desc="Début et fin de la demi-journée de l'après-midi."
          >
            <div className="cfg-ctl">
              <TimeStepper
                compact
                value={afternoonStart}
                onChange={(v) => {
                  hoursTouchedRef.current = true;
                  setOpeningSaved(false);
                  setAfternoonStart(v);
                }}
              />
              <span style={{ fontSize: ".74rem", color: "var(--muted)" }}>→</span>
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
          </GlobalRow>

          {/* ── Réservations : maximums (par exercice) + délai limite. ── */}
          <div className="ms-grp cfg-grp">
            Réservations{suffix}
            <span className="hint">· plafonds par usager et délai avant une séance</span>
          </div>
          <GlobalRow
            icon={
              <span className="rg-ico is-info">
                <TargetGlyph size={14} />
              </span>
            }
            label="Réservations maxi par période"
            desc="Nombre maximal de réservations d'un même usager sur une période."
          >
            <MaxStepper
              label="par période"
              value={maxReservationsPeriod}
              onMinus={() => stepMaxima("maxReservationsPeriod", -1)}
              onPlus={() => stepMaxima("maxReservationsPeriod", 1)}
            />
          </GlobalRow>
          {/* Plafond « par an » = « par période » × nb périodes de l'exercice. */}
          <GlobalRow
            icon={
              <span className="rg-ico is-info">
                <TargetGlyph size={14} />
              </span>
            }
            label="Réservations maxi par an"
            desc="Plafond sur tout l'exercice, au plus « par période » multiplié par le nombre de périodes."
          >
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
          </GlobalRow>
          <GlobalRow
            icon={
              <span className="rg-ico is-neutral">
                <HourglassGlyph size={14} />
              </span>
            }
            label="Délai limite de réservation"
            desc="Délai minimum avant une séance pour pouvoir la réserver."
          >
            <select
              className="cfg-select"
              value={bookingDelay}
              onChange={(e) => saveBookingDelay(Number(e.target.value))}
              aria-label="Délai limite de réservation"
            >
              {BOOKING_DELAY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </GlobalRow>
        </>
      )}

      {/* Pied : rappel du mode d'enregistrement. */}
      <div className="rg-foot" style={{ borderTop: "none", marginTop: "2.05rem", paddingTop: 0 }}>
        <InfoGlyph size={13} />
        <span style={{ flex: 1, lineHeight: 1.45 }}>
          Les réglages de cette page sont enregistrés automatiquement, quelques instants après
          chaque modification ; l'exercice et les périodes se créent et se modifient dans une
          fenêtre dédiée.
        </span>
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
