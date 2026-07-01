"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  AgendaDayBackground,
  AgendaTimeColumn,
  AgendaWeekHeader,
  ModalOverlay,
  PointagePill,
} from "@/components/agenda-shared";
import { AgendaTooltip, useAgendaTooltip } from "@/components/agenda-tooltip";
import {
  type AgendaBlockBase,
  addDays,
  badgeStyle,
  DAY_NAMES,
  DAY_OFFSET,
  dayCap,
  dayKeyFromYmd,
  gridGeometry,
  type LayoutItem,
  layoutOverlaps,
  mondayOf,
  type Pointage,
  parseWeeks,
  ROW_H,
  type Slot,
  shortDateFmt,
  slotWeekTag,
  toMinutes,
  type UniqueSlot,
  ymd,
} from "@/lib/agenda-core";
import { isFrenchHoliday } from "@/lib/french-holidays";
import { gaugeColor, gaugeUnits } from "@/lib/gauge";
import { printHtmlDocument } from "@/lib/print-html";
import { isInSchoolHolidayRange as inSchoolHolidayRange } from "@/lib/school-holidays";
import { useDragInteraction } from "@/lib/use-drag-interaction";
import type { ServiceModes } from "@/server/services/service-modes";
import {
  copyBookingAction,
  copyWeekSlotsAction,
  createRecurringBookingAction,
  createRecurringSlotAction,
  createUniqueBookingAction,
  createUniqueSlotAction,
  cutBookingAction,
  deleteBookingAdminAction,
  deleteSlotAction,
  listAgendaSessionsAction,
  listAgendaUsersAction,
  moveBookingAction,
  moveRecurringSlotAction,
  moveUniqueSlotAction,
  setBookingPointageAction,
  setBookingValidatedAction,
  setServiceDefaultCapacityAction,
} from "./actions";
import { CopyWeekConfirmModal, SlotDeleteModal } from "./agenda-confirm-modals";
import { plural } from "./agenda-format";
import { BookingDeleteModal } from "./booking-delete-modal";
import { BookingDetailModal } from "./booking-detail-modal";
import { DefaultDemandeursModal } from "./default-demandeurs-modal";
import { OccurrencesField } from "./occurrences-field";
import { SlotConfigModal } from "./slot-config-modal";

type Service = {
  id: string;
  label: string;
  activeDays: string;
  morningStart: string;
  morningEnd: string;
  afternoonStart: string;
  afternoonEnd: string;
  capacity: number;
  semaineAb: boolean;
  themesMode: "libre" | "liste";
  openOnHolidays: boolean;
  openOnSchoolHolidays: boolean;
  gaugeAccompagnants: boolean;
};
type Period = {
  id: number;
  label: string;
  etiquette: string;
  color: string;
  dateStart: string;
  dateEnd: string;
  exerciceId: number | null;
};
type Exercice = { id: number; label: string };

export type Booking = {
  id: number;
  slotId: string;
  periodId: number;
  dayKey: string;
  week: string;
  bookingType: string;
  parentBookingId: number | null;
  enfants: number;
  accompagnants: number;
  theme: string;
  validated: boolean;
  pointage: Pointage;
  name: string;
  tel: string;
  email: string;
  demandeur: string;
  structure: string;
};
type UserOpt = {
  id: string;
  label: string;
  demandeur?: string;
  structure?: string;
  openOnSchoolHolidays?: boolean;
};

// Info-bulle d'une réservation au survol — format du legacy _badgeTitle :
//   Tel : <tel>      (si renseigné)
//   <email>
//   <N enfants M adulte(s)>
function badgeTitle(bk: Booking): string {
  const lines: string[] = [];
  if (bk.tel.trim()) lines.push(`Tel : ${bk.tel.trim()}`);
  lines.push(bk.email);
  lines.push(
    `${bk.enfants} enfant${bk.enfants > 1 ? "s" : ""} ${bk.accompagnants} adulte${
      bk.accompagnants > 1 ? "s" : ""
    }`,
  );
  return lines.join("\n");
}

// badgeStyle : partagé via lib/agenda-core (harmonisé entre grilles admin/usager).

// Bloc = UN créneau un jour donné (modèle partagé, cf. lib/agenda-core).
type Block = AgendaBlockBase<Booking>;

type Detail = { booking: Booking } | null;
type CreateCtx = {
  dayKey: string;
  slotId: string;
  // Créneau ponctuel : réservation ponctuelle (pas de période / jour) + date affichée.
  ponctuel?: boolean;
  slotDate?: string;
} | null;

// États des glisser-déposer souris (mode création), pilotés par useDragInteraction.
type CreateDrag = {
  colTop: number;
  startMin: number;
  curMin: number;
  startDay: string;
  curDay: string;
};
type AllDayDrag = { startDay: string; curDay: string };
type MoveDrag = {
  slotId: string;
  isUnique: boolean;
  fromDay: string;
  durationMin: number;
  origMin: number;
  grabOffsetMin: number;
  colTop: number;
  curMin: number;
  curDay: string;
};
type ResizeDrag = {
  slotId: string;
  isUnique: boolean;
  dayKey: string;
  edge: "top" | "bottom";
  fixedMin: number;
  origStart: number;
  origEnd: number;
  colTop: number;
  curStart: number;
  curEnd: number;
};
type HResizeDrag = {
  slotId: string;
  isUnique: boolean;
  startMin: number;
  endMin: number;
  edge: "left" | "right";
  fromDay: string;
  curDay: string;
};

export function AgendaGrid({
  service,
  periods,
  slots,
  uniqueSlots,
  bookings: bookingsRaw,
  themes,
  modes,
  exercices,
  showPrevious,
  slotDemandeurs,
  serviceDemandeurs,
  schoolHolidays,
  autoRefreshSeconds,
}: {
  service: Service;
  periods: Period[];
  slots: Slot[];
  uniqueSlots: UniqueSlot[];
  // Le serveur ne stocke plus dayKey : il est dérivé du slot (slotDay / date).
  bookings: Omit<Booking, "dayKey">[];
  themes: string[];
  modes: ServiceModes;
  exercices: Exercice[];
  showPrevious: boolean;
  // Demandeurs autorisés par créneau (slotId → ids) et liste des demandeurs du service.
  slotDemandeurs: Record<string, number[]>;
  serviceDemandeurs: { id: number; label: string }[];
  // Plages de vacances scolaires (zone configurée) : exclut les occurrences des
  // demandeurs fermés pendant les vacances dans l'aperçu de création.
  schoolHolidays: { dateStart: string; dateEnd: string }[];
  // Intervalle d'auto-rafraîchissement de l'agenda, en secondes (0 = désactivé).
  autoRefreshSeconds: number;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // Le jour (dayKey) d'une réservation se déduit désormais de son créneau : slotDay
  // pour un récurrent, jour de la date pour un ponctuel. (Le champ booking.dayKey a
  // été supprimé en base avec le passage au modèle « un slot = un jour ».)
  const bookings = useMemo<Booking[]>(() => {
    const recurDay = new Map(slots.map((s) => [s.id, s.slotDay ?? ""]));
    const uniqDay = new Map(uniqueSlots.map((s) => [s.id, dayKeyFromYmd(s.slotDate)]));
    return bookingsRaw.map((b) => ({
      ...b,
      dayKey: recurDay.get(b.slotId) ?? uniqDay.get(b.slotId) ?? "",
    }));
  }, [bookingsRaw, slots, uniqueSlots]);
  // Exercice courant : par défaut le plus récent (dernier après tri par libellé).
  const [currentExerciceId, setCurrentExerciceId] = useState<number | null>(
    exercices.length ? exercices[exercices.length - 1].id : null,
  );
  const [periodIdx, setPeriodIdx] = useState(0);
  // Sans demandeur récurrent, le « Modèle de période » n'a pas de sens : on démarre
  // (et on reste) en « Semaine réelle » — le bouton Modèle est masqué (cf. sélecteur).
  const [mode, setMode] = useState<"model" | "realweek">(
    modes.recurringMode ? "model" : "realweek",
  );
  const [anchorMonday, setAnchorMonday] = useState<string | null>(null);
  // Mode "Semaine réelle" : période active verrouillée. Sans ce verrou, on
  // re-dérive la période depuis la semaine à chaque ◀/▶ — et quand une semaine
  // chevauche la frontière de deux périodes contiguës, elle bascule sur la
  // voisine (dont les bornes laissent sortir). Cf. legacy _agendaPeriodUserPicked.
  const [rwPeriodId, setRwPeriodId] = useState<number | null>(null);
  const [weekAB, setWeekAB] = useState<"A" | "B">("A");
  const [hideEmpty, setHideEmpty] = useState(false);
  const [validation, setValidation] = useState(false);
  const [pointageMode, setPointageMode] = useState(false);
  // Mode « Création de créneau » : clic = créneau d'1 quart d'heure ; glisser
  // haut/bas = créneau de plusieurs quarts (validé au relâché). Cf. plus bas.
  const [creationMode, setCreationMode] = useState(false);
  // Capacité appliquée aux créneaux créés en mode création (champ remplaçant la
  // légende). Capacité par défaut UNIQUE du service, autosauvegardée.
  const [capStr, setCapStr] = useState(String(service.capacity));
  const createCap = Math.max(1, Number.parseInt(capStr, 10) || service.capacity);
  const [capSaved, setCapSaved] = useState(false);
  const capSaveTimer = useRef<number | null>(null);
  const capFlashTimer = useRef<number | null>(null);
  // Au démontage : annule les timers en attente (sinon l'autosave débounce part
  // après navigation et le flash « ✓ » fait un setState sur composant démonté).
  useEffect(
    () => () => {
      if (capSaveTimer.current) window.clearTimeout(capSaveTimer.current);
      if (capFlashTimer.current) window.clearTimeout(capFlashTimer.current);
    },
    [],
  );
  // Édition du champ Capacité : met à jour l'état et autosauvegarde (débounce 500 ms)
  // la capacité par défaut du service.
  function onCapChange(v: string) {
    setCapStr(v);
    setCapSaved(false);
    if (capSaveTimer.current) window.clearTimeout(capSaveTimer.current);
    capSaveTimer.current = window.setTimeout(() => {
      const n = Math.max(1, Number.parseInt(v, 10) || service.capacity);
      startTransition(async () => {
        const res = await setServiceDefaultCapacityAction({
          serviceId: service.id,
          value: n,
        });
        if (res?.ok) {
          setCapSaved(true);
          if (capFlashTimer.current) window.clearTimeout(capFlashTimer.current);
          capFlashTimer.current = window.setTimeout(() => setCapSaved(false), 1400);
        }
      });
    }, 500);
  }
  // Demandeurs autorisés par défaut appliqués aux créneaux créés (vide = ouvert à tous).
  const [createDemIds, setCreateDemIds] = useState<number[]>([]);
  const [createDemModal, setCreateDemModal] = useState(false);
  // Glisser-créer en cours : top des colonnes (commun), quart de départ/courant (en
  // minutes, snappés), et jour de départ/courant (le glissé horizontal sélectionne
  // toutes les colonnes entre startDay et curDay → un créneau par colonne au relâché).
  // onMove = createDragMove (plus bas) ; onUp = finalizeCreate.
  const createDragH = useDragInteraction<CreateDrag>({
    onMove: createDragMove,
    onUp: finalizeCreate,
  });
  const createDrag = createDragH.drag;
  // Glisser-créer un créneau « JOURNÉE ENTIÈRE » (mode création, bande dédiée) :
  // sélection horizontale uniquement (startDay → curDay), aucune dimension verticale.
  // Un créneau sans horaire par jour couvert au relâché.
  const allDayDragH = useDragInteraction<AllDayDrag>({
    onMove: allDayDragMove,
    onUp: finalizeAllDayCreate,
  });
  const allDayDrag = allDayDragH.drag;
  // Glisser-DÉPLACER un créneau vide (mode création) : id du créneau, type, jour
  // d'origine, durée (préservée), top des colonnes, et position courante (quart +
  // jour sous le curseur).
  const moveDragH = useDragInteraction<MoveDrag>({ onMove: moveDragMove, onUp: moveDragUp });
  const moveDrag = moveDragH.drag;
  // Glisser-REDIMENSIONNER un créneau vide par une poignée de bord (mode création) :
  // le bord opposé reste fixe (fixedMin), on étire le bord saisi jusqu'au quart sous
  // le curseur (durée minimale d'un quart). Réutilise les actions de déplacement.
  const resizeDragH = useDragInteraction<ResizeDrag>({
    onMove: resizeDragMove,
    onUp: resizeDragUp,
  });
  const resizeDrag = resizeDragH.drag;
  // Glisser-ÉTENDRE un créneau vide latéralement (mode création) : on saisit le bord
  // gauche/droit et, en traversant les colonnes, on génère un créneau par jour couvert
  // (même plage horaire) — comme le glisser-créer.
  const hResizeDragH = useDragInteraction<HResizeDrag>({
    onMove: hResizeDragMove,
    onUp: hResizeDragUp,
  });
  const hResizeDrag = hResizeDragH.drag;
  const [detail, setDetail] = useState<Detail>(null);
  // Réservation en attente de confirmation de suppression (modale dédiée, port du
  // legacy booking-delete-confirm-modal : récap + avertissement « irréversible »).
  const [deleteTarget, setDeleteTarget] = useState<Booking | null>(null);
  // Modale "pile" : liste des réservations d'un créneau (clé slot+jour, recalculée
  // en direct depuis blocksByDay pour rester à jour après un refresh).
  const [stackKey, setStackKey] = useState<{ slotId: string; dayKey: string } | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [createCtx, setCreateCtx] = useState<CreateCtx>(null);
  // Usagers de la modale de création : chargés À LA DEMANDE (première ouverture),
  // plus dans le payload de la page — ils ne participent donc plus au coût de
  // l'auto-rafraîchissement (audit perf).
  const [users, setUsers] = useState<UserOpt[]>([]);
  const usersLoadedRef = useRef(false);
  useEffect(() => {
    if (!createCtx || usersLoadedRef.current) return;
    usersLoadedRef.current = true;
    void listAgendaUsersAction(service.id).then(setUsers);
  }, [createCtx, service.id]);
  const [cUser, setCUser] = useState("");
  // Filtres « Type de demandeur » et « Structure » (modale legacy) : restreignent la liste des usagers.
  const [cDemType, setCDemType] = useState("");
  const [cStructure, setCStructure] = useState("");
  const [cEnfants, setCEnfants] = useState("0");
  const [cAccompagnants, setCAccompagnants] = useState("0");
  const [cTheme, setCTheme] = useState("");
  const [cError, setCError] = useState<string | null>(null);
  // Modale « configuration de créneau » (mode création) : capacité + demandeurs autorisés.
  const [capModal, setCapModal] = useState<{ slotId: string } | null>(null);
  // Confirmation de copie des créneaux A↔B (modale dédiée au lieu de window.confirm).
  const [copyConfirm, setCopyConfirm] = useState<{ from: "A" | "B"; to: "A" | "B" } | null>(null);
  // Confirmation de suppression d'un créneau vide (modale dédiée au lieu de window.confirm).
  const [slotDeleteTarget, setSlotDeleteTarget] = useState<string | null>(null);
  // Presse-papier « copier / couper une réservation » : la source en attente de collage.
  const [copiedBooking, setCopiedBooking] = useState<{
    id: number;
    mode: "copy" | "cut";
  } | null>(null);
  // Menu contextuel (clic droit) : copier une réservation, ou coller sur un créneau.
  const [ctxMenu, setCtxMenu] = useState<
    | { x: number; y: number; kind: "booking"; booking: Booking }
    | { x: number; y: number; kind: "cell"; block: Block }
    | null
  >(null);
  // Ferme le menu contextuel au prochain clic / Échap / défilement.
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCtxMenu(null);
    };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [ctxMenu]);
  // Distingue un clic (ouvre la modale) d'un glisser-déplacer terminé (ne l'ouvre pas).
  const justMovedRef = useRef(false);
  // Info-bulle flottante unique (texte data-tip / « Journées concernées »), factorisée
  // dans un hook partagé. Masquée quand le menu contextuel est ouvert.
  const { tip, tipRef, onAgendaTip, clearTip } = useAgendaTooltip({
    getDates: (slotId, dayKey) => concernedDatesForBlock(slotId, dayKey),
    getMeta: (slotId, dayKey) => recMetaForBlock(slotId, dayKey),
    suppressed: () => ctxMenu !== null,
  });

  // Mémoïsé : `days` est une dép de blocksByDay et de la mémo des blocs ; un nouveau
  // tableau à chaque rendu invaliderait toute la chaîne de mémoïsation (perf).
  const days = useMemo(
    () =>
      service.activeDays
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean),
    [service.activeDays],
  );
  // Bornes de la grille = amplitude des plages d'ouverture RÉELLEMENT ouvertes.
  // Une plage « fermée » (fin ≤ début, p.ex. 00:00–00:00 pour « fermé l'après-midi »)
  // est ignorée — sinon afternoonEnd=00:00 ramenait la fin de grille à minuit et
  // n'affichait plus aucune ligne. Repli matin/après-midi standard si tout est fermé.
  const openRanges = (
    [
      [toMinutes(service.morningStart, 9 * 60), toMinutes(service.morningEnd, 12 * 60)],
      [toMinutes(service.afternoonStart, 14 * 60), toMinutes(service.afternoonEnd, 18 * 60)],
    ] as const
  ).filter(([s, e]) => e > s);
  const startMin = openRanges.length ? Math.min(...openRanges.map((r) => r[0])) : 9 * 60;
  const endMin = openRanges.length ? Math.max(...openRanges.map((r) => r[1])) : 18 * 60;
  const baseFirst = Math.floor(startMin / 60);
  const baseLast = Math.ceil(endMin / 60);

  // Périodes visibles = celles de l'exercice courant (toutes si aucun exercice).
  const visiblePeriods =
    currentExerciceId == null ? periods : periods.filter((p) => p.exerciceId === currentExerciceId);
  const selectedPeriodId = visiblePeriods[periodIdx]?.id ?? null;

  // « Aujourd'hui » n'a de sens que si la date du jour tombe dans une période de l'exercice
  // affiché (sinon le bouton renverrait hors de la plage visible) → on masque le bouton sinon.
  const todayYmd = ymd(new Date());
  const todayInVisiblePeriods = visiblePeriods.some(
    (p) => p.dateStart && p.dateEnd && p.dateStart <= todayYmd && p.dateEnd >= todayYmd,
  );

  // Navigation entre exercices (◀ label ▶).
  const exIdx = exercices.findIndex((e) => e.id === currentExerciceId);
  const exLabel = exIdx >= 0 ? exercices[exIdx].label : "—";
  const canExPrev = exIdx > 0 && showPrevious;
  const canExNext = exIdx >= 0 && exIdx < exercices.length - 1;
  function gotoExercice(id: number) {
    setCurrentExerciceId(id);
    setPeriodIdx(0);
  }

  // ── Mode "Semaine réelle" : semaine datée + période couvrant cette semaine ──
  const mondayStr = anchorMonday;
  const sundayStr = mondayStr ? ymd(addDays(mondayStr, 6)) : null;
  // Une période "couvre" une date si celle-ci est dans [dateStart, dateEnd].
  const periodCoveringDate = (d: string) =>
    periods.find((p) => p.dateStart && p.dateEnd && p.dateStart <= d && p.dateEnd >= d) ?? null;
  // Période active : priorité à celle verrouillée (rwPeriodId) tant qu'elle
  // intersecte la semaine — sinon on dérive depuis l'ancre (lundi puis mercredi,
  // pour les périodes commençant en milieu de semaine). Cf. legacy l.6469-6480.
  const lockedPeriod =
    rwPeriodId != null
      ? (periods.find(
          (p) =>
            p.id === rwPeriodId &&
            mondayStr != null &&
            sundayStr != null &&
            p.dateStart != null &&
            p.dateEnd != null &&
            p.dateStart <= sundayStr &&
            p.dateEnd >= mondayStr,
        ) ?? null)
      : null;
  const coveringPeriod =
    mondayStr && sundayStr
      ? (lockedPeriod ??
        periodCoveringDate(mondayStr) ??
        periodCoveringDate(ymd(addDays(mondayStr, 3))))
      : null;
  // En semaine réelle sans période couvrante, -1 ne matche rien → aucun bloc.
  const effectivePeriodId = mode === "realweek" ? (coveringPeriod?.id ?? -1) : selectedPeriodId;

  // Dates (YYYY-MM-DD) des créneaux ponctuels (datés) ayant au moins une réservation
  // (port legacy _agendaBookedSlotDates). Trié croissant. Mémoïsé + Set : l'ancien
  // filter×some était O(miroirs × réservations) recalculé à CHAQUE rendu (survol,
  // drag…) — audit perf.
  const bookedSlotDates = useMemo(() => {
    const bookedSlotIds = new Set(bookings.map((b) => b.slotId));
    return uniqueSlots
      .filter((s) => s.slotDate && bookedSlotIds.has(s.id))
      .map((s) => s.slotDate as string)
      .sort();
  }, [uniqueSlots, bookings]);
  // Parités A/B couvertes par les réservations RÉCURRENTES (periodId > 0) de chaque
  // période. Une résa sans semaine ("") vaut pour A ET B. Ces résas se répètent chaque
  // semaine de la période → une semaine est « non vide » seulement si sa parité figure
  // ici. (Hors mode A/B, on enregistre "A"/"B"/"" sans distinction — voir weekHasBooking.)
  const recurAbByPeriod = useMemo(() => {
    const map = new Map<number, Set<"A" | "B" | "">>();
    for (const b of bookings) {
      if (b.periodId <= 0) continue;
      const set = map.get(b.periodId) ?? new Set<"A" | "B" | "">();
      set.add((b.week === "A" || b.week === "B" ? b.week : "") as "A" | "B" | "");
      map.set(b.periodId, set);
    }
    return map;
  }, [bookings]);

  // Une semaine (lundi → dimanche) contient-elle une réservation visible ?
  // - ponctuel daté réservé dans la semaine, OU
  // - réservation récurrente de la période couvrant la semaine, dont la parité A/B
  //   est compatible avec celle de la semaine (en mode A/B). "" = vaut pour A et B.
  const weekHasBooking = (monday: string): boolean => {
    const sunday = ymd(addDays(monday, 6));
    if (bookedSlotDates.some((d) => d >= monday && d <= sunday)) return true;
    const p = periodCoveringDate(monday) ?? periodCoveringDate(ymd(addDays(monday, 3)));
    if (p == null) return false;
    const ab = recurAbByPeriod.get(p.id);
    if (!ab || ab.size === 0) return false;
    if (!modes.abMode) return true; // pas de distinction A/B → toute résa récurrente compte
    return ab.has("") || ab.has(slotWeekTag(monday));
  };
  // Existe-t-il une semaine non vide au-delà de `monday` dans la direction donnée,
  // sans sortir de la période active ? (pour activer/désactiver ◀/▶ en hideEmpty)
  const hasBookedWeekBeyond = (monday: string, dir: 1 | -1): boolean => {
    const startB = coveringPeriod?.dateStart;
    const endB = coveringPeriod?.dateEnd;
    let cur = ymd(addDays(monday, dir * 7));
    for (let i = 0; i < 260; i++) {
      const sunday = ymd(addDays(cur, 6));
      if (endB && cur > endB) break;
      if (startB && sunday < startB) break;
      if (weekHasBooking(cur)) return true;
      cur = ymd(addDays(cur, dir * 7));
    }
    return false;
  };

  // Bornes de navigation hebdo : on reste dans la période sélectionnée (celle qui
  // couvre la semaine courante) et on ne navigue pas au-delà de ses dates.
  // En mode hideEmpty, on désactive aussi ◀/▶ s'il n'existe plus aucune semaine
  // AVEC réservation dans la direction (cf. legacy renderAgendaWeekly).
  // Mémoïsé : hasBookedWeekBeyond balaie jusqu'à 260 semaines — à ne recalculer que
  // quand les données ou la semaine changent, pas à chaque survol/drag (audit perf).
  // biome-ignore lint/correctness/useExhaustiveDependencies: hasBookedWeekBeyond est une closure recréée à chaque rendu ; ses entrées réelles sont listées (bookedSlotDates, recurAbByPeriod, coveringPeriod, periods, modes.abMode).
  const { canWeekPrev, canWeekNext } = useMemo(
    () => ({
      canWeekPrev: mondayStr
        ? (coveringPeriod?.dateStart
            ? ymd(addDays(mondayStr, -1)) >= coveringPeriod.dateStart
            : true) &&
          (!hideEmpty || hasBookedWeekBeyond(mondayStr, -1))
        : false,
      canWeekNext: mondayStr
        ? (coveringPeriod?.dateEnd ? ymd(addDays(mondayStr, 7)) <= coveringPeriod.dateEnd : true) &&
          (!hideEmpty || hasBookedWeekBeyond(mondayStr, 1))
        : false,
    }),
    [mondayStr, hideEmpty, coveringPeriod, bookedSlotDates, recurAbByPeriod, periods, modes.abMode],
  );

  // Navigation hebdo (◀/▶) : en mode hideEmpty, on saute aux semaines AYANT au moins
  // une réservation (ponctuelle OU récurrente — port legacy shiftAgendaWeek), bornée
  // à la période active.
  function shiftWeek(deltaWeeks: number) {
    if (!mondayStr) return;
    let newAnchor = ymd(addDays(mondayStr, deltaWeeks * 7));
    if (hideEmpty && deltaWeeks !== 0) {
      const step = deltaWeeks > 0 ? 7 : -7;
      const MAX_ITER = 260;
      let iter = 0;
      while (iter++ < MAX_ITER) {
        if (weekHasBooking(newAnchor)) break;
        if (!hasBookedWeekBeyond(newAnchor, deltaWeeks > 0 ? 1 : -1)) break;
        newAnchor = ymd(addDays(newAnchor, step));
      }
    }
    // Clamp à la période active : si le saut sort de la période, on annule.
    if (coveringPeriod?.dateStart && coveringPeriod.dateEnd) {
      const newSunday = ymd(addDays(newAnchor, 6));
      if (newAnchor > coveringPeriod.dateEnd || newSunday < coveringPeriod.dateStart) return;
    }
    setAnchorMonday(newAnchor);
  }
  // Libellé daté de chaque jour de la semaine réelle, par dayKey.
  const weekDateByDay: Record<string, string> = {};
  if (mondayStr) {
    for (const d of days)
      weekDateByDay[d] = shortDateFmt.format(addDays(mondayStr, DAY_OFFSET[d] ?? 0));
  }
  // Jour fermé : uniquement en semaine réelle, pour un jour hors de la période
  // active, férié quand le service ferme les fériés, OU en vacances scolaires quand
  // le service ferme les vacances. Contrairement au legacy (grisage purement visuel),
  // on bloque ici aussi toutes les interactions.
  // Mémoïsé (useCallback) : stable d'un rendu à l'autre tant que période/mode ne
  // changent pas → permet la mémo des blocs par jour (cf. dayBlockEls).
  const isDayDisabled = useCallback(
    (dayKey: string): boolean => {
      if (mode !== "realweek" || !mondayStr) return false;
      const dayYmd = ymd(addDays(mondayStr, DAY_OFFSET[dayKey] ?? 0));
      if (
        coveringPeriod?.dateStart &&
        coveringPeriod.dateEnd &&
        (dayYmd < coveringPeriod.dateStart || dayYmd > coveringPeriod.dateEnd)
      ) {
        return true;
      }
      if (!service.openOnHolidays && isFrenchHoliday(dayYmd)) return true;
      return !service.openOnSchoolHolidays && inSchoolHolidayRange(dayYmd, schoolHolidays);
    },
    [mode, mondayStr, coveringPeriod, service, schoolHolidays],
  );
  // Jour férié (service fermé les fériés), en semaine réelle.
  const isHolidayDay = (dayKey: string): boolean => {
    if (mode !== "realweek" || !mondayStr || service.openOnHolidays) return false;
    return isFrenchHoliday(ymd(addDays(mondayStr, DAY_OFFSET[dayKey] ?? 0)));
  };
  // Jour de vacances scolaires (service fermé les vacances), en semaine réelle.
  const isSchoolHolidayDay = (dayKey: string): boolean => {
    if (mode !== "realweek" || !mondayStr || service.openOnSchoolHolidays) return false;
    return inSchoolHolidayRange(ymd(addDays(mondayStr, DAY_OFFSET[dayKey] ?? 0)), schoolHolidays);
  };
  // Classe de grisage : jour férié ou vacances scolaires → hachis (is-holiday) ;
  // hors période → hachis dédié (is-out-of-period).
  const outOfPeriodCls = (dayKey: string): string => {
    if (!isDayDisabled(dayKey)) return "";
    return isHolidayDay(dayKey) || isSchoolHolidayDay(dayKey) ? " is-holiday" : " is-out-of-period";
  };

  // ── Semaines A/B ── (dérivé de la matrice demandeurs, pas de la colonne service)
  const abMode = modes.abMode;
  const realWeekParity: "A" | "B" | null = mondayStr ? slotWeekTag(mondayStr) : null;
  // Semaine effective filtrée : en modèle = choix A/B ; en réel = parité de la date.
  const effectiveWeek: "A" | "B" | null = abMode
    ? mode === "model"
      ? weekAB
      : realWeekParity
    : null;

  // La plage horaire affichée reste fixe (matin → après-midi). « Masquer les
  // horaires sans réservation » ne resserre pas la plage : il COMPACTE les quarts
  // d'heure non occupés (cf. legacy renderAgendaWeekly), géré plus bas via `quarters`.
  const firstHour = baseFirst;
  const lastHour = baseLast;

  const gridStartMin = firstHour * 60;
  const gridEndMin = lastHour * 60;
  const _QUARTER_H = ROW_H / 4; // px par tranche de 15 min

  // Ids des créneaux ponctuels AUTONOMES (non miroirs) : affichés en vert et en
  // lecture seule (on neutralise la création/déplacement de résa récurrente dessus ;
  // la réservation ponctuelle relève d'un autre flux).
  const uniqueIdSet = useMemo(
    () => new Set(uniqueSlots.filter((s) => !s.parentSlotId).map((s) => s.id)),
    [uniqueSlots],
  );
  // Slots MIROIRS (matérialisations datées des récurrents) → leur slot parent + date.
  // Sert à rattacher les réservations-ENFANTS à la cellule du parent en semaine réelle.
  const mirrorMap = useMemo(
    () =>
      new Map(
        uniqueSlots
          .filter((s) => s.parentSlotId)
          .map((s) => [s.id, { parentSlotId: s.parentSlotId as string, slotDate: s.slotDate }]),
      ),
    [uniqueSlots],
  );

  // ── Pause méridienne (port legacy renderAgendaWeekly) ───────────────────────
  // Zone entre morningEnd et afternoonStart. Si > 30 min, on COMPACTE : on ne garde
  // que 2 quarts visuels (30 min) — les quarts au-delà de lunchStart+30 sont sautés.
  // Le reste de la grille (lignes, heures, blocs, clics) suit un mapping par quarts
  // d'heure VISIBLES (mapMinToY), au lieu d'un mapping linéaire heure/heure.
  const lunchStart = toMinutes(service.morningEnd, Number.NaN);
  const lunchEnd = toMinutes(service.afternoonStart, Number.NaN);
  const hasLunch =
    Number.isFinite(lunchStart) &&
    Number.isFinite(lunchEnd) &&
    lunchEnd > lunchStart &&
    lunchStart >= gridStartMin &&
    lunchEnd <= gridEndMin;
  const lunchSkipFrom = hasLunch && lunchEnd - lunchStart > 30 ? lunchStart + 30 : null;

  // ── « Masquer les horaires sans réservation » (compactage, port legacy) ─────
  // On ne resserre pas la plage : on construit l'ensemble des quarts d'heure
  // OCCUPÉS (granularité HEURE : dès qu'un créneau avec ≥1 réservation visible
  // touche une heure, ses 4 quarts sont conservés pour garder le repère "heure").
  // Les quarts non occupés sont ensuite sautés dans `quarters`.
  // Mémoïsé : recalculé seulement quand ses entrées changent (et pas, p.ex., pendant
  // un glisser-créer) — clé pour la stabilité de la géométrie et la mémo des blocs.
  const occupiedQ = useMemo(() => {
    const set = new Set<number>();
    if (!hideEmpty) return set;
    const occupiedHours = new Set<number>();
    // Ids des créneaux récurrents ayant une réservation visible (période + semaine A/B).
    const recBookedSlotIds = new Set<string>();
    // Ids des créneaux ponctuels (datés) ayant une réservation dans la semaine affichée.
    const uniqBookedSlotIds = new Set<string>();
    const uniqSunday = sundayStr ?? mondayStr;
    // Lookup par id (l'ancien uniqueSlots.find dans la boucle était O(B×U) par rendu).
    const uniqById = new Map(uniqueSlots.map((s) => [s.id, s]));
    for (const b of bookings) {
      if (uniqueIdSet.has(b.slotId)) {
        if (mode !== "realweek" || !mondayStr) continue;
        const u = uniqById.get(b.slotId);
        if (!u?.slotDate || u.slotDate < mondayStr || (uniqSunday && u.slotDate > uniqSunday))
          continue;
        uniqBookedSlotIds.add(b.slotId);
        continue;
      }
      if (effectivePeriodId != null && b.periodId !== effectivePeriodId) continue;
      if (effectiveWeek != null && b.week !== effectiveWeek && b.week !== "") continue;
      recBookedSlotIds.add(b.slotId);
    }
    const addHours = (sMin: number, eMin: number) => {
      const s = Math.max(sMin, gridStartMin);
      const e = Math.min(eMin, gridEndMin);
      if (e <= s) return;
      for (let m = Math.floor(s / 60) * 60; m < e; m += 60) occupiedHours.add(m);
    };
    for (const s of slots) {
      if (!recBookedSlotIds.has(s.id)) continue;
      addHours(toMinutes(s.startTime, gridStartMin), toMinutes(s.endTime, gridStartMin + 60));
    }
    for (const u of uniqueSlots) {
      if (!uniqBookedSlotIds.has(u.id)) continue;
      addHours(toMinutes(u.startTime, gridStartMin), toMinutes(u.endTime, gridStartMin + 60));
    }
    // Étend chaque heure occupée à ses 4 quarts (dans [gridStartMin, gridEndMin]).
    for (const h of occupiedHours) {
      for (let q = h; q < h + 60; q += 15) {
        if (q >= gridStartMin && q < gridEndMin) set.add(q);
      }
    }
    return set;
  }, [
    hideEmpty,
    bookings,
    uniqueIdSet,
    slots,
    uniqueSlots,
    mode,
    mondayStr,
    sundayStr,
    effectivePeriodId,
    effectiveWeek,
    gridStartMin,
    gridEndMin,
  ]);

  // Géométrie de la grille (quarts visibles + mapping minute↔pixel) mutualisée.
  // Mémoïsée : `mapMinToY` doit rester stable d'un rendu à l'autre pour que la mémo
  // des blocs par jour tienne (sinon recréée à chaque rendu = mémo invalide).
  const { quarters, qIdx, totalH, mapMinToY, yToMin } = useMemo(
    () =>
      gridGeometry({
        gridStartMin,
        gridEndMin,
        lunchStart,
        lunchEnd,
        occupiedQ: hideEmpty ? occupiedQ : null,
      }),
    [gridStartMin, gridEndMin, lunchStart, lunchEnd, hideEmpty, occupiedQ],
  );

  const slotsParsed = useMemo(
    () =>
      slots.map((s) => ({
        ...s,
        startMin: toMinutes(s.startTime, gridStartMin),
        endMin: toMinutes(s.endTime, gridStartMin + 60),
      })),
    [slots, gridStartMin],
  );

  function slotAtClientY(colTop: number, clientY: number) {
    // y → minute via le mapping par quarts (gère le compactage de la pause).
    const minute = yToMin(clientY - colTop);
    return slotsParsed.find((s) => minute >= s.startMin && minute < s.endMin) ?? null;
  }

  const blocksByDay = useMemo(() => {
    // Créneaux ponctuels (datés) → en « Semaine réelle », on les projette sur le
    // jour de la semaine affichée correspondant à leur date, sous forme de slots
    // virtuels mono-jour : toute la logique de blocs/layout/rendu les traite alors
    // comme des créneaux normaux (legacy renderAgendaWeekly, branche realweek).
    const ponctuelSlots: Slot[] = [];
    if (mode === "realweek" && mondayStr) {
      const sunday = sundayStr ?? mondayStr;
      for (const u of uniqueSlots) {
        // Les miroirs (matérialisations de récurrents) sont déjà couverts par les
        // créneaux récurrents affichés directement → on ne projette que les ponctuels
        // autonomes (non miroirs), affichés en vert (cf. legacy).
        if (u.parentSlotId) continue;
        if (!u.slotDate || u.slotDate < mondayStr || u.slotDate > sunday) continue;
        const dk = dayKeyFromYmd(u.slotDate);
        if (!days.includes(dk)) continue;
        ponctuelSlots.push({
          id: u.id,
          startTime: u.startTime,
          endTime: u.endTime,
          capacity: u.capacity ?? service.capacity,
          slotDay: dk,
          // periodId aligné sur la période effective pour passer le filtre de période.
          periodId: effectivePeriodId,
          weeks: null,
          slotDate: u.slotDate,
        });
      }
    }
    const allSlots = ponctuelSlots.length ? [...slots, ...ponctuelSlots] : slots;
    const slotById = new Map(allSlots.map((s) => [s.id, s]));

    // Le créneau tourne-t-il sur la semaine active (filtre A/B) ?
    const slotMatchesWeek = (slot: Slot): boolean => {
      if (!abMode || effectiveWeek == null) return true;
      return parseWeeks(slot.weeks).includes(effectiveWeek);
    };

    // Réservations groupées par dayKey|slotId (filtrées période + semaine, comme avant).
    const groups = new Map<string, Booking[]>();
    const pushGroup = (key: string, b: Booking) => {
      const arr = groups.get(key) ?? [];
      arr.push(b);
      groups.set(key, arr);
    };
    const uniqSunday = sundayStr ?? mondayStr;
    // Lookup par id (l'ancien uniqueSlots.find dans la boucle était O(B×U)).
    const uniqById = new Map(uniqueSlots.map((s) => [s.id, s]));
    for (const b of bookings) {
      // Réservation-ENFANT (matérialisation d'une récurrente sur un slot miroir daté) :
      // en « Semaine réelle », rattachée à la cellule du SLOT PARENT du jour affiché
      // (elle y porte le pointage). En mode « Modèle », c'est la parente qui s'affiche
      // → l'enfant n'est pas projeté.
      const mir = mirrorMap.get(b.slotId);
      if (mir) {
        if (mode !== "realweek" || !mondayStr) continue;
        if (!mir.slotDate || mir.slotDate < mondayStr || (uniqSunday && mir.slotDate > uniqSunday))
          continue;
        const dk = dayKeyFromYmd(mir.slotDate);
        if (!days.includes(dk)) continue;
        pushGroup(`${dk}|${mir.parentSlotId}`, b);
        continue;
      }
      // Réservation PONCTUELLE autonome : rattachée à son bloc ponctuel projeté (clé
      // jour = jour de la date du créneau), en ignorant période/semaine.
      if (uniqueIdSet.has(b.slotId)) {
        if (mode !== "realweek" || !mondayStr) continue;
        const u = uniqById.get(b.slotId);
        if (!u?.slotDate || u.slotDate < mondayStr || (uniqSunday && u.slotDate > uniqSunday))
          continue;
        const dk = dayKeyFromYmd(u.slotDate);
        if (!days.includes(dk)) continue;
        pushGroup(`${dk}|${b.slotId}`, b);
        continue;
      }
      // Réservation RÉCURRENTE parente : en semaine réelle, ce sont ses enfants datés
      // qui s'affichent (ci-dessus) → on ne projette PAS la parente. En mode Modèle,
      // projection normale sur son jour.
      if (mode === "realweek") continue;
      if (effectivePeriodId != null && b.periodId !== effectivePeriodId) continue;
      // A/B : une résa sans semaine ("") vaut pour les deux semaines.
      if (effectiveWeek != null && b.week !== effectiveWeek && b.week !== "") continue;
      pushGroup(`${b.dayKey}|${b.slotId}`, b);
    }

    // === Cellules candidates ===
    // Pour chaque créneau de la période active, sur chaque jour actif du service où
    // une capacité est configurée → cellule candidate (même sans réservation). C'est
    // ce qui fait apparaître les créneaux vides cliquables (port du legacy).
    const candidates = new Map<string, { slotId: string; dayKey: string }>();
    for (const slot of allSlots) {
      if (effectivePeriodId != null && slot.periodId !== effectivePeriodId) continue;
      if (!slotMatchesWeek(slot)) continue;
      // Modèle « un slot = un jour » : le créneau s'affiche sur SON jour (slotDay),
      // avec repli sur service.capacity si la capacité n'est pas fixée. Capacité 0 = fermé.
      const dayKey = slot.slotDay;
      if (!dayKey || !days.includes(dayKey)) continue;
      const c = slot.capacity ?? service.capacity;
      if (c <= 0) continue;
      candidates.set(`${dayKey}|${slot.id}`, { slotId: slot.id, dayKey });
    }
    // Union avec les cellules portant des réservations : aucune résa n'est perdue,
    // même sur un jour sans capacité configurée (donnée de seed incohérente possible).
    for (const key of groups.keys()) {
      if (candidates.has(key)) continue;
      const [dayKey, slotId] = key.split("|");
      candidates.set(key, { slotId, dayKey });
    }

    // Un bloc PAR CRÉNEAU (slot) regroupant toutes ses réservations (modèle legacy
    // renderAgendaWeekly), au lieu d'un bloc par réservation juxtaposé.
    const byDay: Record<string, Block[]> = {};
    for (const { slotId, dayKey } of candidates.values()) {
      const slot = slotById.get(slotId);
      if (!slot) continue;
      const list = groups.get(`${dayKey}|${slotId}`) ?? [];
      // Créneau sans horaire (début ou fin vide) → « journée entière ».
      const allday = !slot.startTime || !slot.endTime;
      const s = toMinutes(slot.startTime, gridStartMin);
      const e = toMinutes(slot.endTime, s + 60);
      const capacity = dayCap(slot, dayKey) ?? slot.capacity ?? service.capacity;
      // Places occupées, conditionnées au mode jauge DE CE CRÉNEAU (ponctuel → gaugePonct,
      // récurrent → gaugeRec, comme l'agenda usager) : en jauge = somme (enfants + adultes
      // si comptés) ; hors jauge = nombre de réservations. Gater ici rend `used`/`full`
      // cohérents pour TOUS les consommateurs (libellé, barre, flag « complet », modale pile).
      const gaugeForSlot = uniqueIdSet.has(slotId) ? modes.gaugePonct : modes.gaugeRec;
      const used = gaugeForSlot
        ? list.reduce(
            (sum, b) => sum + gaugeUnits(b.enfants, b.accompagnants, service.gaugeAccompagnants),
            0,
          )
        : list.length;
      // Un bloc vide (used=0) n'est jamais "complet".
      const full = used >= capacity && used > 0;
      // biome-ignore lint/suspicious/noAssignInExpressions: init-or-push concis sur la map par jour
      (byDay[dayKey] ??= []).push({
        slotId,
        dayKey,
        bookings: list,
        startMin: s,
        endMin: e,
        leftPct: 0,
        widthPct: 100,
        used,
        capacity,
        full,
        isAllDay: allday,
      });
    }
    // Chevauchements horaires : sur chaque colonne-jour, les créneaux qui se
    // recouvrent dans le temps sont répartis sur N colonnes (cf. _agendaLayoutOverlaps).
    // Chaque LayoutItem référence directement son bloc (id stable) → pas d'ambiguïté
    // si deux créneaux partagent les mêmes horaires.
    for (const dayKey of Object.keys(byDay)) {
      // Les blocs « journée entière » ne sont pas positionnés sur la grille horaire :
      // ils gardent leftPct:0/widthPct:100 et sont rendus dans la bande dédiée.
      const blocks = byDay[dayKey].filter((bl) => !bl.isAllDay);
      const items: (LayoutItem & { block: Block })[] = blocks.map((bl) => {
        const slot = slotById.get(bl.slotId);
        return {
          startMin: toMinutes(slot?.startTime ?? "", gridStartMin),
          endMin: toMinutes(slot?.endTime ?? "", gridStartMin + 60),
          col: 0,
          colCount: 1,
          block: bl,
        };
      });
      layoutOverlaps(items);
      for (const it of items) {
        it.block.leftPct = it.col * (100 / it.colCount);
        it.block.widthPct = 100 / it.colCount;
      }
    }
    return byDay;
  }, [
    bookings,
    slots,
    uniqueSlots,
    uniqueIdSet,
    mirrorMap,
    mode,
    mondayStr,
    sundayStr,
    days,
    abMode,
    effectivePeriodId,
    effectiveWeek,
    gridStartMin,
    service.capacity,
    service.gaugeAccompagnants,
    modes.gaugeRec,
    modes.gaugePonct,
  ]);

  // Blocs affichés pour un jour : AUCUN sur un jour fermé (hors période active ou
  // férié) — sinon les créneaux/réservations de la période couvrante débordent sur
  // un jour appartenant à une autre période (semaine à cheval) ou sur un férié.
  const dayBlocks = (d: string): Block[] => (isDayDisabled(d) ? [] : (blocksByDay[d] ?? []));

  // Exécuteur UNIQUE des actions serveur (contrat { ok, error } homogène) : en cas
  // d'échec (créneau complet, réservation verrouillée, donnée invalide…), l'erreur
  // est affichée via le toast d'avertissement — plus aucun échec silencieux.
  function runResult(p: Promise<{ ok: boolean; error?: string }>) {
    setDetail(null);
    startTransition(async () => {
      const res = await p;
      if (!res.ok) {
        showWarnToast(res.error ?? "Action impossible.");
        return;
      }
      router.refresh();
    });
  }
  // Variante pour un LOT d'actions (Promise.all) : première erreur affichée ;
  // l'écran est rafraîchi même en cas d'échec partiel (certaines ont pu réussir).
  function runResults(p: Promise<{ ok: boolean; error?: string }[]>) {
    setDetail(null);
    startTransition(async () => {
      const results = await p;
      const failed = results.find((r) => !r.ok);
      if (failed) showWarnToast(failed.error ?? "Action impossible.");
      router.refresh();
    });
  }

  // Auto-rafraîchissement de l'agenda : intervalle configurable (Administration >
  // Configuration ; 0 = désactivé) + au retour sur l'onglet. SUSPENDU pendant une
  // interaction (glisser-créer/déplacer/redimensionner, drag d'une réservation) ou
  // quand une modale/menu est ouvert, pour ne jamais interrompre un geste ni faire
  // « sauter » l'écran sous une modale. En pause quand l'onglet est masqué.
  const autoRefreshBusy =
    createDrag !== null ||
    moveDrag !== null ||
    resizeDrag !== null ||
    hResizeDrag !== null ||
    allDayDrag !== null ||
    draggingId !== null ||
    detail !== null ||
    deleteTarget !== null ||
    stackKey !== null ||
    createCtx !== null ||
    capModal !== null ||
    createDemModal ||
    copyConfirm !== null ||
    slotDeleteTarget !== null ||
    ctxMenu !== null;
  const autoRefreshBusyRef = useRef(autoRefreshBusy);
  useEffect(() => {
    autoRefreshBusyRef.current = autoRefreshBusy;
  }, [autoRefreshBusy]);
  useEffect(() => {
    if (!autoRefreshSeconds || autoRefreshSeconds <= 0) return;
    const refreshIfIdle = () => {
      if (document.visibilityState === "visible" && !autoRefreshBusyRef.current) {
        startTransition(() => router.refresh());
      }
    };
    const id = window.setInterval(refreshIfIdle, autoRefreshSeconds * 1000);
    document.addEventListener("visibilitychange", refreshIfIdle);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", refreshIfIdle);
    };
  }, [router, autoRefreshSeconds]);

  // Toast léger (réutilise les classes .toast du legacy). Affiché ~4 s puis retiré,
  // centré horizontalement sur la zone .app-main (et non le viewport), bas de page.
  const [toast, setToast] = useState<{ id: number; content: React.ReactNode } | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastCenterX, setToastCenterX] = useState<number | null>(null);
  const toastIdRef = useRef(0);
  function showWarnToast(content: React.ReactNode) {
    toastIdRef.current += 1;
    setToast({ id: toastIdRef.current, content });
  }
  // Avertissement « réservation récurrente » (Semaine réelle + mode validation).
  function warnRecurringValidation() {
    showWarnToast(
      <>
        Pour valider/dévalider une réservation récurrente, veuillez passer en mode{" "}
        <strong>Modèle de période</strong>
      </>,
    );
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: relancé à chaque nouveau toast via son id
  useEffect(() => {
    if (!toast) return;
    const measure = () => {
      const main = document.querySelector(".app-main");
      if (main) {
        const r = main.getBoundingClientRect();
        setToastCenterX(r.left + r.width / 2);
      }
    };
    measure();
    window.addEventListener("resize", measure);
    setToastVisible(false);
    const raf = requestAnimationFrame(() => setToastVisible(true));
    const hide = window.setTimeout(() => setToastVisible(false), 4000);
    const clear = window.setTimeout(() => setToast(null), 4300);
    return () => {
      window.removeEventListener("resize", measure);
      cancelAnimationFrame(raf);
      window.clearTimeout(hide);
      window.clearTimeout(clear);
    };
  }, [toast?.id]);

  // "Mode validation" / "Mode pointage" / "Création de créneau" : mutuellement exclusifs.
  function toggleValidation(on: boolean) {
    setValidation(on);
    if (on) {
      setPointageMode(false);
      setCreationMode(false);
    }
  }
  function togglePointageMode(on: boolean) {
    setPointageMode(on);
    if (on) {
      setValidation(false);
      setCreationMode(false);
    }
  }
  function toggleCreationMode(on: boolean) {
    setCreationMode(on);
    if (on) {
      setValidation(false);
      setPointageMode(false);
    }
  }

  // Mode création + Modèle de période + A/B : copie les créneaux récurrents de la
  // semaine active vers l'autre (non destructif).
  function copyWeek() {
    if (mode !== "model" || !abMode || effectiveWeek == null) return;
    if (effectivePeriodId == null || effectivePeriodId <= 0) return;
    const from = effectiveWeek;
    const to: "A" | "B" = from === "A" ? "B" : "A";
    setCopyConfirm({ from, to });
  }

  function confirmCopyWeek() {
    if (!copyConfirm || effectivePeriodId == null || effectivePeriodId <= 0) {
      setCopyConfirm(null);
      return;
    }
    runResult(
      copyWeekSlotsAction({
        serviceId: service.id,
        periodId: effectivePeriodId,
        fromWeek: copyConfirm.from,
        toWeek: copyConfirm.to,
      }),
    );
    setCopyConfirm(null);
  }

  // ── Mode « Création de créneau » : géométrie + création ─────────────────────
  const minToHHMM = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

  // Quart d'heure (minutes, snappé au quart) sous le curseur dans une colonne-jour.
  function quarterAtY(colTop: number, clientY: number): number {
    const q = Math.floor(yToMin(clientY - colTop) / 15) * 15;
    return Math.max(gridStartMin, Math.min(gridEndMin - 15, q));
  }

  // Découpe une plage [s, e] en retirant la pause méridienne : un créneau ne peut pas
  // chevaucher [lunchStart, lunchEnd]. Renvoie 0, 1 ou 2 segments :
  //   - pas de pause / pas de chevauchement → [[s, e]] ;
  //   - chevauche → la part matin [s, lunchStart] et/ou la part après-midi [lunchEnd, e] ;
  //   - entièrement dans la pause → [] (rien à créer).
  function lunchSplitSegments(s: number, e: number): [number, number][] {
    if (!hasLunch || e <= lunchStart || s >= lunchEnd) return [[s, e]];
    const segs: [number, number][] = [];
    if (s < lunchStart) segs.push([s, lunchStart]);
    if (e > lunchEnd) segs.push([lunchEnd, e]);
    return segs;
  }

  // mousedown sur une colonne en mode création : démarre un glisser-créer, mais
  // seulement sur une zone VIDE (pas sur un bloc existant).
  function onCreateMouseDown(e: React.MouseEvent, dayKey: string) {
    if (!creationMode || isDayDisabled(dayKey)) return;
    if ((e.target as HTMLElement).closest(".agenda-block")) return;
    if (mode === "model" && (effectivePeriodId == null || effectivePeriodId <= 0)) return;
    if (mode === "realweek" && !mondayStr) return;
    e.preventDefault();
    const colTop = e.currentTarget.getBoundingClientRect().top;
    const startMin = quarterAtY(colTop, e.clientY);
    const cd = { colTop, startMin, curMin: startMin, startDay: dayKey, curDay: dayKey };
    createDragH.start(cd);
  }

  // Colonnes (jours) couvertes par le glisser : plage contiguë de startDay à curDay
  // dans l'ordre d'affichage, hors jours fermés.
  function daysSpan(startDay: string, curDay: string): string[] {
    const i = days.indexOf(startDay);
    const j = days.indexOf(curDay);
    if (i < 0) return [];
    const [lo, hi] = j < 0 || i <= j ? [i, j < 0 ? i : j] : [j, i];
    return days.slice(lo, hi + 1).filter((d) => !isDayDisabled(d));
  }
  function draggedDays(cd: CreateDrag): string[] {
    return daysSpan(cd.startDay, cd.curDay);
  }

  // Au relâché : UN créneau par colonne couverte, couvrant [start, max+15] (clic
  // simple = 1 quart, 1 colonne). Récurrent en Modèle de période (période + jour +
  // semaine A/B active), ponctuel daté en Semaine réelle. Capacité = service.capacity.
  function finalizeCreate(cd: CreateDrag) {
    const rawStart = Math.min(cd.startMin, cd.curMin);
    const rawEnd = Math.min(gridEndMin, Math.max(cd.startMin, cd.curMin) + 15);
    if (rawEnd <= rawStart) return;
    // La pause méridienne découpe la sélection : 1 créneau par segment hors pause
    // (2 si la sélection déborde de part et d'autre, 0 si elle est dans la pause).
    const segments = lunchSplitSegments(rawStart, rawEnd).filter(([s, e]) => e > s);
    if (!segments.length) return;
    const targets = draggedDays(cd);
    if (!targets.length) return;
    if (mode === "model") {
      if (effectivePeriodId == null || effectivePeriodId <= 0) return;
      const weeks = abMode && effectiveWeek ? effectiveWeek : "";
      runResults(
        Promise.all(
          targets.flatMap((dayKey) =>
            segments.map(([s, e]) =>
              createRecurringSlotAction({
                serviceId: service.id,
                periodId: effectivePeriodId,
                dayKey,
                startTime: minToHHMM(s),
                endTime: minToHHMM(e),
                weeks,
                capacity: createCap,
                demandeurIds: createDemIds,
              }),
            ),
          ),
        ),
      );
    } else {
      if (!mondayStr) return;
      runResults(
        Promise.all(
          targets.flatMap((dayKey) =>
            segments.map(([s, e]) =>
              createUniqueSlotAction({
                serviceId: service.id,
                slotDate: ymd(addDays(mondayStr, DAY_OFFSET[dayKey] ?? 0)),
                startTime: minToHHMM(s),
                endTime: minToHHMM(e),
                capacity: createCap,
                demandeurIds: createDemIds,
              }),
            ),
          ),
        ),
      );
    }
  }

  // Suivi du glisser-créer (onMove) : quart courant + colonne (jour) survolée pour la
  // sélection horizontale multi-colonnes. Renvoie l'état suivant si l'un a changé,
  // sinon null. Le relâché (onUp) = finalizeCreate. (cf. useDragInteraction.)
  function createDragMove(cd: CreateDrag, e: MouseEvent): CreateDrag | null {
    const q = quarterAtY(cd.colTop, e.clientY);
    const colEl = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>("[data-daykey]");
    const dk = colEl?.dataset.daykey;
    const curDay = dk && days.includes(dk) ? dk : cd.curDay;
    return q !== cd.curMin || curDay !== cd.curDay ? { ...cd, curMin: q, curDay } : null;
  }

  // ── Mode création : créneau « journée entière » (bande dédiée) ───────────────
  // mousedown sur une cellule de la bande « Journée entière » : démarre un glisser-
  // créer purement horizontal (aucune dimension verticale), sur zone vide seulement.
  function onAllDayCreateMouseDown(e: React.MouseEvent, dayKey: string) {
    if (!creationMode || isDayDisabled(dayKey)) return;
    if ((e.target as HTMLElement).closest(".agenda-block")) return;
    if (mode === "model" && (effectivePeriodId == null || effectivePeriodId <= 0)) return;
    if (mode === "realweek" && !mondayStr) return;
    e.preventDefault();
    const dd = { startDay: dayKey, curDay: dayKey };
    allDayDragH.start(dd);
  }

  // Au relâché : UN créneau SANS horaire (journée entière) par jour couvert (clic
  // simple = 1 jour ; glisser horizontal = plusieurs). Récurrent en Modèle, ponctuel
  // daté en Semaine réelle. startTime/endTime vides → bloc « journée entière ».
  function finalizeAllDayCreate(dd: AllDayDrag) {
    const targets = daysSpan(dd.startDay, dd.curDay);
    if (!targets.length) return;
    if (mode === "model") {
      if (effectivePeriodId == null || effectivePeriodId <= 0) return;
      const weeks = abMode && effectiveWeek ? effectiveWeek : "";
      runResults(
        Promise.all(
          targets.map((dayKey) =>
            createRecurringSlotAction({
              serviceId: service.id,
              periodId: effectivePeriodId,
              dayKey,
              startTime: "",
              endTime: "",
              weeks,
              capacity: createCap,
              demandeurIds: createDemIds,
            }),
          ),
        ),
      );
    } else {
      if (!mondayStr) return;
      runResults(
        Promise.all(
          targets.map((dayKey) =>
            createUniqueSlotAction({
              serviceId: service.id,
              slotDate: ymd(addDays(mondayStr, DAY_OFFSET[dayKey] ?? 0)),
              startTime: "",
              endTime: "",
              capacity: createCap,
              demandeurIds: createDemIds,
            }),
          ),
        ),
      );
    }
  }

  // Suivi du glisser-créer « journée entière » : seul le jour sous le curseur compte
  // (la cellule porte data-allday-daykey), le déplacement vertical est ignoré. Le
  // relâché (onUp) = finalizeAllDayCreate. (cf. useDragInteraction.)
  function allDayDragMove(dd: AllDayDrag, e: MouseEvent): AllDayDrag | null {
    const cell = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>("[data-allday-daykey]");
    const dk = cell?.dataset.alldayDaykey;
    const curDay = dk && days.includes(dk) ? dk : dd.curDay;
    return curDay !== dd.curDay ? { ...dd, curDay } : null;
  }

  // Supprime un créneau existant sans réservation (× en mode création) : ouvre une
  // modale de confirmation dédiée.
  function onDeleteEmptySlot(slotId: string) {
    // En semaine réelle, un créneau récurrent n'est pas supprimable (cf. vue Modèle).
    if (isRealweekRecurringSlot(slotId)) return;
    setSlotDeleteTarget(slotId);
  }

  function confirmDeleteSlot() {
    if (!slotDeleteTarget) return;
    runResult(deleteSlotAction(service.id, slotDeleteTarget));
    setSlotDeleteTarget(null);
  }

  // Le créneau `b` peut-il recevoir un collage ? (= mêmes règles que cellCreatable :
  // non complet, période active pour un récurrent, et NON récurrent en semaine réelle.)
  function isCellPasteable(b: Block): boolean {
    if (creationMode) return false;
    const isPonctuel = uniqueIdSet.has(b.slotId);
    if (mode === "realweek" && !isPonctuel) return false;
    const gauge = isPonctuel ? modes.gaugePonct : modes.gaugeRec;
    const used = gauge ? b.used : b.bookings.length;
    if (used >= b.capacity) return false;
    return isPonctuel || (effectivePeriodId != null && effectivePeriodId > 0);
  }

  // Colle la réservation copiée sur le créneau cible `b` (récurrent ou ponctuel).
  // La cible est forcément « collable » (cf. cellCreatable au point d'appel) : non
  // complète, et non récurrente en semaine réelle (verrou de consultation).
  function pasteBookingOnto(b: Block) {
    if (!copiedBooking) return;
    const target = uniqueIdSet.has(b.slotId)
      ? ({ kind: "unique", slotId: b.slotId } as const)
      : ({
          kind: "recurring",
          periodId: effectivePeriodId ?? 0,
          dayKey: b.dayKey,
          slotId: b.slotId,
          week: effectiveWeek ?? "",
        } as const);
    const action = copiedBooking.mode === "cut" ? cutBookingAction : copyBookingAction;
    runResult(action({ serviceId: service.id, sourceBookingId: copiedBooking.id, target }));
    // Couper = à usage unique (la source est déplacée) → on vide le presse-papier.
    if (copiedBooking.mode === "cut") setCopiedBooking(null);
  }

  // Récapitulatif d'une réservation pour la modale de confirmation de suppression
  // (nom + créneau · jour · période · date), port du legacy askDeleteBooking.
  function bookingRecap(bk: Booking): { name: string; details: string; recurring: boolean } {
    const recurring = !uniqueIdSet.has(bk.slotId);
    const name = bk.structure || bk.demandeur || bk.name || "cette réservation";
    const slot = recurring
      ? slots.find((s) => s.id === bk.slotId)
      : uniqueSlots.find((s) => s.id === bk.slotId);
    const parts: string[] = [];
    if (slot) {
      const s = (slot.startTime || "").slice(0, 5);
      const e = (slot.endTime || "").slice(0, 5);
      parts.push(s && e ? `${s} – ${e}` : "Journée entière");
    }
    if (recurring) {
      if (bk.dayKey) parts.push(DAY_NAMES[bk.dayKey] ?? bk.dayKey);
      if (bk.periodId) {
        const p = periods.find((pp) => pp.id === bk.periodId);
        if (p?.label) parts.push(p.label);
      }
    } else {
      const u = uniqueSlots.find((s) => s.id === bk.slotId);
      if (u?.slotDate) parts.push(new Date(`${u.slotDate}T12:00:00`).toLocaleDateString("fr-FR"));
    }
    return { name, details: parts.join(" · "), recurring };
  }

  // Confirme la suppression (ferme la modale détail si ouverte). `motif` (optionnel)
  // est saisi par le gestionnaire et joint au mail de notification envoyé à l'usager.
  function confirmDeleteBooking(motif: string) {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteTarget(null);
    setDetail(null);
    runResult(deleteBookingAdminAction(id, service.id, motif));
  }

  // Ouvre la modale de configuration d'un créneau (capacité + demandeurs autorisés) ;
  // le pré-remplissage depuis le créneau est fait au rendu (SlotConfigModal).
  function openCapModal(slotId: string) {
    setCapModal({ slotId });
  }

  // ── Mode création : glisser-DÉPLACER un créneau vide ────────────────────────
  // Démarre sur le corps d'un bloc vide (× et badges gérés à part). Le créneau suit
  // le curseur (haut du bloc = quart sous le curseur), durée préservée.
  // Créneau récurrent affiché en SEMAINE RÉELLE : non éditable (config, redimension,
  // déplacement, suppression interdits) — toute édition se fait en vue « Modèle de période ».
  const isRealweekRecurringSlot = (slotId: string) =>
    mode === "realweek" && !uniqueIdSet.has(slotId);

  function onMoveSlotMouseDown(e: React.MouseEvent, b: Block) {
    justMovedRef.current = false; // nouvelle interaction : on repart d'un « pas déplacé »
    if (!creationMode || b.bookings.length > 0 || b.isAllDay) return;
    if (isRealweekRecurringSlot(b.slotId)) return;
    if (isDayDisabled(b.dayKey)) return;
    if ((e.target as HTMLElement).closest("button")) return; // ne pas gêner la croix ×
    e.stopPropagation(); // n'amorce pas un glisser-CRÉER sur la colonne
    e.preventDefault();
    const colTop = (e.currentTarget as HTMLElement)
      .closest<HTMLElement>(".agenda-day-col")
      ?.getBoundingClientRect().top;
    if (colTop == null) return;
    const grabMin = quarterAtY(colTop, e.clientY);
    const md = {
      slotId: b.slotId,
      isUnique: uniqueIdSet.has(b.slotId),
      fromDay: b.dayKey,
      durationMin: Math.max(15, b.endMin - b.startMin),
      origMin: b.startMin,
      grabOffsetMin: grabMin - b.startMin,
      colTop,
      curMin: b.startMin,
      curDay: b.dayKey,
    };
    moveDragH.start(md);
  }

  // Au relâché : déplace le créneau vers (curDay, curMin → curMin+durée). No-op si
  // rien ne change. Récurrent → jour + horaires ; ponctuel → date + horaires.
  function finalizeMove(md: MoveDrag) {
    let startMin = md.curMin;
    let endMin = startMin + md.durationMin;
    if (endMin > gridEndMin) {
      endMin = gridEndMin;
      startMin = Math.max(gridStartMin, endMin - md.durationMin);
    }
    const startTime = minToHHMM(startMin);
    const endTime = minToHHMM(endMin);
    if (md.isUnique) {
      if (!mondayStr) return;
      runResult(
        moveUniqueSlotAction({
          serviceId: service.id,
          slotId: md.slotId,
          slotDate: ymd(addDays(mondayStr, DAY_OFFSET[md.curDay] ?? 0)),
          startTime,
          endTime,
        }),
      );
    } else {
      runResult(
        moveRecurringSlotAction({
          serviceId: service.id,
          slotId: md.slotId,
          fromDayKey: md.fromDay,
          toDayKey: md.curDay,
          startTime,
          endTime,
        }),
      );
    }
  }

  // Suivi du glisser-déplacer : début = quart sous le curseur − décalage de saisie
  // (borné à la grille) + colonne (jour) survolée. (cf. useDragInteraction.)
  function moveDragMove(md: MoveDrag, e: MouseEvent): MoveDrag | null {
    const raw = quarterAtY(md.colTop, e.clientY) - md.grabOffsetMin;
    const q = Math.max(gridStartMin, Math.min(gridEndMin - md.durationMin, raw));
    const colEl = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>("[data-daykey]");
    const dk = colEl?.dataset.daykey;
    const curDay = dk && days.includes(dk) && !isDayDisabled(dk) ? dk : md.curDay;
    return q !== md.curMin || curDay !== md.curDay ? { ...md, curMin: q, curDay } : null;
  }
  // Relâché : on ne déplace que si jour ou début a changé. Si déplacé, on marque le
  // coup pour que le clic résiduel n'ouvre pas la modale de config.
  function moveDragUp(md: MoveDrag) {
    if (md.curDay !== md.fromDay || md.curMin !== md.origMin) {
      finalizeMove(md);
      justMovedRef.current = true;
    }
  }

  // ── Mode création : glisser-REDIMENSIONNER un créneau vide par un bord ───────
  // Poignée haut/bas sur un bloc vide. Le bord opposé reste fixe ; on étire jusqu'au
  // quart sous le curseur (durée minimale d'un quart). Validé au relâché.
  function onResizeSlotMouseDown(e: React.MouseEvent, b: Block, edge: "top" | "bottom") {
    if (!creationMode || b.bookings.length > 0 || b.isAllDay) return;
    if (isDayDisabled(b.dayKey) || isRealweekRecurringSlot(b.slotId)) return;
    justMovedRef.current = true; // redimensionnement → le clic résiduel n'ouvre pas la modale
    e.stopPropagation(); // n'amorce ni un glisser-déplacer ni un glisser-créer
    e.preventDefault();
    const colTop = (e.currentTarget as HTMLElement)
      .closest<HTMLElement>(".agenda-day-col")
      ?.getBoundingClientRect().top;
    if (colTop == null) return;
    const rd = {
      slotId: b.slotId,
      isUnique: uniqueIdSet.has(b.slotId),
      dayKey: b.dayKey,
      edge,
      fixedMin: edge === "top" ? b.endMin : b.startMin,
      origStart: b.startMin,
      origEnd: b.endMin,
      colTop,
      curStart: b.startMin,
      curEnd: b.endMin,
    };
    resizeDragH.start(rd);
  }

  // Au relâché : applique les nouveaux horaires (même jour/date) via les actions de
  // déplacement. Récurrent → jour identique ; ponctuel → même date.
  function finalizeResize(rd: ResizeDrag) {
    const startTime = minToHHMM(rd.curStart);
    const endTime = minToHHMM(rd.curEnd);
    if (rd.isUnique) {
      if (!mondayStr) return;
      runResult(
        moveUniqueSlotAction({
          serviceId: service.id,
          slotId: rd.slotId,
          slotDate: ymd(addDays(mondayStr, DAY_OFFSET[rd.dayKey] ?? 0)),
          startTime,
          endTime,
        }),
      );
    } else {
      runResult(
        moveRecurringSlotAction({
          serviceId: service.id,
          slotId: rd.slotId,
          fromDayKey: rd.dayKey,
          toDayKey: rd.dayKey,
          startTime,
          endTime,
        }),
      );
    }
  }

  // Suivi du glisser-redimensionner : le bord opposé reste fixe (fixedMin), on étire
  // le bord saisi jusqu'au quart sous le curseur (durée min. d'un quart). onUp ne
  // finalise que si la plage a changé. (cf. useDragInteraction.)
  function resizeDragMove(rd: ResizeDrag, e: MouseEvent): ResizeDrag | null {
    const q = quarterAtY(rd.colTop, e.clientY);
    let curStart = rd.curStart;
    let curEnd = rd.curEnd;
    if (rd.edge === "top") {
      curStart = Math.max(gridStartMin, Math.min(q, rd.fixedMin - 15));
      curEnd = rd.fixedMin;
    } else {
      curStart = rd.fixedMin;
      curEnd = Math.min(gridEndMin, Math.max(q + 15, rd.fixedMin + 15));
    }
    return curStart !== rd.curStart || curEnd !== rd.curEnd ? { ...rd, curStart, curEnd } : null;
  }
  function resizeDragUp(rd: ResizeDrag) {
    if (rd.curStart !== rd.origStart || rd.curEnd !== rd.origEnd) finalizeResize(rd);
  }

  // ── Mode création : glisser-ÉTENDRE un créneau vide latéralement (gauche/droite) ──
  // Poignée gauche/droite sur un bloc vide. En traversant les colonnes, on prépare un
  // créneau par jour couvert (même plage horaire que la source). Validé au relâché.
  function onResizeSlotMouseDownH(e: React.MouseEvent, b: Block, edge: "left" | "right") {
    if (!creationMode || b.bookings.length > 0 || b.isAllDay) return;
    if (isDayDisabled(b.dayKey) || isRealweekRecurringSlot(b.slotId)) return;
    justMovedRef.current = true; // extension latérale → le clic résiduel n'ouvre pas la modale
    e.stopPropagation(); // n'amorce ni déplacer, ni créer, ni redimensionner vertical
    e.preventDefault();
    const hd = {
      slotId: b.slotId,
      isUnique: uniqueIdSet.has(b.slotId),
      startMin: b.startMin,
      endMin: b.endMin,
      edge,
      fromDay: b.dayKey,
      curDay: b.dayKey,
    };
    hResizeDragH.start(hd);
  }

  // Au relâché : crée un créneau (même horaire) dans chaque colonne couverte hormis la
  // source. Récurrent en Modèle de période, ponctuel daté en Semaine réelle.
  function finalizeHResize(hd: HResizeDrag) {
    const targets = daysSpan(hd.fromDay, hd.curDay).filter((d) => d !== hd.fromDay);
    if (!targets.length) return;
    const startTime = minToHHMM(hd.startMin);
    const endTime = minToHHMM(hd.endMin);
    if (hd.isUnique) {
      if (!mondayStr) return;
      runResults(
        Promise.all(
          targets.map((dayKey) =>
            createUniqueSlotAction({
              serviceId: service.id,
              slotDate: ymd(addDays(mondayStr, DAY_OFFSET[dayKey] ?? 0)),
              startTime,
              endTime,
              capacity: createCap,
              demandeurIds: createDemIds,
            }),
          ),
        ),
      );
    } else {
      if (effectivePeriodId == null || effectivePeriodId <= 0) return;
      const weeks = abMode && effectiveWeek ? effectiveWeek : "";
      runResults(
        Promise.all(
          targets.map((dayKey) =>
            createRecurringSlotAction({
              serviceId: service.id,
              periodId: effectivePeriodId,
              dayKey,
              startTime,
              endTime,
              weeks,
              capacity: createCap,
              demandeurIds: createDemIds,
            }),
          ),
        ),
      );
    }
  }

  // Suivi du glisser-étendre latéral : seule la colonne (jour) survolée compte. onUp
  // ne finalise (un créneau par jour couvert) que si le jour a changé. (cf. useDragInteraction.)
  function hResizeDragMove(hd: HResizeDrag, e: MouseEvent): HResizeDrag | null {
    const colEl = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>("[data-daykey]");
    const dk = colEl?.dataset.daykey;
    const curDay = dk && days.includes(dk) && !isDayDisabled(dk) ? dk : hd.curDay;
    return curDay !== hd.curDay ? { ...hd, curDay } : null;
  }
  function hResizeDragUp(hd: HResizeDrag) {
    if (hd.curDay !== hd.fromDay) finalizeHResize(hd);
  }

  // Parents récurrents ayant AU MOINS un enfant/miroir pointé — précalculé une fois par
  // jeu de réservations (au lieu d'un balayage O(bookings) à chaque appel de lockedByPointage,
  // lui-même invoqué plusieurs fois par badge dans la modale pile : O(badges×bookings×~5)).
  const parentsWithPointedChild = useMemo(() => {
    const s = new Set<number>();
    for (const c of bookings) {
      if (c.parentBookingId != null && c.pointage != null) s.add(c.parentBookingId);
    }
    return s;
  }, [bookings]);

  // Clic rapide sur un bloc en mode validation / pointage (sinon : ouvre le menu).
  // Réservation verrouillée par le pointage : elle-même pointée (ponctuelle/miroir),
  // OU parent récurrent dont un miroir est pointé. Verrouillée = ni validation, ni
  // déplacement, ni suppression, ni copie (cf. règles métier).
  const lockedByPointage = (bk: Booking): boolean =>
    bk.pointage != null || (bk.bookingType === "recurring" && parentsWithPointedChild.has(bk.id));

  function onBlockQuickAction(bk: Booking): boolean {
    if (validation) {
      // Une résa verrouillée (pointée, ou parent à miroir pointé) ne se valide plus.
      // On laisse le clic ouvrir la fiche plutôt que d'agir silencieusement.
      if (lockedByPointage(bk)) return false;
      // Bascule validé ↔ en attente (legacy _quickValidate togglait dans les deux sens).
      runResult(setBookingValidatedAction(bk.id, service.id, !bk.validated));
      return true;
    }
    if (pointageMode && mode === "realweek") {
      // Cycle présent → absent → effacé.
      const next: Pointage = !bk.pointage ? "present" : bk.pointage === "present" ? "absent" : null;
      runResult(setBookingPointageAction(bk.id, service.id, next));
      return true;
    }
    return false;
  }

  // Impression « liste » (bouton N&B) : au lieu du modèle graphique, la LISTE nominative
  // des réservations de TOUS les usagers pour la semaine affichée (Semaine réelle) ou la
  // période affichée (Modèle). Une ligne par occurrence datée (ponctuels + miroirs des
  // récurrentes), via une action gardée gestionnaire (listDatedSessions). Rendu dans un
  // iframe caché (printHtmlDocument) — sans pop-up ni fenêtre visible.
  async function printSessionsList() {
    if (typeof window === "undefined") return;
    let from = "";
    let to = "";
    let scopeLabel = "";
    if (mode === "realweek") {
      if (!mondayStr) return;
      from = mondayStr;
      to = sundayStr ?? mondayStr;
      scopeLabel = `Semaine du ${shortDateFmt.format(addDays(mondayStr, 0))} au ${shortDateFmt.format(
        addDays(mondayStr, 6),
      )}`;
    } else {
      const period = visiblePeriods[periodIdx] ?? null;
      if (!period?.dateStart || !period?.dateEnd) return;
      from = period.dateStart;
      to = period.dateEnd;
      scopeLabel = period.label;
    }
    if (!from || !to) return;

    let sessions: Awaited<ReturnType<typeof listAgendaSessionsAction>> = [];
    try {
      sessions = await listAgendaSessionsAction(service.id, from, to);
    } catch {
      // requireServiceManager peut rejeter un appelant non autorisé — liste vide alors.
    }
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const pointageOf = (p?: string | null) => (p === "present" ? "P" : p === "absent" ? "A" : "—");
    const rows = sessions.flatMap((sess) =>
      sess.attendees.map((a) => ({
        date: sess.dateLabel,
        creneau: `${sess.startTime} – ${sess.endTime}`,
        identite: `${a.nom} ${a.prenom}`.trim(),
        struct: a.structure || a.demandeur,
        enfants: a.enfants,
        accompagnants: a.accompagnants,
        theme: a.theme || "—",
        pointage: pointageOf(a.pointage),
      })),
    );
    const head = [
      "Date",
      "Créneau",
      "Identité",
      "Structure / Demandeur",
      "Enf.",
      "Acc.",
      "Thème",
      "P/A",
    ];
    const inner = rows.length
      ? `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows
          .map(
            (r) =>
              `<tr><td>${esc(r.date)}</td><td>${esc(r.creneau)}</td><td>${esc(r.identite)}</td><td>${esc(r.struct)}</td><td class="c">${r.enfants}</td><td class="c">${r.accompagnants}</td><td>${esc(r.theme)}</td><td class="c">${esc(r.pointage)}</td></tr>`,
          )
          .join("")}</tbody></table>`
      : '<p class="empty">Aucune réservation pour cette période.</p>';
    const titleStr = `${service.label} — ${scopeLabel}`;
    // Plus compact : police réduite, cellules sur une seule ligne (white-space:nowrap)
    // pour que « 09:00 – 10:00 » et l'identité ne se coupent pas.
    const css =
      "*{color:#000;background:#fff}body{font-family:system-ui,Arial,sans-serif;margin:18px;font-size:10px}h1{font-size:14px;margin:0 0 3px}.meta{color:#444;margin:0 0 10px;font-size:10px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:2px 6px;text-align:left;white-space:nowrap}td.c{text-align:center}th{background:#eee !important;font-size:9px;text-transform:uppercase;letter-spacing:.03em}.empty{color:#444}";
    printHtmlDocument(
      `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>${esc(titleStr)}</title><style>${css}</style></head><body><h1>${esc(titleStr)}</h1><div class="meta">${rows.length} réservation${rows.length > 1 ? "s" : ""}</div>${inner}</body></html>`,
    );
  }

  // Restaure la vue (exercice / période / semaine) depuis sessionStorage au montage,
  // pour revenir sur la sélection précédente quand on rouvre la page. À défaut, ancre
  // la semaine réelle sur le lundi courant. (Client uniquement → pas de mismatch SSR.)
  const persistSkip = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: restauration au montage uniquement
  useEffect(() => {
    let anchored = false;
    try {
      const raw = sessionStorage.getItem(`agenda-admin-view:${service.id}`);
      if (raw) {
        const v = JSON.parse(raw) as Partial<{
          exerciceId: number | null;
          periodIdx: number;
          anchorMonday: string;
          weekAB: "A" | "B";
        }>;
        // Ne restaure l'exercice que s'il existe encore (sinon défaut).
        if (v.exerciceId == null || exercices.some((e) => e.id === v.exerciceId)) {
          if (v.exerciceId !== undefined) setCurrentExerciceId(v.exerciceId);
        }
        if (typeof v.periodIdx === "number" && v.periodIdx >= 0) setPeriodIdx(v.periodIdx);
        if (v.weekAB === "A" || v.weekAB === "B") setWeekAB(v.weekAB);
        if (typeof v.anchorMonday === "string") {
          setAnchorMonday(v.anchorMonday);
          anchored = true;
        }
      }
    } catch {}
    if (!anchored) setAnchorMonday(ymd(mondayOf(new Date())));
  }, []);

  // Persiste la vue à chaque changement. On saute le tout 1er run (montage, AVANT que
  // la restauration ci-dessus n'ait été appliquée) pour ne pas écraser la valeur
  // stockée avec les valeurs par défaut.
  useEffect(() => {
    if (persistSkip.current) {
      persistSkip.current = false;
      return;
    }
    try {
      sessionStorage.setItem(
        `agenda-admin-view:${service.id}`,
        JSON.stringify({ exerciceId: currentExerciceId, periodIdx, anchorMonday, weekAB }),
      );
    } catch {}
  }, [service.id, currentExerciceId, periodIdx, anchorMonday, weekAB]);

  // Garde-fou : si la période sélectionnée/mémorisée est hors plage (ex. période
  // supprimée, ou index restauré du sessionStorage devenu invalide), on retombe sur
  // la période qui couvre la date du jour — sinon la première. Évite un agenda vide
  // bloqué sur une période inexistante/hors saison.
  useEffect(() => {
    if (visiblePeriods.length === 0) return;
    if (periodIdx >= 0 && periodIdx < visiblePeriods.length) return;
    const today = ymd(new Date());
    const todayIdx = visiblePeriods.findIndex(
      (p) => p.dateStart && p.dateEnd && p.dateStart <= today && p.dateEnd >= today,
    );
    setPeriodIdx(todayIdx >= 0 ? todayIdx : 0);
  }, [periodIdx, visiblePeriods]);

  // Le mode pointage n'a de sens qu'en semaine réelle : on le désactive si on
  // repasse en "modèle de période" (cohérent avec le legacy).
  useEffect(() => {
    if (mode !== "realweek" && pointageMode) setPointageMode(false);
  }, [mode, pointageMode]);

  // Verrouille la période active en semaine réelle : dès qu'une période est
  // dérivée pour la semaine courante, on la fige dans rwPeriodId. La nav ◀/▶
  // s'appuie alors sur cette période figée (et non sur une re-dérivation qui
  // basculerait sur la voisine aux frontières). Re-verrouille si l'ancien verrou
  // ne couvre plus la semaine (ex. après « Aujourd'hui »). Cf. legacy l.6481-6490.
  useEffect(() => {
    if (mode !== "realweek") return;
    if (coveringPeriod && coveringPeriod.id !== rwPeriodId) setRwPeriodId(coveringPeriod.id);
    else if (!coveringPeriod && rwPeriodId !== null) setRwPeriodId(null);
  }, [mode, coveringPeriod, rwPeriodId]);

  function openCreate(dayKey: string, slotId: string, ponctuel = false, slotDate?: string) {
    setCUser("");
    setCDemType("");
    setCStructure("");
    setCEnfants("0");
    setCAccompagnants("0");
    setCTheme("");
    setCError(null);
    setCreateCtx({ dayKey, slotId, ponctuel, slotDate });
  }

  function submitCreate() {
    if (!createCtx) return;
    if (!cUser) {
      setCError("Choisissez un usager.");
      return;
    }
    // Créneau ponctuel : réservation ponctuelle (pas de période ni de jour).
    if (createCtx.ponctuel) {
      const slotId = createCtx.slotId;
      startTransition(async () => {
        const res = await createUniqueBookingAction({
          serviceId: service.id,
          slotId,
          userId: cUser,
          enfants: Number(cEnfants) || 0,
          accompagnants: Number(cAccompagnants) || 0,
          theme: cTheme,
        });
        if (!res.ok) {
          setCError(res.error ?? "Échec.");
          return;
        }
        setCreateCtx(null);
        router.refresh();
      });
      return;
    }
    const createPeriodId =
      effectivePeriodId != null && effectivePeriodId > 0 ? effectivePeriodId : null;
    if (createPeriodId == null) {
      setCError("Aucune période active pour créer une réservation.");
      return;
    }
    startTransition(async () => {
      const res = await createRecurringBookingAction({
        serviceId: service.id,
        slotId: createCtx.slotId,
        periodId: createPeriodId,
        dayKey: createCtx.dayKey,
        userId: cUser,
        enfants: Number(cEnfants) || 0,
        accompagnants: Number(cAccompagnants) || 0,
        theme: cTheme,
        week: effectiveWeek ?? "",
      });
      if (!res.ok) {
        setCError(res.error ?? "Échec.");
        return;
      }
      setCreateCtx(null);
      router.refresh();
    });
  }

  const createSlot = createCtx
    ? (slots.find((s) => s.id === createCtx.slotId) ??
      uniqueSlots.find((s) => s.id === createCtx.slotId) ??
      null)
    : null;

  // Bloc de la pile ouverte, recalculé en direct (reste à jour après refresh ;
  // se referme tout seul si le créneau n'a plus de réservation).
  const stackBlock = stackKey
    ? (blocksByDay[stackKey.dayKey]?.find((bl) => bl.slotId === stackKey.slotId) ?? null)
    : null;
  const stackSlot = stackKey
    ? (slots.find((s) => s.id === stackKey.slotId) ??
      uniqueSlots.find((s) => s.id === stackKey.slotId) ??
      null)
    : null;

  // Rendu d'UN bloc-créneau (timed ou journée entière), réutilisé par la grille
  // horaire et par la bande « Journée entière » (port du legacy
  // _renderAgendaAdminBlock(b, isAlldayBlock)). En all-day : pas de positionnement
  // absolu (le CSS .agenda-block.is-allday gère position/​taille dans la cellule).
  // ── Info-bulle « Journées concernées » au survol d'un créneau récurrent (vue
  // Modèle de période), alignée sur le côté Réservation : liste les dates concrètes
  // (créneaux miroirs datés), rendue en portail et suivant la souris.
  const concernedDatesForBlock = (slotId: string, dayKey: string): string[] =>
    uniqueSlots
      .filter(
        (u) => u.parentSlotId === slotId && u.slotDate && dayKeyFromYmd(u.slotDate) === dayKey,
      )
      .map((u) => u.slotDate)
      .filter((d) => {
        if (!abMode || effectiveWeek == null) return true;
        // Convention UNIQUE de l'app : semaine ISO impaire = A (lib/iso-week).
        // effectiveWeek (Modèle = weekAB, Semaine réelle = realWeekParity) est dans
        // cette même convention → comparaison directe, le jour en cours est inclus.
        return slotWeekTag(d) === effectiveWeek;
      })
      .sort();

  // Métadonnées affichées dans l'info-bulle « Journées concernées » d'un créneau
  // récurrent : capacité (celle du bloc affiché, repli sur slot/​service) et
  // demandeurs autorisés. demandeurs = undefined si le service n'a pas de demandeurs
  // (ligne masquée) ; tableau vide = aucune restriction (« Ouvert à tous »).
  const recMetaForBlock = (
    slotId: string,
    dayKey: string,
  ): {
    capacity?: number | null;
    demandeurs?: string[];
    recurInfo?: { period: string; dayHours: string };
  } => {
    const slot = slots.find((s) => s.id === slotId);
    const block = blocksByDay[dayKey]?.find((bl) => bl.slotId === slotId);
    const capacity = block?.capacity ?? slot?.capacity ?? service.capacity;
    // Résumé récurrent affiché dans l'info-bulle : période active + jour/heures du
    // créneau PARENT (remplace la liste des dates côté admin).
    const recurInfo = slot
      ? {
          period: periods.find((p) => p.id === effectivePeriodId)?.label ?? "",
          dayHours: `${DAY_NAMES[slot.slotDay ?? ""] ?? slot.slotDay ?? ""} · ${slot.startTime}–${slot.endTime}`,
        }
      : undefined;
    if (!serviceDemandeurs.length) return { capacity, recurInfo };
    const ids = slotDemandeurs[slotId] ?? [];
    const demandeurs = serviceDemandeurs.filter((d) => ids.includes(d.id)).map((d) => d.label);
    return { capacity, demandeurs, recurInfo };
  };

  // Handlers de renderBlock via un ref STABLE : réassignés à chaque rendu (toujours
  // frais) mais HORS des déps du useCallback de renderBlock → évite la cascade virale
  // de useCallback et permet la mémo des blocs par jour (perf, audit grilles).
  const blockApi = {
    onMoveSlotMouseDown,
    clearTip,
    openCapModal,
    openCreate,
    runResult,
    onResizeSlotMouseDown,
    onResizeSlotMouseDownH,
    onDeleteEmptySlot,
    onBlockQuickAction,
    warnRecurringValidation,
    lockedByPointage,
  };
  const blockApiRef = useRef(blockApi);
  blockApiRef.current = blockApi;

  const renderBlock = useCallback(
    (b: Block, allday: boolean) => {
      const {
        onMoveSlotMouseDown,
        clearTip,
        openCapModal,
        openCreate,
        runResult,
        onResizeSlotMouseDown,
        onResizeSlotMouseDownH,
        onDeleteEmptySlot,
        onBlockQuickAction,
        warnRecurringValidation,
        lockedByPointage,
      } = blockApiRef.current;
      // Info-bulle de survol du créneau (capacité + demandeurs autorisés, et pour les
      // Créneau COMPLET (mode-aware) → pas de création possible. Jauge = enfants[+adultes] ;
      // sinon = nombre de réservations (1/résa).
      const isPonctuelCell = uniqueIdSet.has(b.slotId);
      // Créneau récurrent en semaine réelle : non éditable (ni déplacement, ni
      // redimension, ni config, ni suppression) — cf. vue Modèle de période.
      const realWeekRecurring = mode === "realweek" && !isPonctuelCell;
      const gaugeForCell = isPonctuelCell ? modes.gaugePonct : modes.gaugeRec;
      const cellFull = (gaugeForCell ? b.used : b.bookings.length) >= b.capacity;
      // Le créneau est cliquable pour créer une réservation (hors mode création).
      const cellCreatable =
        !creationMode &&
        !cellFull &&
        !realWeekRecurring &&
        (isPonctuelCell || (effectivePeriodId != null && effectivePeriodId > 0));
      const pct = Math.min(100, b.capacity > 0 ? (b.used / b.capacity) * 100 : 0);
      // Couleur du compteur de places (barre de jauge ET texte X/Y) selon le
      // remplissage — seuils uniques de l'app (gaugeColor). Indépendant de la
      // couleur du créneau (jaune/vert), qui ne varie plus.
      const fillColor = gaugeColor(pct);
      // Mode NON-jauge : le compteur reflète le NOMBRE de réservations (1 par résa),
      // indépendamment du nombre d'enfants/adultes. Couleur selon ce ratio.
      const count = b.bookings.length;
      const countPct = Math.min(100, b.capacity > 0 ? (count / b.capacity) * 100 : 0);
      const countColor = gaugeColor(countPct);
      const posStyle: React.CSSProperties = allday
        ? {}
        : (() => {
            // top/height dérivés des minutes via mapMinToY (compactage pause).
            // Bornage à la plage visible + 2px de gap haut/bas (cf. legacy).
            const ys = mapMinToY(Math.max(b.startMin, gridStartMin));
            const ye = mapMinToY(Math.min(b.endMin, gridEndMin));
            return {
              top: ys + 2,
              height: Math.max(14, ye - ys - 4),
              left: `calc(${b.leftPct}% + 2px)`,
              width: `calc(${b.widthPct}% - 4px)`,
            };
          })();
      return (
        // biome-ignore lint/a11y/useKeyWithClickEvents: bloc-créneau agenda (clic = créer)
        <div
          key={`${b.dayKey}|${b.slotId}`}
          // data-* pour l'info-bulle déléguée (capacité + demandeurs, et dates pour un
          // récurrent). Active sur tous les créneaux, y compris « journée entière ».
          data-slot-tip=""
          data-slotid={b.slotId}
          data-daykey={b.dayKey}
          // 2 couleurs fixes, sans variation selon le remplissage/jauge : vert pour
          // les ponctuels autonomes, jaune (défaut .agenda-block) pour les récurrents
          // et leurs miroirs (cf. légende Récurrent/Ponctuel).
          className={`agenda-block${allday ? " is-allday" : ""}`}
          style={{
            ...posStyle,
            // Centrage vertical des badges dans le créneau (inline = priorité
            // sur les feuilles concurrentes GRID_CSS / app-legacy.css).
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            // Ponctuel autonome (non miroir) → couleur distinctive pilotée par
            // --slot-uniq-color (cf. .agenda-block.is-uniq) : fond = color-mix 25 %,
            // bordure = couleur pleine.
            ...(uniqueIdSet.has(b.slotId)
              ? {
                  background: "color-mix(in srgb, var(--slot-uniq-color) 25%, transparent)",
                  borderColor: "var(--slot-uniq-color)",
                }
              : {}),
            // Mode création : créneau vide déplaçable (curseur move) ; bloc en cours
            // de déplacement estompé. Hors création : pointer si on peut y créer une résa.
            ...(creationMode && b.bookings.length === 0 && !allday && !realWeekRecurring
              ? { cursor: "move" }
              : cellCreatable
                ? { cursor: "pointer" }
                : {}),
            ...(moveDrag?.slotId === b.slotId || resizeDrag?.slotId === b.slotId
              ? { opacity: 0.35 }
              : {}),
          }}
          onMouseDown={(e) => onMoveSlotMouseDown(e, b)}
          // Clic droit sur la zone vide d'un créneau → menu « Coller » (si presse-papier actif).
          // Pas de menu en mode création ni sur un récurrent en semaine réelle (consultation).
          onContextMenu={(e) => {
            if (creationMode || realWeekRecurring) return;
            e.preventDefault();
            clearTip(); // ferme l'info-bulle
            if (!copiedBooking) return;
            setCtxMenu({ x: e.clientX, y: e.clientY, kind: "cell", block: b });
          }}
          onClick={(e) => {
            // Clic sur la zone vide du créneau → nouvelle réservation.
            e.stopPropagation();
            // Mode création : le bloc ne crée pas de réservation (× = supprimer). Un clic
            // (pas un glisser-déplacer) ouvre la modale de configuration du créneau.
            if (creationMode) {
              if (justMovedRef.current) {
                justMovedRef.current = false;
                return;
              }
              // En semaine réelle, un créneau récurrent n'est pas configurable (cf. vue Modèle).
              if (realWeekRecurring) return;
              openCapModal(b.slotId);
              return;
            }
            // Pas de création si le créneau est COMPLET (plus de place restante)
            // ou verrouillé (récurrent en semaine réelle) — cf. cellCreatable.
            if (!cellCreatable) return;
            // Créneau ponctuel : ouvre la création d'une réservation ponctuelle.
            if (isPonctuelCell) {
              const u = uniqueSlots.find((s) => s.id === b.slotId);
              openCreate(b.dayKey, b.slotId, true, u?.slotDate);
              return;
            }
            openCreate(b.dayKey, b.slotId);
          }}
          onDragOver={(e) => {
            if (draggingId == null) return;
            const dragged = bookings.find((bk) => bk.id === draggingId);
            if (!dragged) return;
            // Cible valide = MÊME type que la source (récurrent↔récurrent ou
            // ponctuel↔ponctuel) et pas un récurrent en semaine réelle (consultation).
            if (uniqueIdSet.has(dragged.slotId) === isPonctuelCell && !realWeekRecurring)
              e.preventDefault();
          }}
          onDrop={(e) => {
            // Le créneau est la cible de drop : déplace la résa glissée ici.
            e.preventDefault();
            e.stopPropagation();
            if (draggingId == null) return;
            const id = draggingId;
            const dragged = bookings.find((bk) => bk.id === id);
            setDraggingId(null);
            if (!dragged) return;
            // Refus : changement de type (récurrent↔ponctuel) ou récurrent en semaine réelle.
            if (uniqueIdSet.has(dragged.slotId) !== isPonctuelCell || realWeekRecurring) return;
            runResult(moveBookingAction(id, service.id, b.dayKey, b.slotId));
          }}
        >
          {/* Mode création : poignées de bord (haut/bas) pour redimensionner un créneau
          vide. Curseur ns-resize au survol ; le mousedown amorce le glisser-étirer
          (stopPropagation → n'amorce ni déplacer ni créer). En semaine réelle, les
          créneaux récurrents ne sont pas redimensionnables (pas de poignées). */}
          {creationMode && b.bookings.length === 0 && !allday && !realWeekRecurring && (
            <>
              <div
                data-tip="Étirer le créneau"
                onMouseDown={(e) => onResizeSlotMouseDown(e, b, "top")}
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: 0,
                  height: 7,
                  cursor: "ns-resize",
                  zIndex: 3,
                }}
              />
              <div
                data-tip="Étirer le créneau"
                onMouseDown={(e) => onResizeSlotMouseDown(e, b, "bottom")}
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: 7,
                  cursor: "ns-resize",
                  zIndex: 3,
                }}
              />
              {/* Poignées gauche/droite : étendre le créneau aux colonnes voisines (un
              créneau par jour couvert). Bande centrale (top/bottom 7px) pour laisser
              les coins aux poignées verticales. */}
              <div
                data-tip="Étendre aux jours voisins"
                onMouseDown={(e) => onResizeSlotMouseDownH(e, b, "left")}
                style={{
                  position: "absolute",
                  left: 0,
                  top: 7,
                  bottom: 7,
                  width: 7,
                  cursor: "ew-resize",
                  zIndex: 3,
                }}
              />
              <div
                data-tip="Étendre aux jours voisins"
                onMouseDown={(e) => onResizeSlotMouseDownH(e, b, "right")}
                style={{
                  position: "absolute",
                  right: 0,
                  top: 7,
                  bottom: 7,
                  width: 7,
                  cursor: "ew-resize",
                  zIndex: 3,
                }}
              />
            </>
          )}
          {/* Badges centrés via le parent .agenda-block (justify-content:center).
          Le chips ne grandit pas pour que le centrage opère ; la jauge est
          sortie du flux (position absolue en bas). */}
          <div
            className="agenda-block-chips"
            style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", gap: 2 }}
          >
            {/* Mode création : croix de suppression sur les créneaux vides (confirmation).
              Même style que la croix des badges colorés (planning-name-tag-close).
              En SEMAINE RÉELLE, les créneaux récurrents ne sont pas supprimables (pas de croix) :
              leur suppression se fait en vue « Modèle de période ». */}
            {creationMode && b.bookings.length === 0 && !realWeekRecurring && (
              <button
                type="button"
                className="planning-name-tag-close"
                data-tip="Supprimer ce créneau"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteEmptySlot(b.slotId);
                }}
              >
                ×
              </button>
            )}
            {/* ≥2 réservations → pile de badges (legacy .planning-stack-wrap) :
            jusqu'à 3 badges superposés + compteur ; clic = modale liste. */}
            {b.bookings.length >= 2 && (
              // biome-ignore lint/a11y/useKeyWithClickEvents: pile (clic = liste des réservations)
              <div
                className="planning-stack-wrap"
                data-tip={`${b.bookings.length} réservations — cliquer pour voir la liste`}
                style={{
                  // La pile a une hauteur de mise en page d'un seul badge (44px), mais
                  // l'empilement déborde dessous : badge le plus profond décalé de +8px
                  // (3+ résas, .stack-back2) ou +4px (2 résas, .stack-back), plus son ombre
                  // (offset 2 + blur 4 ≈ 6px). On réserve ce débordement sous la pile pour
                  // que le centrage vertical tienne compte de la pile entière (pastille
                  // exclue, son débordement en haut n'est volontairement pas compensé).
                  marginBottom: (b.bookings.length >= 3 ? 8 : 4) + 6,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setStackKey({ slotId: b.slotId, dayKey: b.dayKey });
                }}
              >
                {(
                  [
                    ...(b.bookings[2] ? [{ bk: b.bookings[2], cls: "stack-back2" }] : []),
                    ...(b.bookings[1] ? [{ bk: b.bookings[1], cls: "stack-back" }] : []),
                    { bk: b.bookings[0], cls: "stack-front" },
                  ] as { bk: Booking; cls: string }[]
                ).map(({ bk, cls }) => (
                  <div key={bk.id} className={cls}>
                    <div
                      className={`planning-name-tag ${bk.validated ? "is-validated" : "is-pending"}`}
                      style={{ ...badgeStyle(bk.validated), position: "relative" }}
                      data-tip={badgeTitle(bk)}
                    >
                      {/* La pastille P/A doit aussi apparaître sur les badges
                        de la pile (cf. legacy), pas seulement dans la modale. */}
                      <PointagePill pointage={bk.pointage} />
                      {(bk.structure || bk.demandeur) && (
                        <span style={{ fontSize: ".62rem", fontWeight: 700 }}>
                          {bk.structure || bk.demandeur}
                        </span>
                      )}
                      <span style={{ fontSize: ".62rem", color: "var(--muted)" }}>{bk.name}</span>
                      {modes.themeMode && bk.theme && (
                        <span
                          style={{
                            fontSize: ".62rem",
                            fontWeight: 600,
                            color: bk.validated ? "var(--accent)" : "rgba(232, 164, 90, .95)",
                          }}
                        >
                          {bk.theme}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                <span className="planning-stack-count">{b.bookings.length}</span>
              </div>
            )}
            {b.bookings.length < 2 &&
              b.bookings.map((bk) => {
                const pendingValidation = validation && !bk.validated;
                const quickActive = pendingValidation || (pointageMode && mode === "realweek");
                // Legacy : ligne1 = structure sinon catégorie (demandeur),
                // ligne2 = NOM Prénom, ligne3 = thème (si présent).
                const primaryLabel = bk.structure || bk.demandeur;
                const accentColor = bk.validated ? "var(--accent)" : "rgba(232, 164, 90, .95)";
                // Verrouillée (pointée, ou parent à miroir pointé) → ni déplacement, ni
                // suppression, ni copie (cf. règles métier).
                const locked = lockedByPointage(bk);
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: badge (clic = valider/pointer/éditer)
                  <div
                    key={bk.id}
                    className={`planning-name-tag ${bk.validated ? "is-validated" : "is-pending"}${locked ? " is-locked" : ""}`}
                    // Récurrent en semaine réelle (consultation) → non déplaçable.
                    draggable={!locked && !realWeekRecurring}
                    style={{
                      ...badgeStyle(bk.validated),
                      position: "relative",
                      opacity:
                        draggingId === bk.id ||
                        (copiedBooking?.mode === "cut" && copiedBooking.id === bk.id)
                          ? 0.4
                          : 1,
                      cursor:
                        quickActive && (!realWeekRecurring || pointageMode)
                          ? "pointer"
                          : locked || realWeekRecurring
                            ? "default"
                            : "grab",
                      // L'ombre portée (box-shadow 2px 2px 4px) déborde sous le badge sans
                      // occuper de hauteur en flux : on réserve l'extent de l'ombre (offset 2
                      // + blur 4 = 6px) afin que le centrage vertical (justify-content du
                      // créneau) tienne compte de l'ombre, plutôt que de centrer la seule boîte.
                      marginBottom: 6,
                    }}
                    data-tip={badgeTitle(bk)}
                    // Clic droit → menu « Copier » (pas en mode création ni sur un
                    // récurrent en semaine réelle).
                    onContextMenu={(e) => {
                      // Verrouillée (pointée / parent à miroir pointé) → pas de copier/couper.
                      if (creationMode || realWeekRecurring || locked) return;
                      e.preventDefault();
                      e.stopPropagation();
                      clearTip();
                      setCtxMenu({ x: e.clientX, y: e.clientY, kind: "booking", booking: bk });
                    }}
                    onDragStart={
                      locked || realWeekRecurring
                        ? undefined
                        : (e) => {
                            e.stopPropagation();
                            setDraggingId(bk.id);
                          }
                    }
                    onDragEnd={locked || realWeekRecurring ? undefined : () => setDraggingId(null)}
                    onClick={(e) => {
                      // Le badge porte les actions sur la réservation (cf. legacy).
                      // Validation/pointage ON = clic rapide ; sinon = modale d'édition.
                      // En semaine réelle sur un récurrent : consultation seule (pas d'action
                      // rapide), la modale s'ouvre en lecture seule.
                      e.stopPropagation();
                      // Semaine réelle + mode validation : un récurrent ne se valide pas ici.
                      if (realWeekRecurring && validation) {
                        warnRecurringValidation();
                        return;
                      }
                      // Pointage autorisé sur les réservations-enfants (cellule récurrente
                      // en semaine réelle) même si le reste de la cellule est en lecture seule.
                      if (realWeekRecurring && pointageMode && onBlockQuickAction(bk)) return;
                      if (!realWeekRecurring && onBlockQuickAction(bk)) return;
                      setDetail({ booking: bk });
                    }}
                  >
                    {/* Croix de suppression (survol) — masquée si la résa est pointée
                      (verrouillée) ou en semaine réelle sur un récurrent (consultation). */}
                    {!locked && !realWeekRecurring && (
                      <button
                        type="button"
                        className="planning-name-tag-close"
                        data-tip="Supprimer"
                        style={{ border: "none", padding: 0 }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget(bk);
                        }}
                      >
                        ×
                      </button>
                    )}
                    <PointagePill pointage={bk.pointage} />
                    {primaryLabel && (
                      <span style={{ fontSize: ".62rem", fontWeight: 700 }}>{primaryLabel}</span>
                    )}
                    <span style={{ fontSize: ".62rem", color: "var(--muted)" }}>{bk.name}</span>
                    {modes.themeMode && bk.theme && (
                      <span style={{ fontSize: ".62rem", fontWeight: 600, color: accentColor }}>
                        {bk.theme}
                      </span>
                    )}
                  </div>
                );
              })}
          </div>
          {/* Jauge DE CE CRÉNEAU (ponctuel → gaugePonct, récurrent → gaugeRec) ON → barre
          + used/cap ; OFF → simple compteur réservations/total (format 1/15). */}
          {b.bookings.length > 0 &&
            (gaugeForCell ? (
              <div
                className="agenda-block-meta is-gauge"
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: 4,
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                  // Barre + texte X/Y colorés selon le remplissage (rouge si complet).
                  color: fillColor,
                }}
              >
                <span className="agenda-block-gauge-bar">
                  <span style={{ width: `${pct}%`, background: fillColor }} />
                </span>
                {b.used}/{b.capacity}
              </div>
            ) : (
              <div
                className="agenda-block-meta"
                style={{ position: "absolute", bottom: 0, left: 4, color: countColor }}
              >
                {count}/{b.capacity}
              </div>
            ))}
        </div>
      );
      // Déps = lectures réactives de renderBlock UNIQUEMENT (handlers via blockApiRef,
      // donc exclus). Énumérées à la main (Biome ne couvre pas ce useCallback) +
      // vérifiées au runtime. Une omission ⇒ badge figé : revérifier si on en ajoute.
    },
    [
      uniqueIdSet,
      mode,
      modes,
      creationMode,
      effectivePeriodId,
      mapMinToY,
      gridStartMin,
      gridEndMin,
      moveDrag,
      resizeDrag,
      copiedBooking,
      draggingId,
      bookings,
      uniqueSlots,
      service,
      validation,
      pointageMode,
    ],
  );

  // Éléments JSX des blocs par jour, mémoïsés : renderBlock/isDayDisabled/blocksByDay
  // étant stables, ces éléments gardent la MÊME référence d'un rendu à l'autre tant que
  // données et mode ne changent pas → React bypasse la reconciliation des ~100 blocs
  // pendant un glisser-créer / ouverture de modale / survol (perf, audit grilles).
  const dayBlockEls = useMemo(() => {
    const timed = new Map<string, React.ReactNode[]>();
    const allday = new Map<string, React.ReactNode[]>();
    for (const d of days) {
      const bl: Block[] = isDayDisabled(d) ? [] : (blocksByDay[d] ?? []);
      timed.set(
        d,
        bl
          .filter((b) => !b.isAllDay && (!hideEmpty || b.bookings.length > 0))
          .map((b) => renderBlock(b, false)),
      );
      allday.set(
        d,
        bl
          .filter((b) => b.isAllDay && (!hideEmpty || b.bookings.length > 0))
          .map((b) => renderBlock(b, true)),
      );
    }
    return { timed, allday };
  }, [days, isDayDisabled, blocksByDay, renderBlock, hideEmpty]);

  return (
    // Info-bulle déléguée : un seul handler lit data-tip / data-slot-tip au survol.
    <div id="tab-content-agenda" onMouseMove={onAgendaTip} onMouseLeave={clearTip}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: ".75rem",
          flexWrap: "wrap",
          marginBottom: ".5rem",
        }}
      >
        <div className="panel-title" style={{ marginBottom: 0 }}>
          <span className="dot" />
          Agenda
          {/* Barre d'exercice toujours présente (parité legacy, y compris en ponctuel) :
              label « — » et flèches désactivées quand le service n'a aucun exercice. */}
          <span className="exercice-nav-inline">
            <span className="ex-nav-label">{exLabel}</span>
            <span className="ex-nav-arrows">
              <button
                type="button"
                className="ex-arrow"
                aria-label="Exercice précédent"
                disabled={!canExPrev}
                onClick={() => canExPrev && gotoExercice(exercices[exIdx - 1].id)}
              >
                ◀
              </button>
              <button
                type="button"
                className="ex-arrow"
                aria-label="Exercice suivant"
                disabled={!canExNext}
                onClick={() => canExNext && gotoExercice(exercices[exIdx + 1].id)}
              >
                ▶
              </button>
            </span>
          </span>
        </div>
        {/* Navigation semaine (Semaine réelle) : centrée sur la même ligne que le
            titre et le sélecteur. */}
        {mode === "realweek" && (
          <div className="periode-nav" style={{ margin: "0 auto" }}>
            <button
              type="button"
              className="ex-arrow"
              disabled={!canWeekPrev}
              onClick={() => canWeekPrev && shiftWeek(-1)}
            >
              ◀
            </button>
            <span className="ex-nav-label">
              {mondayStr
                ? `${shortDateFmt.format(addDays(mondayStr, 0))} → ${shortDateFmt.format(addDays(mondayStr, 6))}`
                : "…"}
            </span>
            <button
              type="button"
              className="ex-arrow"
              disabled={!canWeekNext}
              onClick={() => canWeekNext && shiftWeek(1)}
            >
              ▶
            </button>
            {todayInVisiblePeriods && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: ".05rem .45rem", fontSize: ".64rem", marginLeft: ".4rem" }}
                onClick={() => {
                  // Retour à la semaine courante : on relâche le verrou pour
                  // re-dériver la période qui couvre aujourd'hui.
                  setRwPeriodId(null);
                  setAnchorMonday(ymd(mondayOf(new Date())));
                }}
              >
                Aujourd&apos;hui
              </button>
            )}
          </div>
        )}
        {/* Sélecteurs alignés à droite : Modèle/Semaine réelle, puis le toggle Semaine A/B. */}
        <div className="agenda-mode-toggles-wrap">
          <div className="agenda-mode-toggle" role="tablist" aria-label="Mode d&apos;affichage">
            {/* « Modèle de période » n'a de sens qu'avec au moins un demandeur récurrent ;
                sinon on masque ce demi-sélecteur (la vue reste en « Semaine réelle »). */}
            {modes.recurringMode && (
              <button
                type="button"
                className={`agenda-mode-btn${mode === "model" ? " active" : ""}`}
                onClick={() => setMode("model")}
              >
                Modèle de période
              </button>
            )}
            <button
              type="button"
              className={`agenda-mode-btn${mode === "realweek" ? " active" : ""}`}
              onClick={() => setMode("realweek")}
            >
              Semaine réelle
            </button>
          </div>
          {abMode && (mode === "model" || realWeekParity) && (
            // « Semaine » + toggle A / B. En Modèle : choix libre (weekAB). En Semaine
            // réelle : seule la parité de la semaine affichée est montrée (lecture seule).
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: ".3rem",
                minWidth: 100,
              }}
            >
              <span style={{ fontSize: ".62rem", color: "var(--muted)" }}>Semaine</span>
              <div className="agenda-mode-toggle" aria-label="Semaine A ou B">
                {(["A", "B"] as const).map((w) => {
                  const isRealweek = mode !== "model";
                  // En Semaine réelle, on n'affiche QUE la parité de la semaine courante.
                  if (isRealweek && realWeekParity !== w) return null;
                  const activeWeek = isRealweek ? realWeekParity : weekAB;
                  return (
                    <button
                      key={w}
                      type="button"
                      className={`agenda-mode-btn${activeWeek === w ? " active" : ""}`}
                      onClick={() => {
                        if (!isRealweek) setWeekAB(w);
                      }}
                    >
                      {w}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: ".75rem",
          marginBottom: ".5rem",
        }}
      >
        <div className="period-tabs" id="agenda-period-tabs">
          {visiblePeriods.map((p, i) => {
            const active = mode === "realweek" ? p.id === coveringPeriod?.id : i === periodIdx;
            return (
              <button
                key={p.id}
                type="button"
                className={`period-btn ${active ? "active" : ""}`}
                style={{ "--period-color": p.color } as React.CSSProperties}
                onClick={() => {
                  if (mode === "realweek") {
                    // Onglet choisi = source de vérité : on fige la période ET on
                    // ancre la semaine sur son début (cf. legacy _pickedP).
                    if (p.dateStart) {
                      setRwPeriodId(p.id);
                      setAnchorMonday(ymd(mondayOf(new Date(`${p.dateStart}T00:00:00`))));
                    }
                  } else {
                    setPeriodIdx(i);
                  }
                }}
              >
                <span className="period-badge" />
                {[p.etiquette, p.label].filter(Boolean).join(" · ")}
              </button>
            );
          })}
          {periods.length === 0 && (
            <span style={{ fontSize: ".75rem", color: "var(--muted)" }}>
              Aucune période active.
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {/* En mode création : champ « Capacité » + 👥 (+ Copier A/B) ; sinon les cases. */}
          {creationMode ? (
            <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
              <label
                htmlFor="create-cap"
                style={{
                  fontSize: ".72rem",
                  fontWeight: 600,
                  color: "var(--muted)",
                  textTransform: "none",
                  letterSpacing: "normal",
                }}
              >
                Capacité
              </label>
              <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                <input
                  id="create-cap"
                  type="number"
                  min={1}
                  data-tip="Capacité par défaut"
                  value={capStr}
                  onChange={(e) => onCapChange(e.target.value)}
                  style={{
                    width: 46,
                    fontSize: ".72rem",
                    padding: ".12rem .3rem",
                    background: "var(--surface2)",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--rad-sm)",
                  }}
                />
                {/* Flash « ✓ » de sauvegarde : en absolu (hors flux) → ne réserve aucun
                    espace quand il est masqué. */}
                <span
                  style={{
                    position: "absolute",
                    left: "100%",
                    marginLeft: 0.5,
                    fontSize: ".7rem",
                    color: "var(--accent)",
                    opacity: capSaved ? 1 : 0,
                    transition: "opacity .2s",
                    pointerEvents: "none",
                  }}
                >
                  ✓
                </span>
              </span>
              {/* 👥 : demandeurs autorisés par défaut des créneaux créés (modale). */}
              <button
                type="button"
                onClick={() => setCreateDemModal(true)}
                data-tip="Demandeurs autorisés par défaut"
                aria-label="Demandeurs autorisés par défaut"
                style={{
                  background: createDemIds.length ? "var(--accent-dim)" : "none",
                  border: `1px solid ${createDemIds.length ? "var(--accent)" : "var(--border)"}`,
                  borderRadius: "var(--rad-sm)",
                  // Dimensions identiques à la boîte du bouton « Mode création »
                  // (icône 15px + padding .28rem/.38rem + bordure 1px). L'emoji 👥 étant
                  // plus large/haut qu'un SVG 15px, on fixe la boîte et on centre.
                  boxSizing: "border-box",
                  height: "calc(0.56rem + 17px)",
                  width: "calc(0.76rem + 17px)",
                  padding: 0,
                  cursor: "pointer",
                  color: createDemIds.length ? "var(--accent)" : "var(--muted)",
                  fontSize: 15,
                  lineHeight: 1,
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                👥{/* Compteur en pastille superposée (coin haut-droit) → bouton carré. */}
                {createDemIds.length > 0 && (
                  <span
                    style={{
                      position: "absolute",
                      top: -5,
                      right: -5,
                      minWidth: 13,
                      height: 13,
                      padding: "0 3px",
                      boxSizing: "border-box",
                      borderRadius: 999,
                      background: "var(--accent)",
                      color: "var(--accent-contrast, #fff)",
                      fontSize: ".55rem",
                      fontWeight: 700,
                      lineHeight: "13px",
                      textAlign: "center",
                    }}
                  >
                    {createDemIds.length}
                  </span>
                )}
              </button>
              {/* Copie des créneaux d'une semaine A/B vers l'autre (Modèle + A/B). */}
              {abMode &&
                mode === "model" &&
                effectiveWeek != null &&
                effectivePeriodId != null &&
                effectivePeriodId > 0 && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={copyWeek}
                    data-tip={`Copier les créneaux de la semaine ${effectiveWeek} vers la semaine ${effectiveWeek === "A" ? "B" : "A"}`}
                    style={{
                      fontSize: ".6rem",
                      // Même hauteur que le bouton « Mode création » (icône 15px + padding
                      // .28rem + bordure 1px).
                      height: "calc(0.56rem + 17px)",
                      boxSizing: "border-box",
                      padding: "0 .35rem",
                      display: "inline-flex",
                      alignItems: "center",
                      lineHeight: 1,
                    }}
                  >
                    Copier → {effectiveWeek === "A" ? "B" : "A"}
                  </button>
                )}
            </div>
          ) : (
            <div
              className="planning-options-row"
              style={{ flexDirection: "column", alignItems: "flex-end", gap: 1, lineHeight: 1.1 }}
            >
              <label className="planning-option">
                Masquer les horaires sans réservation
                <input
                  type="checkbox"
                  checked={hideEmpty}
                  onChange={(e) => setHideEmpty(e.target.checked)}
                />
              </label>
              <div style={{ display: "flex", gap: ".6rem", alignItems: "center" }}>
                <label className="planning-option">
                  Mode validation
                  <input
                    type="checkbox"
                    checked={validation}
                    onChange={(e) => toggleValidation(e.target.checked)}
                  />
                </label>
                {mode === "realweek" && (
                  <label className="planning-option">
                    Mode pointage
                    <input
                      type="checkbox"
                      checked={pointageMode}
                      onChange={(e) => togglePointageMode(e.target.checked)}
                    />
                  </label>
                )}
              </div>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
            {/* Boutons d'impression masqués en mode création. */}
            {!creationMode && (
              <button
                type="button"
                onClick={printSessionsList}
                data-tip="Imprimer la liste des réservations"
                aria-label="Imprimer la liste des réservations"
                style={{
                  background: "none",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--rad-sm)",
                  padding: ".28rem .38rem",
                  cursor: "pointer",
                  color: "var(--muted)",
                  display: "flex",
                  alignItems: "center",
                  lineHeight: 1,
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="6 9 6 2 18 2 18 9" />
                  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                  <rect x="6" y="14" width="12" height="8" />
                </svg>
              </button>
            )}
            <button
              type="button"
              onClick={() => toggleCreationMode(!creationMode)}
              data-tip="Mode création"
              aria-label="Mode création"
              aria-pressed={creationMode}
              style={{
                background: creationMode ? "var(--danger)" : "none",
                border: `1px solid ${creationMode ? "var(--danger)" : "var(--border)"}`,
                borderRadius: "var(--rad-sm)",
                padding: ".28rem .38rem",
                cursor: "pointer",
                color: creationMode ? "var(--accent-contrast, #fff)" : "var(--danger)",
                display: "flex",
                alignItems: "center",
                lineHeight: 1,
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                <path d="m15 5 4 4" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div className="planning-wrap">
        <div
          className={`agenda-grid${mode === "realweek" ? " is-realweek" : ""}`}
          style={{ gridTemplateColumns: `44px repeat(${days.length}, minmax(0, 1fr))` }}
        >
          <AgendaWeekHeader
            days={days}
            abMode={abMode}
            effectiveWeek={effectiveWeek}
            realweek={mode === "realweek"}
            weekDateByDay={weekDateByDay}
            outOfPeriodCls={outOfPeriodCls}
          />

          {/* Bande « Journée entière » : créneaux sans horaire, au-dessus de la
              grille horaire (port du legacy alldayRow). Masquée s'il n'y a aucun
              bloc all-day — en hideEmpty, on ne compte que ceux qui ont une résa.
              En mode création, la ligne reste toujours affichée (même vide) pour
              rester visible/gérable. */}
          {(creationMode ||
            days.some((d) =>
              dayBlocks(d).some((b) => b.isAllDay && (!hideEmpty || b.bookings.length > 0)),
            )) && (
            <>
              <div className="agenda-header-cell agenda-allday-corner" data-tip="Journée entière">
                Journée entière
              </div>
              {days.map((d) => {
                // Jours couverts par le glisser-créer « journée entière » (clic =
                // 1 jour ; glisser horizontal = plusieurs) → aperçu du créneau à créer.
                const inAllDayDrag =
                  allDayDrag != null &&
                  daysSpan(allDayDrag.startDay, allDayDrag.curDay).includes(d);
                // Couleur de l'aperçu : jaune = récurrent (Modèle), vert = ponctuel (Semaine réelle).
                const drawColor = mode === "model" ? "var(--warn)" : "var(--accent)";
                return (
                  <div
                    key={`ad-${d}`}
                    // data-allday-daykey : repère la cellule sous le curseur pendant le
                    // glisser-créer horizontal (cf. onAllDayCreateMouseDown / écouteurs).
                    data-allday-daykey={d}
                    className={`agenda-allday-cell${outOfPeriodCls(d)}`}
                    style={{
                      cursor: isDayDisabled(d)
                        ? "not-allowed"
                        : creationMode
                          ? "pointer"
                          : "default",
                    }}
                    // Mode création : amorce le glisser-créer « journée entière » (horizontal).
                    onMouseDown={(e) => onAllDayCreateMouseDown(e, d)}
                  >
                    {dayBlockEls.allday.get(d)}
                    {/* Aperçu du créneau « journée entière » qui va être créé (clic ou
                        glisser horizontal), à la façon de l'aperçu de création horaire. */}
                    {inAllDayDrag && (
                      <div
                        className="agenda-create-preview"
                        style={{
                          position: "absolute",
                          inset: 2,
                          background: `color-mix(in srgb, ${drawColor} 22%, transparent)`,
                          border: `1px dashed ${drawColor}`,
                          borderRadius: 6,
                          pointerEvents: "none",
                          zIndex: 3,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: ".62rem",
                          fontWeight: 700,
                          color: drawColor,
                        }}
                      >
                        Journée entière
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}

          <AgendaTimeColumn
            quarters={quarters}
            qIdx={qIdx}
            gridStartMin={gridStartMin}
            gridEndMin={gridEndMin}
            totalH={totalH}
            hasLunch={hasLunch}
            lunchSkipFrom={lunchSkipFrom}
            lunchEnd={lunchEnd}
            mapMinToY={mapMinToY}
          />

          {days.map((d) => (
            <div
              key={d}
              data-daykey={d}
              className={`agenda-day-col${outOfPeriodCls(d)}`}
              // Jour fermé : on neutralise toute interaction (clic créer, drag/drop)
              // sur la colonne ET tout son contenu (blocs/badges) via pointer-events.
              style={{
                height: totalH,
                cursor: isDayDisabled(d) ? "not-allowed" : creationMode ? "pointer" : "default",
                pointerEvents: isDayDisabled(d) ? "none" : undefined,
              }}
              // Mode création : on amorce le glisser-créer (les écouteurs window gèrent
              // la suite + le relâché). Hors mode création, la création se fait UNIQUEMENT
              // en cliquant sur un créneau (le bloc) — pas dans le vide de la colonne.
              onMouseDown={(e) => onCreateMouseDown(e, d)}
              onDragOver={(e) => {
                if (isDayDisabled(d)) return;
                if (draggingId != null) e.preventDefault();
              }}
              onDrop={(e) => {
                if (isDayDisabled(d)) return;
                e.preventDefault();
                if (draggingId == null) return;
                const slot = slotAtClientY(e.currentTarget.getBoundingClientRect().top, e.clientY);
                const id = draggingId;
                setDraggingId(null);
                // Cible récurrente en semaine réelle (consultation) → déplacement refusé.
                if (slot && !isRealweekRecurringSlot(slot.id))
                  runResult(moveBookingAction(id, service.id, d, slot.id));
              }}
            >
              <AgendaDayBackground
                quarters={quarters}
                hasLunch={hasLunch}
                lunchStart={lunchStart}
                lunchEnd={lunchEnd}
                mapMinToY={mapMinToY}
              />
              {/* Grille horaire : créneaux datés mémoïsés (les « journée entière » sont
                  dans la bande dédiée). Réf. stable d'un rendu à l'autre → pas de
                  reconciliation des blocs pendant les interactions (cf. dayBlockEls). */}
              {dayBlockEls.timed.get(d)}
              {/* Aperçu du/des créneau(x) en cours de création (glisser-créer). La pause
                  méridienne découpe l'aperçu en 1 ou 2 blocs hors pause. */}
              {createDrag &&
                draggedDays(createDrag).includes(d) &&
                (() => {
                  const s = Math.min(createDrag.startMin, createDrag.curMin);
                  const e2 = Math.min(
                    gridEndMin,
                    Math.max(createDrag.startMin, createDrag.curMin) + 15,
                  );
                  // Couleur du mode dessiné : jaune = récurrent (Modèle de période),
                  // vert = ponctuel (Semaine réelle).
                  const drawColor = mode === "model" ? "var(--warn)" : "var(--accent)";
                  return lunchSplitSegments(s, e2)
                    .filter(([a, b]) => b > a)
                    .map(([segS, segE]) => {
                      const top = mapMinToY(segS);
                      const h = mapMinToY(segE) - top;
                      return (
                        <div
                          key={segS}
                          className="agenda-create-preview"
                          style={{
                            position: "absolute",
                            left: 2,
                            right: 2,
                            top,
                            height: Math.max(2, h),
                            background: `color-mix(in srgb, ${drawColor} 22%, transparent)`,
                            border: `1px dashed ${drawColor}`,
                            borderRadius: 6,
                            pointerEvents: "none",
                            zIndex: 3,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: ".62rem",
                            fontWeight: 700,
                            color: drawColor,
                          }}
                        >
                          {minToHHMM(segS)}–{minToHHMM(segE)}
                        </div>
                      );
                    });
                })()}
              {/* Aperçu du créneau en cours de déplacement (glisser-déplacer). */}
              {moveDrag &&
                moveDrag.curDay === d &&
                (() => {
                  const s = moveDrag.curMin;
                  const e2 = Math.min(gridEndMin, s + moveDrag.durationMin);
                  const top = mapMinToY(s);
                  const h = mapMinToY(e2) - top;
                  const moveColor = moveDrag.isUnique ? "var(--accent)" : "var(--warn)";
                  return (
                    <div
                      className="agenda-move-preview"
                      style={{
                        position: "absolute",
                        left: 2,
                        right: 2,
                        top,
                        height: Math.max(2, h),
                        background: `color-mix(in srgb, ${moveColor} 28%, transparent)`,
                        border: `2px solid ${moveColor}`,
                        borderRadius: 6,
                        pointerEvents: "none",
                        zIndex: 4,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: ".62rem",
                        fontWeight: 700,
                        color: moveColor,
                      }}
                    >
                      {minToHHMM(s)}–{minToHHMM(e2)}
                    </div>
                  );
                })()}
              {/* Aperçu du créneau en cours de redimensionnement (glisser-étirer). */}
              {resizeDrag &&
                resizeDrag.dayKey === d &&
                (() => {
                  const top = mapMinToY(resizeDrag.curStart);
                  const h = mapMinToY(resizeDrag.curEnd) - top;
                  const rColor = resizeDrag.isUnique ? "var(--accent)" : "var(--warn)";
                  return (
                    <div
                      className="agenda-resize-preview"
                      style={{
                        position: "absolute",
                        left: 2,
                        right: 2,
                        top,
                        height: Math.max(2, h),
                        background: `color-mix(in srgb, ${rColor} 28%, transparent)`,
                        border: `2px solid ${rColor}`,
                        borderRadius: 6,
                        pointerEvents: "none",
                        zIndex: 4,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: ".62rem",
                        fontWeight: 700,
                        color: rColor,
                      }}
                    >
                      {minToHHMM(resizeDrag.curStart)}–{minToHHMM(resizeDrag.curEnd)}
                    </div>
                  );
                })()}
              {/* Aperçu des créneaux générés en étendant latéralement (un par colonne
                  couverte, hormis la source). Pointillé = à créer, comme le glisser-créer. */}
              {hResizeDrag &&
                hResizeDrag.fromDay !== d &&
                daysSpan(hResizeDrag.fromDay, hResizeDrag.curDay).includes(d) &&
                (() => {
                  const top = mapMinToY(hResizeDrag.startMin);
                  const h = mapMinToY(hResizeDrag.endMin) - top;
                  const rColor = hResizeDrag.isUnique ? "var(--accent)" : "var(--warn)";
                  return (
                    <div
                      className="agenda-hresize-preview"
                      style={{
                        position: "absolute",
                        left: 2,
                        right: 2,
                        top,
                        height: Math.max(2, h),
                        background: `color-mix(in srgb, ${rColor} 22%, transparent)`,
                        border: `1px dashed ${rColor}`,
                        borderRadius: 6,
                        pointerEvents: "none",
                        zIndex: 3,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: ".62rem",
                        fontWeight: 700,
                        color: rColor,
                      }}
                    >
                      {minToHHMM(hResizeDrag.startMin)}–{minToHHMM(hResizeDrag.endMin)}
                    </div>
                  );
                })()}
            </div>
          ))}
        </div>
      </div>

      {/* Sous le tableau : astuce à gauche, légende complète à droite (reprise du
          legacy #agenda-legend-realweek). La légende n'a de sens qu'en « Semaine
          réelle » (pointage P/A + créneaux ponctuels datés). */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        {/* flex:1 + minWidth:0 → l'astuce absorbe le rétrécissement en passant à la
            ligne au lieu de déborder ; la légende garde sa place (flexShrink:0). */}
        <p
          style={{
            fontSize: ".7rem",
            color: "var(--muted)",
            margin: 0,
            flex: "1 1 0%",
            minWidth: 0,
          }}
        >
          {/* « Astuce » en couleur de texte principale (noir en thème clair), « : » et
              la suite gardent la couleur courante. Le conseil dépend du mode création. */}
          <span style={{ color: "var(--text)" }}>Astuce</span>
          {" : "}
          {creationMode
            ? "saisissez le bord haut ou bas d'un créneau vide pour changer sa durée, ou son bord gauche/droit pour l'étendre aux jours voisins."
            : "cliquez sur un créneau vide pour ajouter une réservation, ou glissez un bloc vers un autre créneau pour le déplacer."}
        </p>
        {mode === "realweek" && (
          <div className="agenda-legend" style={{ flexShrink: 0 }}>
            {/* Sans demandeur récurrent, aucun créneau miroir (récurrent) → on masque
                cet item de légende. */}
            {modes.recurringMode && (
              <span className="agenda-legend-item">
                <span className="agenda-legend-swatch is-rec" />
                Récurrent
              </span>
            )}
            <span className="agenda-legend-item">
              <span className="agenda-legend-swatch is-uniq" />
              Ponctuel
            </span>
            <span className="agenda-legend-item">
              <span className="indic_p">P</span>
              Présent
            </span>
            <span className="agenda-legend-item">
              <span className="indic_a">A</span>
              Absent
            </span>
          </div>
        )}
      </div>

      {stackKey && stackBlock && (
        <ModalOverlay onClose={() => setStackKey(null)}>
          {(() => {
            // Modale "pile" stylée comme le legacy (cell-stack-modal) : pastille
            // date/jour, sous-titre horaire, bascules validation/pointage, mini-grille
            // horaire (csm-time-col + bloc créneau coloré csm-slot-block) contenant la
            // liste des badges (cell-stack-list), puis bandeau capacité.
            const isPonctuel = uniqueIdSet.has(stackKey.slotId);
            // Récurrent en semaine réelle → consultation seule (pas d'édition rapide,
            // ni suppression ; clic = modale détail en lecture seule).
            const stackReadOnly = mode === "realweek" && !isPonctuel;
            const uSlot = uniqueSlots.find((s) => s.id === stackKey.slotId);
            const ponctDate =
              isPonctuel && uSlot?.slotDate
                ? new Date(`${uSlot.slotDate}T00:00:00`).toLocaleDateString("fr-FR", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })
                : "";
            const period = periods.find((p) => p.id === effectivePeriodId);
            // Pastille : libellé de période (récurrent) ou date (ponctuel), cf. legacy.
            const pillLabel = isPonctuel ? ponctDate : (period?.label ?? "");
            const dayLabel = DAY_NAMES[stackKey.dayKey] ?? stackKey.dayKey;
            // Jauge = somme enfants (+ accompagnants si comptés) / capacité.
            const gaugeSum = stackBlock.bookings.reduce(
              (s, bk) => s + gaugeUnits(bk.enfants, bk.accompagnants, service.gaugeAccompagnants),
              0,
            );
            const gaugeTotal = stackBlock.capacity;
            const gaugePct =
              gaugeTotal > 0 ? Math.min(100, Math.round((gaugeSum / gaugeTotal) * 100)) : 0;
            const gaugeFill = gaugeColor(gaugePct);
            const showGauge = isPonctuel ? modes.gaugePonct : modes.gaugeRec;
            const sMin = stackSlot ? toMinutes(stackSlot.startTime, 0) : 0;
            const eMin = stackSlot ? toMinutes(stackSlot.endTime, sMin + 60) : sMin + 60;
            const hasRange = eMin > sMin;
            const pxPerMinModal = 24 / 15; // 24 px par quart d'heure (legacy)
            const blockMinH = hasRange ? Math.max(56, (eMin - sMin) * pxPerMinModal) : 56;
            const marks: number[] = [];
            if (hasRange) for (let m = sMin; m <= eMin; m += 15) marks.push(m);
            return (
              <>
                <button
                  type="button"
                  className="modal-close"
                  onClick={() => setStackKey(null)}
                  aria-label="Fermer"
                >
                  ×
                </button>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "1rem",
                    flexWrap: "wrap",
                    marginBottom: ".6rem",
                    paddingRight: "1.5rem",
                  }}
                >
                  {/* Gauche : pastille période/date + horaire (jour) sur la même ligne. */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: ".6rem",
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      className={`period-btn active${isPonctuel ? " is-uniq" : ""}`}
                      style={{
                        cursor: "default",
                        padding: ".12rem .5rem",
                        fontSize: ".64rem",
                        gap: ".3rem",
                        textTransform: "capitalize",
                      }}
                    >
                      <span className="period-badge" />
                      {pillLabel}
                    </span>
                    <span className="panel-subtitle" style={{ margin: 0 }}>
                      {isPonctuel
                        ? stackSlot
                          ? `${stackSlot.startTime} – ${stackSlot.endTime}`
                          : ""
                        : `${dayLabel}${stackSlot ? ` · ${stackSlot.startTime} – ${stackSlot.endTime}` : ""}`}
                    </span>
                  </div>
                  {/* Droite : bascules. « Mode validation » est toujours affiché ;
                      « Mode pointage » seulement en « Semaine réelle » (le pointage n'a
                      de sens que sur une semaine datée — cf. legacy). La croix de
                      fermeture est positionnée en haut à droite de la modale (modal-close). */}
                  <div
                    style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}
                  >
                    {stackReadOnly ? (
                      <>
                        {/* Récurrent en semaine réelle : pointage par séance autorisé sur
                            les réservations-enfants ; validation/édition en vue Modèle. */}
                        <label className="planning-option" style={{ margin: 0 }}>
                          Mode pointage{" "}
                          <input
                            type="checkbox"
                            checked={pointageMode}
                            onChange={(e) => togglePointageMode(e.target.checked)}
                          />
                        </label>
                        <span
                          style={{ fontSize: ".7rem", color: "var(--muted)", fontStyle: "italic" }}
                        >
                          Validation/édition en vue « Modèle de période »
                        </span>
                      </>
                    ) : (
                      <>
                        <label className="planning-option" style={{ margin: 0 }}>
                          Mode validation{" "}
                          <input
                            type="checkbox"
                            checked={validation}
                            onChange={(e) => toggleValidation(e.target.checked)}
                          />
                        </label>
                        {mode === "realweek" && (
                          <label className="planning-option" style={{ margin: 0 }}>
                            Mode pointage{" "}
                            <input
                              type="checkbox"
                              checked={pointageMode}
                              onChange={(e) => togglePointageMode(e.target.checked)}
                            />
                          </label>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <div className="csm-grid-wrap">
                  <div className="csm-time-col" style={{ height: blockMinH }}>
                    {marks.map((m) => (
                      <div
                        key={m}
                        className="csm-time-mark"
                        style={{ top: (m - sMin) * pxPerMinModal }}
                      >
                        {`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`}
                      </div>
                    ))}
                  </div>
                  <div
                    className={`csm-slot-block${isPonctuel ? " is-uniq" : ""}`}
                    // Info-bulle au survol du créneau, identique à celle de la grille :
                    // récurrent → période + jour/heures + demandeurs + capacité ;
                    // ponctuel → demandeurs + capacité. Le handler délégué onAgendaTip
                    // (sur #tab-content-agenda, qui englobe la modale) lit ces attributs
                    // et réutilise recMetaForBlock/concernedDatesForBlock, comme la grille.
                    data-slot-tip=""
                    data-slotid={stackKey.slotId}
                    data-daykey={stackKey.dayKey}
                    style={
                      {
                        minHeight: blockMinH,
                        "--quarter-h": "24px",
                        "--hour-h": "96px",
                      } as React.CSSProperties
                    }
                  >
                    <div className="cell-stack-list">
                      {[...stackBlock.bookings]
                        // Tri des badges par demandeur (puis structure, puis nom) pour
                        // regrouper visuellement les réservations d'un même demandeur.
                        .sort(
                          (a, b) =>
                            a.demandeur.localeCompare(b.demandeur, "fr", {
                              sensitivity: "base",
                            }) ||
                            a.structure.localeCompare(b.structure, "fr", {
                              sensitivity: "base",
                            }) ||
                            a.name.localeCompare(b.name, "fr", { sensitivity: "base" }),
                        )
                        .map((bk) => (
                          // biome-ignore lint/a11y/useKeyWithClickEvents: ligne réservation (clic = éditer)
                          <div
                            key={bk.id}
                            className={`planning-name-tag ${bk.validated ? "is-validated" : "is-pending"}${lockedByPointage(bk) ? " is-locked" : ""}`}
                            // Glisser-déplacer depuis la pile : sauf si verrouillée (pointée
                            // ou parent à miroir pointé) ou en consultation (récurrent semaine réelle).
                            draggable={!lockedByPointage(bk) && !stackReadOnly}
                            style={{
                              ...badgeStyle(bk.validated),
                              cursor:
                                !lockedByPointage(bk) && !stackReadOnly
                                  ? "grab"
                                  : stackReadOnly && pointageMode
                                    ? "pointer"
                                    : "default",
                              position: "relative",
                              opacity:
                                draggingId === bk.id ||
                                (copiedBooking?.mode === "cut" && copiedBooking.id === bk.id)
                                  ? 0.4
                                  : 1,
                            }}
                            data-tip={badgeTitle(bk)}
                            onDragStart={
                              lockedByPointage(bk) || stackReadOnly
                                ? undefined
                                : (e) => {
                                    // On amorce le drag, PUIS on ferme la pile au tick suivant
                                    // pour libérer la grille comme cible de dépôt (port legacy
                                    // _onDragStartFromStackModal).
                                    e.stopPropagation();
                                    setDraggingId(bk.id);
                                    setTimeout(() => setStackKey(null), 0);
                                  }
                            }
                            onDragEnd={
                              lockedByPointage(bk) || stackReadOnly
                                ? undefined
                                : () => setDraggingId(null)
                            }
                            onClick={() => {
                              // Récurrent en semaine réelle : pas d'action rapide → la modale
                              // détail s'ouvre en consultation (lecture seule).
                              // Mode validation : un récurrent ne se valide pas ici.
                              if (stackReadOnly && validation) {
                                warnRecurringValidation();
                                return;
                              }
                              // Pointage autorisé sur les réservations-enfants (récurrent
                              // en semaine réelle) même si la pile est en lecture seule.
                              if (stackReadOnly && pointageMode && onBlockQuickAction(bk)) return;
                              if (!stackReadOnly && onBlockQuickAction(bk)) return;
                              // On garde la pile ouverte : la modale détail s'empile
                              // par-dessus, et sa fermeture y ramène.
                              setDetail({ booking: bk });
                            }}
                            // Clic droit → menu « Copier » (pas en création/consultation, ni
                            // sur une réservation verrouillée par un pointage).
                            onContextMenu={(e) => {
                              if (creationMode || stackReadOnly || lockedByPointage(bk)) return;
                              e.preventDefault();
                              e.stopPropagation();
                              clearTip();
                              setCtxMenu({
                                x: e.clientX,
                                y: e.clientY,
                                kind: "booking",
                                booking: bk,
                              });
                            }}
                          >
                            <PointagePill pointage={bk.pointage} />
                            {/* Croix masquée si verrouillée (pointée / parent à miroir pointé)
                              ou en consultation (récurrent en semaine réelle). */}
                            {!lockedByPointage(bk) && !stackReadOnly && (
                              <button
                                type="button"
                                className="planning-name-tag-close"
                                data-tip="Supprimer"
                                style={{ border: "none", padding: 0 }}
                                onMouseDown={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteTarget(bk);
                                }}
                              >
                                ×
                              </button>
                            )}
                            {(bk.structure || bk.demandeur) && (
                              <span style={{ fontWeight: 700 }}>
                                {bk.structure || bk.demandeur}
                              </span>
                            )}
                            <span style={{ fontSize: ".65rem", color: "var(--muted)" }}>
                              {bk.name}
                            </span>
                            {modes.themeMode && bk.theme && (
                              <span
                                style={{
                                  fontSize: ".62rem",
                                  fontWeight: 600,
                                  color: bk.validated ? "var(--accent)" : "rgba(232, 164, 90, .95)",
                                }}
                              >
                                {bk.theme}
                              </span>
                            )}
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
                <div id="csm-cap-info">
                  {showGauge ? (
                    <span className="csm-gauge-info">
                      <span>Jauge</span>
                      <span
                        style={{
                          display: "inline-block",
                          width: 80,
                          height: 6,
                          borderRadius: 3,
                          background: "rgba(0,0,0,.18)",
                          overflow: "hidden",
                        }}
                      >
                        <span
                          style={{
                            display: "block",
                            height: "100%",
                            width: `${gaugePct}%`,
                            background: gaugeFill,
                          }}
                        />
                      </span>
                      <span>
                        {gaugeSum}/{gaugeTotal}
                      </span>
                    </span>
                  ) : (
                    <span>
                      {stackBlock.used}/{stackBlock.capacity}
                    </span>
                  )}
                </div>
              </>
            );
          })()}
        </ModalOverlay>
      )}

      {/* Modale détail : rendue APRÈS la pile pour s'empiler par-dessus.
          Sa fermeture laisse stackKey intact → retour à la pile. */}
      {detail &&
        (() => {
          // Période + jour/heure de la réservation, pour le titre de la modale.
          const bk = detail.booking;
          const recurSlot = slots.find((s) => s.id === bk.slotId);
          const uniqSlot = uniqueSlots.find((s) => s.id === bk.slotId);
          const period =
            (recurSlot
              ? periods.find((p) => p.id === recurSlot.periodId)
              : uniqSlot?.slotDate
                ? periods.find(
                    (p) =>
                      p.dateStart &&
                      p.dateEnd &&
                      p.dateStart <= uniqSlot.slotDate &&
                      p.dateEnd >= uniqSlot.slotDate,
                  )
                : undefined) ?? null;
          const periodTag = period
            ? [period.etiquette, period.label].filter(Boolean).join(" · ")
            : "";
          const slot = recurSlot ?? uniqSlot ?? null;
          const dayLabel = uniqSlot?.slotDate
            ? new Date(`${uniqSlot.slotDate}T00:00:00`).toLocaleDateString("fr-FR", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })
            : (DAY_NAMES[bk.dayKey] ?? bk.dayKey);
          const dayHour = dayLabel + (slot ? ` · ${slot.startTime}–${slot.endTime}` : "");
          // Occurrences (récurrent uniquement) = dates des réservations-ENFANTS réelles
          // de cette réservation (et non tous les miroirs du slot) → reflète exactement
          // les séances effectivement créées (cutoff, semaine A/B, vacances scolaires).
          const occurrenceDates = recurSlot
            ? bookings
                .filter((c) => c.parentBookingId === bk.id)
                .map((c) => uniqueSlots.find((u) => u.id === c.slotId)?.slotDate)
                .filter((d): d is string => !!d)
                .sort()
            : [];
          // Lecture seule si : récurrent en semaine réelle, OU réservation verrouillée
          // par un pointage (pointée / parent à miroir pointé) → ni édition, ni
          // suppression, ni validation depuis la fiche.
          const readOnly = (mode === "realweek" && !!recurSlot) || lockedByPointage(bk);
          return (
            <BookingDetailModal
              booking={bk}
              serviceId={service.id}
              themesMode={service.themesMode}
              themes={themes}
              periodTag={periodTag}
              periodColor={period?.color ?? ""}
              dayHour={dayHour}
              occurrenceDates={occurrenceDates}
              slotStart={slot?.startTime ?? ""}
              slotEnd={slot?.endTime ?? ""}
              readOnly={readOnly}
              onClose={() => setDetail(null)}
              onSaved={() => {
                setDetail(null);
                router.refresh();
              }}
              run={runResult}
            />
          );
        })()}

      {deleteTarget &&
        (() => {
          const recap = bookingRecap(deleteTarget);
          return (
            <BookingDeleteModal
              name={recap.name}
              details={recap.details}
              recurring={recap.recurring}
              validated={deleteTarget.validated}
              onCancel={() => setDeleteTarget(null)}
              onConfirm={confirmDeleteBooking}
            />
          );
        })()}

      {createCtx &&
        (() => {
          // Liste des usagers filtrée par « Type de demandeur » puis « Structure »
          // (cascade, port legacy onPcmDemandeurChange / onPcmStructureChange).
          const usersByType = cDemType ? users.filter((u) => u.demandeur === cDemType) : users;
          const structureOptions = [
            ...new Set(usersByType.map((u) => u.structure).filter(Boolean)),
          ].sort() as string[];
          const createUsers = cStructure
            ? usersByType.filter((u) => u.structure === cStructure)
            : usersByType;
          const nCEnf = Number(cEnfants) || 0;
          const nCAcc = Number(cAccompagnants) || 0;
          // Période du créneau : récurrent → periodId du slot ; ponctuel → période
          // couvrant la date. Affichée (étiquette · libellé) dans le titre, avant le jour.
          const recurSlot = slots.find((s) => s.id === createCtx.slotId);
          const sd = createCtx.slotDate;
          const createPeriod =
            (recurSlot
              ? periods.find((p) => p.id === recurSlot.periodId)
              : sd
                ? periods.find(
                    (p) => p.dateStart && p.dateEnd && p.dateStart <= sd && p.dateEnd >= sd,
                  )
                : undefined) ?? null;
          const periodTag = createPeriod
            ? [createPeriod.etiquette, createPeriod.label].filter(Boolean).join(" · ")
            : "";
          const dayHour =
            (createCtx.ponctuel
              ? sd
                ? new Date(`${sd}T00:00:00`).toLocaleDateString("fr-FR", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })
                : "créneau ponctuel"
              : (DAY_NAMES[createCtx.dayKey] ?? createCtx.dayKey)) +
            (createSlot ? ` · ${createSlot.startTime}–${createSlot.endTime}` : "");
          return (
            <ModalOverlay onClose={() => setCreateCtx(null)}>
              <button
                type="button"
                className="modal-close"
                onClick={() => setCreateCtx(null)}
                aria-label="Fermer"
              >
                ×
              </button>
              <div
                className="modal-title"
                style={{ display: "flex", alignItems: "center", gap: ".5rem", flexWrap: "wrap" }}
              >
                <span>➕ Nouvelle réservation :</span>
                {createPeriod && periodTag && (
                  <span
                    className="period-btn active"
                    style={{
                      cursor: "default",
                      padding: ".12rem .5rem",
                      fontSize: ".64rem",
                      gap: ".3rem",
                      textTransform: "capitalize",
                    }}
                  >
                    <span
                      className="period-badge"
                      style={{ display: "block", background: createPeriod.color }}
                    />
                    {periodTag}
                  </span>
                )}
                <span
                  style={{
                    fontSize: ".8rem",
                    fontWeight: 500,
                    color: "var(--muted)",
                    textTransform: "capitalize",
                  }}
                >
                  {dayHour}
                </span>
              </div>
              <div className="form-grid">
                {serviceDemandeurs.length > 0 && (
                  <div className="field full">
                    <label htmlFor="pcm-demandeur-select">Type de demandeur</label>
                    <select
                      id="pcm-demandeur-select"
                      value={cDemType}
                      onChange={(e) => {
                        setCDemType(e.target.value);
                        setCStructure("");
                        setCUser("");
                      }}
                    >
                      <option value="">Tous les demandeurs</option>
                      {serviceDemandeurs.map((d) => (
                        <option key={d.id} value={d.label}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {structureOptions.length > 0 && (
                  <div className="field full">
                    <label htmlFor="pcm-structure-select">Structure</label>
                    <select
                      id="pcm-structure-select"
                      value={cStructure}
                      onChange={(e) => {
                        setCStructure(e.target.value);
                        setCUser("");
                      }}
                    >
                      <option value="">Toutes les structures</option>
                      {structureOptions.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="field full">
                  <label htmlFor="pcm-user-select">Demandeur</label>
                  <select
                    id="pcm-user-select"
                    value={cUser}
                    onChange={(e) => setCUser(e.target.value)}
                  >
                    <option value="">— choisir —</option>
                    {createUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field full">
                  <span
                    style={{
                      fontSize: ".65rem",
                      fontWeight: 600,
                      letterSpacing: ".1em",
                      textTransform: "uppercase",
                      color: "var(--muted)",
                    }}
                  >
                    Participants
                  </span>
                  <div className="pcm-counters">
                    <label className="pcm-counter" htmlFor="pcm-enfants">
                      <span className="pcm-counter-icon" aria-hidden="true">
                        👶
                      </span>
                      <input
                        id="pcm-enfants"
                        type="number"
                        min={0}
                        max={99}
                        value={cEnfants}
                        onChange={(e) => setCEnfants(e.target.value)}
                      />
                      <span className="pcm-counter-name">{plural(nCEnf, "Enfant", "Enfants")}</span>
                    </label>
                    <label className="pcm-counter" htmlFor="pcm-accompagnants">
                      <span className="pcm-counter-icon" aria-hidden="true">
                        🧑‍🦰
                      </span>
                      <input
                        id="pcm-accompagnants"
                        type="number"
                        min={0}
                        max={99}
                        value={cAccompagnants}
                        onChange={(e) => setCAccompagnants(e.target.value)}
                      />
                      <span className="pcm-counter-name">{plural(nCAcc, "Adulte", "Adultes")}</span>
                    </label>
                  </div>
                </div>
                {modes.themeMode && (
                  <div className="field full">
                    <label htmlFor="pcm-theme">
                      Thème{" "}
                      <span style={{ color: "var(--muted)", fontSize: ".7rem", fontWeight: 400 }}>
                        (optionnel)
                      </span>
                    </label>
                    {service.themesMode === "liste" ? (
                      <select
                        id="pcm-theme"
                        value={cTheme}
                        onChange={(e) => setCTheme(e.target.value)}
                      >
                        <option value="">— aucun —</option>
                        {themes.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id="pcm-theme"
                        value={cTheme}
                        onChange={(e) => setCTheme(e.target.value)}
                        placeholder="Thème de la visite…"
                      />
                    )}
                  </div>
                )}
                {!createCtx.ponctuel && createSlot && (
                  <OccurrencesField
                    // « Créneaux concernés » = occurrences qui seront EFFECTIVEMENT créées :
                    // miroirs du slot ≥ aujourd'hui (le gestionnaire ne crée pas le passé),
                    // de la semaine A/B effective (en mode A/B), et hors vacances scolaires
                    // si le SERVICE ferme les vacances ou si le demandeur sélectionné est fermé.
                    dates={(() => {
                      const todayISO = ymd(new Date());
                      const selUser = users.find((u) => u.id === cUser);
                      const closedOnSchool =
                        !service.openOnSchoolHolidays || selUser?.openOnSchoolHolidays === false;
                      return uniqueSlots
                        .filter((u) => u.parentSlotId === createCtx.slotId && u.slotDate)
                        .map((u) => u.slotDate as string)
                        .filter((d) => {
                          if (d < todayISO) return false;
                          if (closedOnSchool && inSchoolHolidayRange(d, schoolHolidays))
                            return false;
                          if (!abMode || effectiveWeek == null) return true;
                          return slotWeekTag(d) === effectiveWeek;
                        })
                        .sort();
                    })()}
                    startTime={createSlot.startTime}
                    endTime={createSlot.endTime}
                  />
                )}
              </div>
              {cError && (
                <p className="field-error" style={{ display: "block" }}>
                  {cError}
                </p>
              )}
              <div className="btn-row">
                <button type="button" className="btn btn-ghost" onClick={() => setCreateCtx(null)}>
                  Annuler
                </button>
                <button type="button" className="btn btn-primary" onClick={submitCreate}>
                  Réserver
                </button>
              </div>
            </ModalOverlay>
          );
        })()}

      {/* Mode création : modale de choix des demandeurs autorisés PAR DÉFAUT (créneaux créés). */}
      {createDemModal && (
        <DefaultDemandeursModal
          serviceDemandeurs={serviceDemandeurs}
          selected={createDemIds}
          onChange={setCreateDemIds}
          onClose={() => setCreateDemModal(false)}
        />
      )}

      {/* Mode création : modale de configuration d'un créneau (capacité + demandeurs). */}
      {capModal &&
        (() => {
          const slot =
            slots.find((s) => s.id === capModal.slotId) ??
            uniqueSlots.find((s) => s.id === capModal.slotId) ??
            null;
          return (
            <SlotConfigModal
              key={capModal.slotId}
              serviceId={service.id}
              slotId={capModal.slotId}
              title={slot ? ` · ${slot.startTime}–${slot.endTime}` : ""}
              initialCapacity={String(slot?.capacity ?? service.capacity)}
              initialDemIds={slotDemandeurs[capModal.slotId] ?? []}
              serviceDemandeurs={serviceDemandeurs}
              onClose={() => setCapModal(null)}
              onSaved={() => {
                setCapModal(null);
                router.refresh();
              }}
            />
          );
        })()}

      {/* Confirmation de suppression d'un créneau (mode création). */}
      {slotDeleteTarget &&
        (() => {
          const slot =
            slots.find((s) => s.id === slotDeleteTarget) ??
            uniqueSlots.find((s) => s.id === slotDeleteTarget) ??
            null;
          const timePart = slot ? `${slot.startTime}–${slot.endTime}` : "";
          return (
            <SlotDeleteModal
              timePart={timePart}
              onCancel={() => setSlotDeleteTarget(null)}
              onConfirm={confirmDeleteSlot}
            />
          );
        })()}

      {/* Confirmation de copie des créneaux d'une semaine A/B vers l'autre. */}
      {copyConfirm && (
        <CopyWeekConfirmModal
          from={copyConfirm.from}
          to={copyConfirm.to}
          onCancel={() => setCopyConfirm(null)}
          onConfirm={confirmCopyWeek}
        />
      )}

      {/* Menu contextuel (clic droit) : Copier une réservation / Coller sur un créneau. */}
      {ctxMenu &&
        createPortal(
          <div className="badge-ctx-menu" style={{ top: ctxMenu.y, left: ctxMenu.x }}>
            {ctxMenu.kind === "booking" ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setCopiedBooking({
                      id: ctxMenu.booking.id,
                      mode: "cut",
                    });
                    setCtxMenu(null);
                  }}
                >
                  ✂️ Couper
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCopiedBooking({
                      id: ctxMenu.booking.id,
                      mode: "copy",
                    });
                    setCtxMenu(null);
                  }}
                >
                  📋 Copier
                </button>
                <button
                  type="button"
                  className="ctx-danger"
                  onClick={() => {
                    setDeleteTarget(ctxMenu.booking);
                    setCtxMenu(null);
                  }}
                >
                  🗑️ Supprimer
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={!copiedBooking || !isCellPasteable(ctxMenu.block)}
                onClick={() => {
                  pasteBookingOnto(ctxMenu.block);
                  setCtxMenu(null);
                }}
              >
                📌 Coller ici
              </button>
            )}
          </div>,
          document.body,
        )}

      {/* Info-bulle flottante unique (texte data-tip / « Journées concernées »). */}
      <AgendaTooltip tip={tip} tipRef={tipRef} />

      {/* Toast d'avertissement (au-dessus des modales), centré sur .app-main, bas de page.
          La classe .toast positionne en bas + translateX(-50%) ; on ne surcharge que `left`. */}
      {toast &&
        createPortal(
          <output
            className={`toast toast--warn${toastVisible ? " show" : ""}`}
            style={{
              zIndex: 10010,
              ...(toastCenterX != null ? { left: `${toastCenterX}px` } : {}),
            }}
          >
            {toast.content}
          </output>,
          document.body,
        )}
    </div>
  );
}
