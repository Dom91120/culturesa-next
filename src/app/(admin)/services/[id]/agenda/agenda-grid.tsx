"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  useAgendaAutoRefresh,
  useAgendaToast,
  useCoveringPeriodLock,
  usePersistedAgendaView,
} from "@/components/agenda-hooks";
import {
  AgendaDayBackground,
  AgendaEmptyWeekNotice,
  AgendaTimeColumn,
  AgendaWeekHeader,
  PointagePill,
  PrintIconButton,
} from "@/components/agenda-shared";
import { AgendaTooltip, useAgendaTooltip } from "@/components/agenda-tooltip";
import {
  type AgendaBlockBase,
  addDays,
  autonomousUniqueIds,
  badgeStyle,
  buildBlocksByDay,
  buildMirrorMap,
  CLOSED_OPENING,
  coveringForYmd,
  DAY_NAMES,
  DAY_OFFSET,
  dayKeyFromYmd,
  deriveCoveringPeriod,
  type ExerciceOpening,
  gridDaysAndBounds,
  gridGeometry,
  isBookingLockedByPointage,
  lunchBounds,
  makeDayClosure,
  makeWeekNavigation,
  mondayOf,
  type Pointage,
  parseWeeks,
  periodsCoverToday,
  ROW_H,
  type Slot,
  shortDateFmt,
  slotWeekTag,
  toMinutes,
  type UniqueSlot,
  visiblePeriodsOf,
  weekContextOpenings,
  weekDateLabels,
  ymd,
} from "@/lib/agenda-core";
import { escapeHtml } from "@/lib/email-theme";
import { isFrenchHoliday } from "@/lib/french-holidays";
import { gaugeColor } from "@/lib/gauge";
import { printHtmlDocument } from "@/lib/print-html";
import { isInSchoolHolidayRange as inSchoolHolidayRange } from "@/lib/school-holidays";
import { useDragInteraction } from "@/lib/use-drag-interaction";
import type { ServiceModes } from "@/server/services/service-modes";
import type { BatchUpdatedItem } from "./actions";
import {
  cloneSlotAtTimesAction,
  copyBookingAction,
  copyWeekSlotsAction,
  createRecurringBookingAction,
  createRecurringSlotAction,
  createUniqueBookingAction,
  createUniqueSlotBatchAction,
  cutBookingAction,
  deleteBookingAdminAction,
  deleteSlotAction,
  deleteSlotSeriesAction,
  listAgendaSessionsAction,
  listAgendaUsersAction,
  moveBookingAction,
  moveRecurringSlotAction,
  moveUniqueSlotAction,
  revertSlotBatchAction,
  setBookingPointageAction,
  setBookingValidatedAction,
  setServiceCreatePrefsAction,
  setServiceDefaultCapacityAction,
  updateSlotBatchAction,
} from "./actions";
import { CopyWeekConfirmModal, SlotDeleteModal } from "./agenda-confirm-modals";
import { badgeTitle } from "./agenda-format";
import { BookingCreateModal, type UserOpt } from "./booking-create-modal";
import { BookingDeleteModal } from "./booking-delete-modal";
import { BookingDetailModal } from "./booking-detail-modal";
import { BookingStackModal } from "./booking-stack-modal";
import { asCreateKind, type CreateKind, sanitizeDemIds } from "./create-prefs";
import { DefaultDemandeursModal } from "./default-demandeurs-modal";
import { SlotConfigModal } from "./slot-config-modal";

// (Les réglages d'ouverture — plages, jours actifs, fériés, vacances — sont portés
// par CHAQUE EXERCICE, cf. type Exercice.opening ; hors exercice = fermé.)
type Service = {
  id: string;
  label: string;
  capacity: number;
  themesMode: "libre" | "liste";
  gaugeAccompagnants: boolean;
  // Réglages mémorisés du mode création (cf. create-prefs.ts).
  createKind: string;
  createParityScoped: boolean;
  createJauge: boolean;
  createDemandeurIds: number[];
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
type Exercice = {
  id: number;
  label: string;
  dateStart: string; // "YYYY-MM-DD" ou ""
  dateEnd: string;
  // Réglages d'ouverture RÉSOLUS de l'exercice (surcharge ?? service, côté serveur).
  opening: ExerciceOpening;
};

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
// UserOpt (usager de la modale de création) : type déménagé dans
// booking-create-modal.tsx, réimporté ici pour le chargement à la demande.

// badgeTitle (info-bulle de réservation) : déménagé dans agenda-format.ts,
// partagé avec la modale pile extraite (booking-stack-modal).
// badgeStyle : partagé via lib/agenda-core (harmonisé entre grilles admin/usager).

// Bloc = UN créneau un jour donné (modèle partagé, cf. lib/agenda-core).
type Block = AgendaBlockBase<Booking>;

// Durée d'affichage du bandeau de bilan d'édition de lot avant auto-fermeture (ms),
// suspendue au survol/focus. Un peu généreuse : l'annulation porte sur des semaines
// non visibles à l'écran.
const BATCH_DISMISS_MS = 10000;

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

// Type de créneau créé en « Semaine réelle » (mode création) — sélecteur à 3 états qui
// remplace l'ancienne case « Création multiple ». L'icône reprend les pastilles de
// légende (is-rec = récurrent jaune, is-uniq = ponctuel vert). L'état « rec » n'est
// proposé que si le service a un mode récurrent (cf. modes.recurringMode).
// (Le type vit dans create-prefs.ts, qui mémorise ce sélecteur d'une visite à l'autre.)
const CREATE_KINDS: {
  kind: CreateKind;
  swatch: string;
  multi?: boolean;
  label: string;
  tip: string;
}[] = [
  {
    kind: "rec",
    swatch: "is-rec",
    label: "Créneaux récurrents",
    tip: "Créer des créneaux récurrents (chaque semaine de la période)",
  },
  {
    kind: "uniq",
    swatch: "is-uniq",
    label: "Créneau ponctuel",
    tip: "Créer un créneau ponctuel (cette semaine)",
  },
  {
    kind: "multi",
    swatch: "is-uniq",
    multi: true,
    label: "Créneaux ponctuels multiples",
    tip: "Créer un créneau ponctuel sur chaque semaine de la période (parité A/B respectée)",
  },
];

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
  viewerEmail,
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
  // E-mail du gestionnaire connecté : préfixe la clé sessionStorage de la vue
  // (sans lui, un compte héritait de la vue mémorisée du compte précédent dans le
  // même onglet — même correctif que la grille usager, audit 2026-07-17).
  viewerEmail: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // Le jour (dayKey) d'une réservation se déduit désormais de son créneau : slotDay
  // pour un récurrent, jour de la date pour un ponctuel. (Le champ booking.dayKey a
  // été supprimé en base avec le passage au modèle « un slot = un jour ».)
  const bookings = useMemo<Booking[]>(() => {
    const recurDay = new Map(slots.map((s) => [s.id, s.slotDay ?? ""]));
    const uniqDay = new Map(uniqueSlots.map((s) => [s.id, dayKeyFromYmd(s.slotDate)]));
    // Réhydratation des ENFANTS d'occurrence : le payload ne porte l'identité
    // (nom/tél/e-mail/demandeur/structure) que sur la réservation PARENTE — même
    // usager par construction — pour ne plus la dupliquer ~36× par récurrente à
    // chaque tick d'auto-refresh (audit perf 2026-07-17, cf. page.tsx).
    const byId = new Map(bookingsRaw.map((b) => [b.id, b]));
    return bookingsRaw.map((b) => {
      const parent = b.parentBookingId != null ? byId.get(b.parentBookingId) : undefined;
      return {
        ...b,
        ...(parent
          ? {
              name: parent.name,
              tel: parent.tel,
              email: parent.email,
              demandeur: parent.demandeur,
              structure: parent.structure,
            }
          : {}),
        dayKey: recurDay.get(b.slotId) ?? uniqDay.get(b.slotId) ?? "",
      };
    });
  }, [bookingsRaw, slots, uniqueSlots]);
  // Exercice courant : par défaut le plus récent (dernier après tri par libellé).
  const [currentExerciceId, setCurrentExerciceId] = useState<number | null>(
    exercices.length ? exercices[exercices.length - 1].id : null,
  );
  // Vue UNIQUE « Semaine réelle » (le « Modèle de période » a été retiré : la Semaine réelle
  // couvre toute sa fonction — création/édition des créneaux ET gestion complète des
  // réservations récurrentes). La période active se déduit de la semaine affichée (verrou
  // rwPeriodId), il n'y a plus de sélection de période/semaine A/B « abstraite ».
  const [anchorMonday, setAnchorMonday] = useState<string | null>(null);
  // Période active verrouillée : sans ce verrou, on re-dérive la période depuis la semaine à
  // chaque ◀/▶ — et quand une semaine chevauche la frontière de deux périodes contiguës,
  // elle bascule sur la voisine (dont les bornes laissent sortir). Cf. legacy _agendaPeriodUserPicked.
  const [rwPeriodId, setRwPeriodId] = useState<number | null>(null);
  const [hideEmpty, setHideEmpty] = useState(false);
  const [validation, setValidation] = useState(false);
  const [pointageMode, setPointageMode] = useState(false);
  // Mode « Création de créneau » : clic = créneau d'1 quart d'heure ; glisser
  // haut/bas = créneau de plusieurs quarts (validé au relâché). Cf. plus bas.
  const [creationMode, setCreationMode] = useState(false);
  // Type de créneau créé en « Semaine réelle » (sélecteur à 3 états, remplace l'ancienne
  // case « Création multiple ») : "rec" = récurrent (période + jour + parité A/B) ;
  // "uniq" = ponctuel daté de la semaine affichée ; "multi" = ponctuel répliqué sur
  // CHAQUE semaine de la période active (même parité A/B en mode A/B), dates fermées
  // sautées — cf. uniqueCreateDates. En « Modèle de période » la création est toujours
  // récurrente (le sélecteur est masqué). Défaut "uniq" (comportement historique).
  // Les 4 réglages ci-dessous sont MÉMORISÉS sur le service (cf. create-prefs.ts) :
  // ils s'initialisent depuis les props serveur — d'où l'absence d'effet de relecture,
  // qui désaccorderait l'hydratation — et sont réenregistrés à chaque changement.
  const [createKind, setCreateKind] = useState<CreateKind>(() =>
    asCreateKind(service.createKind, modes.recurringMode),
  );
  // Mode « Semaine A/B » (service A/B, bouton A/B de l'en-tête) : quand il est activé,
  // les créneaux RÉCURRENTS créés sont limités à la parité de la semaine affichée
  // (weeks = "A"/"B") ; désactivé = toutes les semaines (weeks = "").
  const [parityScoped, setParityScoped] = useState(service.createParityScoped);
  // Mode « Jauge » (icône capsule) : les créneaux créés portent jauge = ce mode au
  // moment de la création (colonne slots.jauge).
  const [jaugeMode, setJaugeMode] = useState(service.createJauge);
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
  // Mémorisés eux aussi ; les ids d'un demandeur retiré du service depuis sont écartés.
  const [createDemIds, setCreateDemIds] = useState<number[]>(() =>
    sanitizeDemIds(
      service.createDemandeurIds,
      serviceDemandeurs.map((d) => d.id),
    ),
  );
  const [createDemModal, setCreateDemModal] = useState(false);

  // ── Mémorisation des réglages du mode création (cf. create-prefs.ts) ──
  // Un seul effet, d'ÉCRITURE : l'état initial vient déjà des props serveur. Le verrou
  // retient son premier passage, qui réenregistrerait inutilement les valeurs relues
  // (et écraserait un assainissement — « rec » retombé sur « uniq » — avant même que le
  // gestionnaire n'ait touché à quoi que ce soit).
  const prefsMounted = useRef(false);
  useEffect(() => {
    if (!prefsMounted.current) {
      prefsMounted.current = true;
      return;
    }
    startTransition(async () => {
      await setServiceCreatePrefsAction({
        serviceId: service.id,
        createKind,
        createParityScoped: parityScoped,
        createJauge: jaugeMode,
        createDemandeurIds: createDemIds,
      });
    });
  }, [service.id, createKind, parityScoped, jaugeMode, createDemIds]);
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
  // (État du formulaire de création : rapatrié dans BookingCreateModal, montée à
  // la demande — l'état repart vierge à chaque ouverture.)
  // Modale « configuration de créneau » (mode création) : capacité + demandeurs autorisés.
  const [capModal, setCapModal] = useState<{ slotId: string } | null>(null);
  // Confirmation de copie des créneaux A↔B (modale dédiée au lieu de window.confirm).
  const [copyConfirm, setCopyConfirm] = useState<{ from: "A" | "B"; to: "A" | "B" } | null>(null);
  // Confirmation de suppression d'un créneau vide (modale dédiée au lieu de window.confirm).
  const [slotDeleteTarget, setSlotDeleteTarget] = useState<string | null>(null);
  // Bilan d'une édition de LOT « multi » (redimension/déplacement en mode multi) :
  // alimente le bandeau « N créneaux modifiés — Annuler ». `updated` = état ANTÉRIEUR
  // des occurrences (pour l'annulation via revertSlotBatchAction).
  const [batchEdit, setBatchEdit] = useState<{
    updated: BatchUpdatedItem[];
    skipped: number;
  } | null>(null);
  // Auto-fermeture du bandeau de bilan : pause (survol/focus), solde restant (ref) et
  // séquence de remontage de la barre de progression (animation CSS relancée par lot).
  const [batchPaused, setBatchPaused] = useState(false);
  const [batchSeq, setBatchSeq] = useState(0);
  const batchRemainRef = useRef(BATCH_DISMISS_MS);
  // Étiquette de portée affichée pendant un glisser de LOT (compteur « valeur · N
  // créneaux »), positionnée au curseur. Null hors drag de lot.
  const [dragInfo, setDragInfo] = useState<{ x: number; y: number; text: string } | null>(null);
  // Portée « lot » capturée AU DÉBUT d'un glisser (resize/move) en mode multi : batchId
  // + nombre d'occurrences présentes/futures. Stable pendant le geste (le sélecteur ne
  // change pas en cours de drag). Null = geste à portée d'un seul créneau.
  const dragBatchRef = useRef<{ batchId: string; count: number } | null>(null);
  // Bandeau de bilan : réarme le minuteur à chaque nouvelle édition de lot. batchSeq
  // force le REMONTAGE de la barre de progression (l'animation CSS repart de 100 %)
  // si un 2e lot arrive pendant que le bandeau est encore ouvert.
  useEffect(() => {
    if (!batchEdit) return;
    batchRemainRef.current = BATCH_DISMISS_MS;
    setBatchPaused(false);
    setBatchSeq((s) => s + 1);
  }, [batchEdit]);
  // Auto-fermeture par UN timeout, SUSPENDU au survol/focus (batchPaused) : le cleanup
  // décompte le temps couru du solde (batchRemainRef), la reprise repart du solde.
  // (Audit perf 2026-07-19 : l'ancien compteur setInterval(100 ms) re-rendait tout le
  // composant ~10×/s pendant le décompte ; la barre est désormais animée en CSS pur —
  // keyframes batch-dismiss — avec play-state suspendu de concert.)
  useEffect(() => {
    if (!batchEdit || batchPaused) return;
    const startedAt = Date.now();
    const id = setTimeout(() => setBatchEdit(null), batchRemainRef.current);
    return () => {
      clearTimeout(id);
      batchRemainRef.current = Math.max(0, batchRemainRef.current - (Date.now() - startedAt));
    };
  }, [batchEdit, batchPaused]);
  // ÉCHAP pendant un glisser (dessiner / journée entière / déplacer / redimensionner) →
  // annule le geste SANS rien créer/déplacer (aperçu abandonné). Écouteur branché
  // uniquement quand un drag est actif → aucune interférence avec l'ÉCHAP des modales.
  useEffect(() => {
    const active = createDrag || allDayDrag || moveDrag || resizeDrag || hResizeDrag;
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      createDragH.cancel();
      allDayDragH.cancel();
      moveDragH.cancel();
      resizeDragH.cancel();
      hResizeDragH.cancel();
      setDragInfo(null);
      dragBatchRef.current = null;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    createDrag,
    allDayDrag,
    moveDrag,
    resizeDrag,
    hResizeDrag,
    createDragH,
    allDayDragH,
    moveDragH,
    resizeDragH,
    hResizeDragH,
  ]);
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

  // ── Réglages d'ouverture PAR EXERCICE ──────────────────────────────────────
  // Une date hors de tout exercice est FERMÉE (CLOSED_OPENING — le service ne
  // porte plus de réglages). Décision produit : « la grille suit l'exercice
  // couvrant chaque jour ».
  const openingForYmd = useCallback(
    (d: string): ExerciceOpening => coveringForYmd(exercices, d)?.opening ?? CLOSED_OPENING,
    [exercices],
  );

  // Ouvertures « de contexte » pour les colonnes, les bornes de grille et la pause :
  // chaque jour de la semaine affichée (dédupliqué) — une semaine à cheval sur deux
  // exercices agrège les deux.
  const contextOpenings = useMemo(() => {
    if (!anchorMonday) return [CLOSED_OPENING];
    return weekContextOpenings(anchorMonday, openingForYmd);
  }, [anchorMonday, openingForYmd]);

  // Colonnes (jours actifs du contexte — en Semaine réelle, UNION des exercices de la
  // semaine, le grisage par date fermant les jours inactifs) + bornes horaires de la
  // grille : dérivation partagée (gridDaysAndBounds, agenda-core). Mémoïsé : `days`
  // est une dép de blocksByDay — un nouveau tableau à chaque rendu invaliderait la
  // chaîne (perf).
  const { days, baseFirst, baseLast } = useMemo(
    () => gridDaysAndBounds(contextOpenings),
    [contextOpenings],
  );
  // Offsets (depuis le lundi) du 1er et du dernier jour TRAVAILLÉ de la semaine :
  // le libellé de la nav hebdo affiche ces bornes, pas lundi/dimanche fixes.
  const firstDayOffset = days.length ? (DAY_OFFSET[days[0]] ?? 0) : 0;
  const lastDayOffset = days.length ? (DAY_OFFSET[days[days.length - 1]] ?? 6) : 6;

  // Périodes visibles = celles de l'exercice courant (toutes si aucun exercice).
  const visiblePeriods = visiblePeriodsOf(periods, currentExerciceId);

  // « Aujourd'hui » n'a de sens que si la date du jour tombe dans une période de l'exercice
  // affiché (sinon le bouton renverrait hors de la plage visible) → on masque le bouton sinon.
  const todayYmd = ymd(new Date());
  const todayInVisiblePeriods = periodsCoverToday(visiblePeriods, todayYmd);

  // Navigation entre exercices (◀ label ▶).
  const exIdx = exercices.findIndex((e) => e.id === currentExerciceId);
  const exLabel = exIdx >= 0 ? exercices[exIdx].label : "—";
  const canExPrev = exIdx > 0 && showPrevious;
  const canExNext = exIdx >= 0 && exIdx < exercices.length - 1;
  function gotoExercice(id: number) {
    setCurrentExerciceId(id);
  }

  // ── Mode "Semaine réelle" : semaine datée + période couvrant cette semaine ──
  // (Dérivation partagée deriveCoveringPeriod, agenda-core — verrou rwPeriodId
  // prioritaire, repli lundi puis mercredi.)
  const mondayStr = anchorMonday;
  const { sundayStr, periodCoveringDate, coveringPeriod } = deriveCoveringPeriod(
    periods,
    mondayStr,
    rwPeriodId,
  );
  // Période active = celle qui couvre la semaine affichée. Sans période couvrante, -1 ne
  // matche rien → aucun bloc.
  const effectivePeriodId = coveringPeriod?.id ?? -1;

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
  // Navigation hebdo ◀/▶ (fabrique partagée makeWeekNavigation, agenda-core) : bornée
  // à la période couvrante ; en hideEmpty, saute aux semaines AYANT une réservation.
  // Mémoïsé : le balayage va jusqu'à 260 semaines — à ne recalculer que quand les
  // données ou la semaine changent, pas à chaque survol/drag (audit perf).
  // biome-ignore lint/correctness/useExhaustiveDependencies: weekHasBooking est une closure recréée à chaque rendu ; ses entrées réelles sont listées (bookedSlotDates, recurAbByPeriod, coveringPeriod, periods, modes.abMode).
  const { canWeekPrev, canWeekNext, shiftTarget } = useMemo(
    () => makeWeekNavigation({ mondayStr, coveringPeriod, hideEmpty, weekHas: weekHasBooking }),
    [mondayStr, hideEmpty, coveringPeriod, bookedSlotDates, recurAbByPeriod, periods, modes.abMode],
  );
  function shiftWeek(deltaWeeks: number) {
    const target = shiftTarget(deltaWeeks);
    if (target) setAnchorMonday(target);
  }
  // Libellé daté de chaque jour de la semaine réelle, par dayKey.
  const weekDateByDay = weekDateLabels(mondayStr, days);
  // Jour fermé / férié / vacances (Semaine réelle) : prédicats partagés
  // (makeDayClosure, agenda-core). Mémoïsé : identités stables entre rendus tant que
  // la période ne change pas → permet la mémo des blocs par jour (cf. dayBlockEls).
  const { isDayDisabled, outOfPeriodCls } = useMemo(
    () =>
      makeDayClosure({
        active: true,
        mondayStr,
        coveringPeriod,
        openingForYmd,
        schoolHolidays,
      }),
    [mondayStr, coveringPeriod, openingForYmd, schoolHolidays],
  );

  // ── Semaines A/B ── (dérivé de la matrice demandeurs, pas de la colonne service)
  const abMode = modes.abMode;
  const realWeekParity: "A" | "B" | null = mondayStr ? slotWeekTag(mondayStr) : null;
  // Semaine effective filtrée = parité de la semaine affichée (mode A/B uniquement).
  const effectiveWeek: "A" | "B" | null = abMode ? realWeekParity : null;
  // Parité appliquée aux créneaux RÉCURRENTS créés (bouton « Semaine A/B ») : la semaine
  // affichée si le mode est activé, sinon "" = toutes les semaines. N'affecte QUE la
  // création — l'affichage/filtrage reste piloté par la parité réelle (effectiveWeek).
  const createWeeks: "A" | "B" | "" =
    abMode && parityScoped && realWeekParity ? realWeekParity : "";

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
  const uniqueIdSet = useMemo(() => autonomousUniqueIds(uniqueSlots), [uniqueSlots]);
  const mirrorMap = useMemo(() => buildMirrorMap(uniqueSlots), [uniqueSlots]);

  // Ids des créneaux récurrents qui portent AU MOINS une réservation (toutes semaines
  // confondues) : la réservation récurrente parente vit sur le slot récurrent lui-même
  // (bookingType "recurring"). Sert à n'autoriser la suppression d'un récurrent depuis
  // la Semaine réelle que s'il est vide (comme la vue Modèle) — sinon la suppression
  // effacerait des réservations d'autres semaines sans que l'utilisateur les voie.
  const recurringSlotsWithBookings = useMemo(() => {
    const set = new Set<string>();
    for (const bk of bookings) if (bk.bookingType === "recurring") set.add(bk.slotId);
    return set;
  }, [bookings]);

  // Parité (A/B) des créneaux récurrents limités à UNE seule semaine (weeks = "A"/"B") :
  // sert à marquer ces créneaux d'une lettre. Un récurrent « toutes semaines » (weeks
  // "" / "A,B") n'a pas de parité → pas de lettre.
  const slotParityById = useMemo(() => {
    const m = new Map<string, "A" | "B">();
    if (!modes.abMode) return m;
    for (const s of slots) {
      const w = parseWeeks(s.weeks);
      if (w.length === 1) m.set(s.id, w[0]);
    }
    return m;
  }, [slots, modes.abMode]);

  // Ids des créneaux ponctuels appartenant à un lot « multi » (batchId non nul) : sert
  // au badge « Multi » affiché en mode création multi (repère de portée du drag/série).
  const batchSlotIds = useMemo(
    () => new Set(uniqueSlots.filter((s) => s.batchId).map((s) => s.id)),
    [uniqueSlots],
  );

  // ── Pause méridienne (port legacy renderAgendaWeekly) ───────────────────────
  // Zone entre morningEnd et afternoonStart. Si > 30 min, on COMPACTE : on ne garde
  // que 2 quarts visuels (30 min) — les quarts au-delà de lunchStart+30 sont sautés.
  // Le reste de la grille (lignes, heures, blocs, clics) suit un mapping par quarts
  // d'heure VISIBLES (mapMinToY), au lieu d'un mapping linéaire heure/heure.
  // Bornes de pause du premier contexte qui en définit une (fonction partagée
  // lunchBounds, agenda-core) — exercice affiché en Modèle ; en Semaine réelle, un
  // jour hors exercice (CLOSED_OPENING) ne masque pas la pause du reste de la semaine.
  const { lunchStart, lunchEnd, hasLunch, lunchSkipFrom } = lunchBounds(
    contextOpenings,
    gridStartMin,
    gridEndMin,
  );

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
        if (!mondayStr) continue;
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

  // Blocs par jour : moteur PARTAGÉ (buildBlocksByDay, agenda-core), toujours en Semaine
  // réelle (les récurrents s'affichent via leurs occurrences datées de la semaine).
  const blocksByDay = useMemo(
    () =>
      buildBlocksByDay({
        slots,
        uniqueSlots,
        bookings,
        days,
        mondayStr,
        sundayStr,
        realweek: true,
        effectivePeriodId,
        effectiveWeek,
        abMode,
        gridStartMin,
        serviceCapacity: service.capacity,
        gaugeAccompagnants: service.gaugeAccompagnants,
        uniqueIdSet,
        mirrorMap,
        projectRecurringParent: true,
      }),
    [
      bookings,
      slots,
      uniqueSlots,
      uniqueIdSet,
      mirrorMap,
      mondayStr,
      sundayStr,
      days,
      abMode,
      effectivePeriodId,
      effectiveWeek,
      gridStartMin,
      service.capacity,
      service.gaugeAccompagnants,
    ],
  );

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
  // (Hook partagé avec la grille usager — cf. components/agenda-hooks.)
  useAgendaAutoRefresh(
    autoRefreshSeconds,
    () => !autoRefreshBusy,
    () => startTransition(() => router.refresh()),
  );

  // Toast léger (réutilise les classes .toast du legacy), hook partagé : affiché ~4 s
  // puis retiré, centré sur la zone .app-main. Charge utile admin = un ReactNode.
  const { toast, toastVisible, toastCenterX, showToast } = useAgendaToast<{
    content: React.ReactNode;
  }>();
  function showWarnToast(content: React.ReactNode) {
    showToast({ content });
  }

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
  // Copie tous les créneaux récurrents de la semaine (parité) courante vers l'autre A/B,
  // dans la période active. En Semaine réelle : parité de la semaine affichée (effectiveWeek
  // = realWeekParity) → l'autre, sur la période couvrante.
  function copyWeek() {
    if (!abMode || effectiveWeek == null) return;
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

  // Aperçu MUTUALISÉ d'un créneau en cours de création/redimensionnement : DÉCOUPÉ en 1 ou
  // 2 blocs au passage de la pause méridienne (lunchSplitSegments), exactement comme le
  // résultat final (finalizeCreate / finalizeResize). `dashed` = « à créer » (pointillé,
  // création) vs plein (redimensionnement). Chaque segment affiche son horaire.
  function renderDragPreviewSegments(args: {
    startMin: number;
    endMin: number;
    color: string;
    dashed: boolean;
    bgPct: number;
    zIndex: number;
    className: string;
  }): React.ReactNode[] {
    return lunchSplitSegments(args.startMin, args.endMin)
      .filter(([a, b]) => b > a)
      .map(([segS, segE]) => {
        const top = mapMinToY(segS);
        const h = mapMinToY(segE) - top;
        return (
          <div
            key={segS}
            className={args.className}
            style={{
              position: "absolute",
              left: 2,
              right: 2,
              top,
              height: Math.max(2, h),
              background: `color-mix(in srgb, ${args.color} ${args.bgPct}%, transparent)`,
              border: args.dashed ? `1px dashed ${args.color}` : `2px solid ${args.color}`,
              borderRadius: 6,
              pointerEvents: "none",
              zIndex: args.zIndex,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: ".62rem",
              fontWeight: 700,
              color: args.color,
            }}
          >
            {minToHHMM(segS)}–{minToHHMM(segE)}
          </div>
        );
      });
  }

  // mousedown sur une colonne en mode création : démarre un glisser-créer, mais
  // seulement sur une zone VIDE (pas sur un bloc existant).
  function onCreateMouseDown(e: React.MouseEvent, dayKey: string) {
    if (!creationMode || isDayDisabled(dayKey)) return;
    if ((e.target as HTMLElement).closest(".agenda-block")) return;
    if (!mondayStr) return;
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

  // Dates de création d'un ponctuel (Semaine réelle) pour une colonne : la date de la
  // semaine affichée, ou — réplication sur la période — le même jour de CHAQUE semaine.
  // Filtres alignés sur la génération des miroirs / isDayDisabled : parité A/B, jour actif
  // de l'exercice couvrant, fériés et vacances scolaires fermés sautés.
  // `override` : force la parité (`parity`) et la réplication (`replicate`) — utilisé par
  // l'ÉLARGISSEMENT, qui doit suivre le type du créneau SOURCE, pas le mode A/B courant.
  // Sans override : parité = semaine affichée (si « Semaine A/B » actif), réplication =
  // mode « Création multiple ».
  function uniqueCreateDates(
    dayKey: string,
    override?: { parity: "A" | "B" | null; replicate: boolean },
  ): string[] {
    if (!mondayStr) return [];
    const off = DAY_OFFSET[dayKey] ?? 0;
    const single = ymd(addDays(mondayStr, off));
    const p = coveringPeriod;
    const replicate = override ? override.replicate : createKind === "multi";
    if (!replicate || !p?.dateStart || !p.dateEnd) return [single];
    // Parité effective : celle imposée (élargissement) ou celle de la semaine affichée.
    const parity = override
      ? override.parity
      : parityScoped && realWeekParity
        ? realWeekParity
        : null;
    const dates: string[] = [];
    let monday = ymd(mondayOf(new Date(`${p.dateStart}T00:00:00`)));
    // ≤ 120 itérations : garde-fou large (une période ≈ 53 semaines au plus).
    for (let guard = 0; guard < 120 && monday <= p.dateEnd; guard++) {
      const weekMonday = monday;
      monday = ymd(addDays(monday, 7));
      // Filtre de parité : uniquement la parité voulue (A/B) ; null = toutes les semaines.
      if (parity && slotWeekTag(weekMonday) !== parity) continue;
      const d = ymd(addDays(weekMonday, off));
      if (d < p.dateStart || d > p.dateEnd) continue;
      const o = openingForYmd(d);
      if (
        !o.activeDays
          .split(",")
          .map((s) => s.trim())
          .includes(dayKey)
      ) {
        continue;
      }
      if (!o.openOnHolidays && isFrenchHoliday(d)) continue;
      if (!o.openOnSchoolHolidays && inSchoolHolidayRange(d, schoolHolidays)) continue;
      dates.push(d);
    }
    return dates.length ? dates : [single];
  }

  // Au relâché : UN créneau par colonne couverte, couvrant [start, max+15] (clic
  // simple = 1 quart, 1 colonne). Récurrent en Modèle de période (période + jour +
  // semaine A/B active), ponctuel daté en Semaine réelle. Capacité = service.capacity.
  function finalizeCreate(cd: CreateDrag) {
    setDragInfo(null); // ferme l'indicateur de portée du glisser-créer
    const rawStart = Math.min(cd.startMin, cd.curMin);
    const rawEnd = Math.min(gridEndMin, Math.max(cd.startMin, cd.curMin) + 15);
    if (rawEnd <= rawStart) return;
    // La pause méridienne découpe la sélection : 1 créneau par segment hors pause
    // (2 si la sélection déborde de part et d'autre, 0 si elle est dans la pause).
    const segments = lunchSplitSegments(rawStart, rawEnd).filter(([s, e]) => e > s);
    if (!segments.length) return;
    const targets = draggedDays(cd);
    if (!targets.length) return;
    // Récurrent si le sélecteur est sur "rec" ; sinon ponctuel daté.
    if (createKind === "rec") {
      if (effectivePeriodId == null || effectivePeriodId <= 0) return;
      const weeks = createWeeks;
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
                jauge: jaugeMode,
              }),
            ),
          ),
        ),
      );
    } else {
      if (!mondayStr) return;
      runResults(
        Promise.all(
          targets.flatMap((dayKey) => {
            const dates = uniqueCreateDates(dayKey);
            // 1 lot « multi » = 1 (jour de semaine, créneau horaire) répliqué sur la
            // période, créé ATOMIQUEMENT côté serveur (une transaction, batchId généré
            // serveur — l'ancien Promise.all de N actions pouvait laisser un demi-lot
            // en base, audit 2026-07-19). Le serveur ne pose batchId/parité que si le
            // lot compte plusieurs dates (ponctuel isolé → hors lot) ; la parité
            // transmise = createWeeks (parité affichée si « Semaine A/B » actif).
            return segments.map(([s, e]) =>
              createUniqueSlotBatchAction({
                serviceId: service.id,
                dates,
                startTime: minToHHMM(s),
                endTime: minToHHMM(e),
                capacity: createCap,
                demandeurIds: createDemIds,
                jauge: jaugeMode,
                weeks: createWeeks,
              }),
            );
          }),
        ),
      );
    }
  }

  // Suivi du glisser-créer (onMove) : quart courant + colonne (jour) survolée pour la
  // sélection horizontale multi-colonnes. Renvoie l'état suivant si l'un a changé,
  // sinon null. Le relâché (onUp) = finalizeCreate. (cf. useDragInteraction.)
  // Nombre de créneaux qu'un glisser-créer produira : jours couverts × segments hors pause
  // × dates par jour (1 en simple, N en « Création multiple »). Pour l'indicateur de portée.
  function createDragCount(cd: CreateDrag): number {
    const rawStart = Math.min(cd.startMin, cd.curMin);
    const rawEnd = Math.min(gridEndMin, Math.max(cd.startMin, cd.curMin) + 15);
    if (rawEnd <= rawStart) return 0;
    const segments = lunchSplitSegments(rawStart, rawEnd).filter(([s, en]) => en > s);
    const targets = draggedDays(cd);
    if (!targets.length || !segments.length) return 0;
    if (createKind === "rec") return targets.length * segments.length;
    return targets.reduce((sum, day) => sum + segments.length * uniqueCreateDates(day).length, 0);
  }

  function createDragMove(cd: CreateDrag, e: MouseEvent): CreateDrag | null {
    const q = quarterAtY(cd.colTop, e.clientY);
    const colEl = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>("[data-daykey]");
    const dk = colEl?.dataset.daykey;
    const curDay = dk && days.includes(dk) ? dk : cd.curDay;
    if (q === cd.curMin && curDay === cd.curDay) return null;
    const next = { ...cd, curMin: q, curDay };
    // Indicateur de portée « N créneaux » (sans horaires) pendant la création.
    const n = createDragCount(next);
    setDragInfo({ x: e.clientX, y: e.clientY, text: `${n} créneau${n > 1 ? "x" : ""}` });
    return next;
  }

  // ── Mode création : créneau « journée entière » (bande dédiée) ───────────────
  // mousedown sur une cellule de la bande « Journée entière » : démarre un glisser-
  // créer purement horizontal (aucune dimension verticale), sur zone vide seulement.
  function onAllDayCreateMouseDown(e: React.MouseEvent, dayKey: string) {
    if (!creationMode || isDayDisabled(dayKey)) return;
    if ((e.target as HTMLElement).closest(".agenda-block")) return;
    if (!mondayStr) return;
    e.preventDefault();
    const dd = { startDay: dayKey, curDay: dayKey };
    allDayDragH.start(dd);
  }

  // Au relâché : UN créneau SANS horaire (journée entière) par jour couvert (clic
  // simple = 1 jour ; glisser horizontal = plusieurs). Récurrent si le sélecteur est sur
  // "rec", sinon ponctuel daté. startTime/endTime vides → bloc « journée entière ».
  function finalizeAllDayCreate(dd: AllDayDrag) {
    const targets = daysSpan(dd.startDay, dd.curDay);
    if (!targets.length) return;
    // Récurrent si le sélecteur est sur "rec" ; sinon ponctuel daté.
    if (createKind === "rec") {
      if (effectivePeriodId == null || effectivePeriodId <= 0) return;
      const weeks = createWeeks;
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
              jauge: jaugeMode,
            }),
          ),
        ),
      );
    } else {
      if (!mondayStr) return;
      // 1 lot « multi » par jour (journée entière, horaires vides) répliqué sur la
      // période, créé ATOMIQUEMENT côté serveur (batchId généré serveur) — comme le
      // chemin horaire. Sans ça, la création multiple « journée entière » posait des
      // créneaux SANS batchId : ils n'étaient pas liés en lot (bug antérieur à l'audit
      // 2026-07-19, rendu visible par le passage du chemin horaire au batch serveur).
      runResults(
        Promise.all(
          targets.map((dayKey) =>
            createUniqueSlotBatchAction({
              serviceId: service.id,
              dates: uniqueCreateDates(dayKey),
              startTime: "",
              endTime: "",
              capacity: createCap,
              demandeurIds: createDemIds,
              jauge: jaugeMode,
              weeks: createWeeks,
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
  // modale de confirmation dédiée. En Semaine réelle, un créneau récurrent PEUT être
  // supprimé (le créneau récurrent en totalité, toutes occurrences) tant qu'il est vide
  // — la visibilité de la croix (recurringSlotsWithBookings) garantit ce « vide ».
  function onDeleteEmptySlot(slotId: string) {
    setSlotDeleteTarget(slotId);
  }

  function confirmDeleteSlot() {
    if (!slotDeleteTarget) return;
    runResult(deleteSlotAction(service.id, slotDeleteTarget));
    setSlotDeleteTarget(null);
  }

  // Création ponctuelle « Multi » : supprime le créneau ponctuel ET tous ses jumeaux de
  // la période (le serveur recalcule la série depuis le créneau de référence).
  function confirmDeleteSlotSeries() {
    if (!slotDeleteTarget) return;
    runResult(deleteSlotSeriesAction(service.id, slotDeleteTarget));
    setSlotDeleteTarget(null);
  }

  // Taille du LOT « multi » du créneau `target` (créneaux partageant son batchId).
  // 0 si le créneau n'appartient à aucun lot. Le décompte client sert à l'AFFICHAGE ;
  // la série effective est recalculée côté serveur (deleteSlotSeriesAction).
  function countSlotSeries(targetId: string): number {
    const target = uniqueSlots.find((s) => s.id === targetId) ?? null;
    if (!target?.batchId) return 0;
    return uniqueSlots.filter((s) => s.batchId === target.batchId).length;
  }

  // Portée « lot » d'un créneau ponctuel : son batchId + le nombre d'occurrences À VENIR
  // (présent + futur, le passé n'étant pas réécrit ; `todayYmd` défini plus haut est une
  // date NOMINALE — le serveur fait foi via todayParisISO). Null si pas en lot.
  function batchScopeOf(slotId: string): { batchId: string; count: number } | null {
    const s = uniqueSlots.find((u) => u.id === slotId);
    if (!s?.batchId) return null;
    const count = uniqueSlots.filter(
      (u) => u.batchId === s.batchId && u.slotDate >= todayYmd,
    ).length;
    return { batchId: s.batchId, count };
  }

  // Applique une édition de LOT et alimente le bandeau de bilan (toast si erreur).
  function runBatchResult(
    p: Promise<{
      ok: boolean;
      updated?: BatchUpdatedItem[];
      skipped?: number;
      error?: string;
    }>,
  ) {
    setDetail(null);
    startTransition(async () => {
      const res = await p;
      if (!res.ok) {
        showWarnToast(res.error ?? "Action impossible.");
        return;
      }
      setBatchEdit({ updated: res.updated ?? [], skipped: res.skipped ?? 0 });
      router.refresh();
    });
  }

  // Annule la dernière édition de LOT : restaure chaque occurrence à son état antérieur.
  function undoBatchEdit() {
    if (!batchEdit || batchEdit.updated.length === 0) {
      setBatchEdit(null);
      return;
    }
    const items = batchEdit.updated;
    setBatchEdit(null);
    runResult(revertSlotBatchAction({ serviceId: service.id, items }));
  }

  // Le créneau `b` peut-il recevoir un collage ? (= mêmes règles que cellCreatable :
  // non complet, période active pour un récurrent — récurrent en Semaine réelle inclus.)
  function isCellPasteable(b: Block): boolean {
    if (creationMode) return false;
    const isPonctuel = uniqueIdSet.has(b.slotId);
    // b.used est déjà compté selon la jauge DU créneau (cf. construction des blocs).
    if (b.used >= b.capacity) return false;
    return isPonctuel || (effectivePeriodId != null && effectivePeriodId > 0);
  }

  // Colle la réservation copiée sur le créneau cible `b` (récurrent ou ponctuel). La cible
  // est « collable » (cf. isCellPasteable). Le presse-papier retient l'OCCURRENCE cliquée
  // (pour l'estompage « couper ») → on résout la source vers la réservation PARENTE, comme
  // les autres gestes de gestion.
  function pasteBookingOnto(b: Block) {
    if (!copiedBooking) return;
    const src = bookings.find((x) => x.id === copiedBooking.id);
    const sourceBookingId = src ? actionBooking(src).id : copiedBooking.id;
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
    runResult(action({ serviceId: service.id, sourceBookingId, target }));
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

  // Le créneau porte-t-il au moins une réservation ? Ponctuel : ses réservations datées
  // (b.bookings). Récurrent : la réservation parente, TOUTES semaines confondues
  // (recurringSlotsWithBookings) — b.bookings ne verrait que la semaine affichée en
  // Semaine réelle. Verrou d'édition STRUCTURELLE (déplacer / redimension / suppression
  // réservés aux créneaux vides, comme en Modèle).
  const slotHasBooking = (b: Block): boolean =>
    uniqueIdSet.has(b.slotId) ? b.bookings.length > 0 : recurringSlotsWithBookings.has(b.slotId);

  // ── Mode création : glisser-DÉPLACER un créneau vide ────────────────────────
  // Démarre sur le corps d'un bloc vide (× et badges gérés à part). Le créneau suit
  // le curseur (haut du bloc = quart sous le curseur), durée préservée.
  function onMoveSlotMouseDown(e: React.MouseEvent, b: Block) {
    justMovedRef.current = false; // nouvelle interaction : on repart d'un « pas déplacé »
    if (!creationMode || slotHasBooking(b) || b.isAllDay) return;
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
    // Portée « lot » (mode multi + créneau en lot) capturée pour toute la durée du geste.
    dragBatchRef.current = createKind === "multi" ? batchScopeOf(b.slotId) : null;
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
      const slotDate = ymd(addDays(mondayStr, DAY_OFFSET[md.curDay] ?? 0));
      const batch = dragBatchRef.current;
      // Créneau en lot → déplacement de TOUT le lot (même décalage de jour + horaires
      // appliqués à chaque occurrence). On teste « est-ce un lot » (audit 2026-07-20).
      if (batch) {
        const dayDelta = (DAY_OFFSET[md.curDay] ?? 0) - (DAY_OFFSET[md.fromDay] ?? 0);
        runBatchResult(
          updateSlotBatchAction({
            serviceId: service.id,
            slotId: md.slotId,
            startTime,
            endTime,
            refSlotDate: slotDate,
            dayDelta,
          }),
        );
      } else {
        runResult(
          moveUniqueSlotAction({
            serviceId: service.id,
            slotId: md.slotId,
            slotDate,
            startTime,
            endTime,
          }),
        );
      }
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
    const changed = q !== md.curMin || curDay !== md.curDay;
    // Portée du déplacement de LOT : nombre TOTAL de créneaux du lot (sans horaires).
    if (changed && dragBatchRef.current) {
      const n = countSlotSeries(md.slotId);
      setDragInfo({ x: e.clientX, y: e.clientY, text: `${n} créneau${n > 1 ? "x" : ""}` });
    }
    return changed ? { ...md, curMin: q, curDay } : null;
  }
  // Relâché : on ne déplace que si jour ou début a changé. Si déplacé, on marque le
  // coup pour que le clic résiduel n'ouvre pas la modale de config.
  function moveDragUp(md: MoveDrag) {
    if (md.curDay !== md.fromDay || md.curMin !== md.origMin) {
      finalizeMove(md);
      justMovedRef.current = true;
    }
    setDragInfo(null);
    dragBatchRef.current = null;
  }

  // ── Mode création : glisser-REDIMENSIONNER un créneau vide par un bord ───────
  // Poignée haut/bas sur un bloc vide. Le bord opposé reste fixe ; on étire jusqu'au
  // quart sous le curseur (durée minimale d'un quart). Validé au relâché.
  function onResizeSlotMouseDown(e: React.MouseEvent, b: Block, edge: "top" | "bottom") {
    if (!creationMode || slotHasBooking(b) || b.isAllDay) return;
    if (isDayDisabled(b.dayKey)) return;
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
    // Portée « lot » (mode multi + créneau en lot) capturée pour toute la durée du geste.
    dragBatchRef.current = createKind === "multi" ? batchScopeOf(b.slotId) : null;
    resizeDragH.start(rd);
  }

  // Applique de nouveaux horaires au créneau redimensionné (jour/date inchangés), via les
  // actions de déplacement. Récurrent → jour identique ; ponctuel → même date ; lot « multi »
  // → tout le lot (dates inchangées, dayDelta = 0).
  function applyResizeTimes(rd: ResizeDrag, startTime: string, endTime: string) {
    if (rd.isUnique) {
      if (!mondayStr) return;
      const slotDate = ymd(addDays(mondayStr, DAY_OFFSET[rd.dayKey] ?? 0));
      const batch = dragBatchRef.current;
      // Créneau en lot → redimensionne TOUT le lot (dayDelta 0 → passé compris côté
      // serveur). On teste « est-ce un lot » (batch non nul), pas son décompte à venir
      // (nul sur une période passée) — audit 2026-07-20.
      if (batch) {
        runBatchResult(
          updateSlotBatchAction({
            serviceId: service.id,
            slotId: rd.slotId,
            startTime,
            endTime,
            refSlotDate: slotDate,
            dayDelta: 0,
          }),
        );
      } else {
        runResult(
          moveUniqueSlotAction({
            serviceId: service.id,
            slotId: rd.slotId,
            slotDate,
            startTime,
            endTime,
          }),
        );
      }
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

  // Au relâché : applique les nouveaux horaires. Si le redimensionnement TRAVERSE la pause
  // méridienne, on DÉCOUPE en 2 comme le fait la création : le créneau d'origine conserve le
  // segment ancré à son bord FIXE (bord haut saisi → bas fixe → segment après-midi ; bord bas
  // saisi → haut fixe → segment matin), l'autre segment devient un CLONE (même type, parité,
  // capacité, jauge, demandeurs — cf. cloneSlotAtTimesAction).
  function finalizeResize(rd: ResizeDrag) {
    const segments = lunchSplitSegments(rd.curStart, rd.curEnd).filter(([s, e]) => e > s);
    if (!segments.length) return;
    const keepIdx = rd.edge === "top" ? segments.length - 1 : 0;
    const [keepStart, keepEnd] = segments[keepIdx];
    applyResizeTimes(rd, minToHHMM(keepStart), minToHHMM(keepEnd));
    segments.forEach(([s, e], i) => {
      if (i === keepIdx) return;
      runResult(
        cloneSlotAtTimesAction({
          serviceId: service.id,
          slotId: rd.slotId,
          startTime: minToHHMM(s),
          endTime: minToHHMM(e),
        }),
      );
    });
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
    const changed = curStart !== rd.curStart || curEnd !== rd.curEnd;
    // Portée du redimensionnement de LOT : nombre de créneaux du lot (taille TOTALE, pas
    // le décompte « à venir » qui tombait à 0 sur une période passée). Sans les horaires
    // (retirés — audit 2026-07-20).
    if (changed && dragBatchRef.current) {
      const n = countSlotSeries(rd.slotId);
      setDragInfo({
        x: e.clientX,
        y: e.clientY,
        text: `${n} créneau${n > 1 ? "x" : ""}`,
      });
    }
    return changed ? { ...rd, curStart, curEnd } : null;
  }
  function resizeDragUp(rd: ResizeDrag) {
    if (rd.curStart !== rd.origStart || rd.curEnd !== rd.origEnd) finalizeResize(rd);
    setDragInfo(null);
    dragBatchRef.current = null;
  }

  // ── Mode création : glisser-ÉTENDRE un créneau vide latéralement (gauche/droite) ──
  // Poignée gauche/droite sur un bloc vide. En traversant les colonnes, on prépare un
  // créneau par jour couvert (même plage horaire que la source). Validé au relâché.
  function onResizeSlotMouseDownH(e: React.MouseEvent, b: Block, edge: "left" | "right") {
    if (!creationMode || slotHasBooking(b) || b.isAllDay) return;
    if (isDayDisabled(b.dayKey)) return;
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
      // Le créneau élargi hérite du TYPE (parité A/B/toutes) du créneau SOURCE, PAS du
      // mode A/B courant (audit 2026-07-20). Source = lot « multi » (batchId) → on
      // réplique sur sa parité ; source isolée → un seul créneau ce jour-là.
      const src = uniqueSlots.find((s) => s.id === hd.slotId);
      const srcWeeks: "A" | "B" | "" = src?.weeks === "A" || src?.weeks === "B" ? src.weeks : "";
      const parity: "A" | "B" | null = srcWeeks === "" ? null : srcWeeks;
      const replicate = !!src?.batchId;
      // 1 lot « multi » par jour couvert créé ATOMIQUEMENT côté serveur (batchId généré
      // serveur ; le serveur ne pose batchId/parité que si plusieurs dates).
      runResults(
        Promise.all(
          targets.map((dayKey) =>
            createUniqueSlotBatchAction({
              serviceId: service.id,
              dates: uniqueCreateDates(dayKey, { parity, replicate }),
              startTime,
              endTime,
              capacity: createCap,
              demandeurIds: createDemIds,
              jauge: jaugeMode,
              weeks: srcWeeks,
            }),
          ),
        ),
      );
    } else {
      if (effectivePeriodId == null || effectivePeriodId <= 0) return;
      // Le créneau récurrent élargi hérite de la parité du créneau SOURCE (Slot.weeks),
      // PAS du mode A/B courant (audit 2026-07-20) — le serveur régénère les miroirs sur
      // la bonne parité à partir de ce `weeks`.
      const src = slots.find((s) => s.id === hd.slotId);
      const weeks: "A" | "B" | "" = src?.weeks === "A" || src?.weeks === "B" ? src.weeks : "";
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
              jauge: jaugeMode,
            }),
          ),
        ),
      );
    }
  }

  // Suivi du glisser-étendre latéral : seule la colonne (jour) survolée compte. onUp
  // ne finalise (un créneau par jour couvert) que si le jour a changé. (cf. useDragInteraction.)
  // Nombre de créneaux qu'une extension aux jours voisins produira (jours voisins couverts
  // × dates par jour selon le TYPE du créneau source — cf. finalizeHResize). Pour l'indicateur.
  function hResizeDragCount(hd: HResizeDrag): number {
    const targets = daysSpan(hd.fromDay, hd.curDay).filter((d) => d !== hd.fromDay);
    if (!targets.length) return 0;
    if (!hd.isUnique) return targets.length; // récurrent : 1 par jour voisin
    const src = uniqueSlots.find((s) => s.id === hd.slotId);
    const srcWeeks = src?.weeks === "A" || src?.weeks === "B" ? src.weeks : "";
    const parity: "A" | "B" | null = srcWeeks === "" ? null : srcWeeks;
    const replicate = !!src?.batchId;
    return targets.reduce(
      (sum, day) => sum + uniqueCreateDates(day, { parity, replicate }).length,
      0,
    );
  }

  function hResizeDragMove(hd: HResizeDrag, e: MouseEvent): HResizeDrag | null {
    const colEl = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>("[data-daykey]");
    const dk = colEl?.dataset.daykey;
    const curDay = dk && days.includes(dk) && !isDayDisabled(dk) ? dk : hd.curDay;
    if (curDay === hd.curDay) return null;
    const next = { ...hd, curDay };
    // Indicateur de portée « N créneaux » (sans horaires) pendant l'extension.
    const n = hResizeDragCount(next);
    setDragInfo({ x: e.clientX, y: e.clientY, text: `${n} créneau${n > 1 ? "x" : ""}` });
    return next;
  }
  function hResizeDragUp(hd: HResizeDrag) {
    if (hd.curDay !== hd.fromDay) finalizeHResize(hd);
    setDragInfo(null);
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
  // Prédicat de verrou PARTAGÉ avec le serveur (isBookingLockedByPointage) : inclut
  // désormais le cas MIROIR (parentBookingId non null) que le client omettait — l'UI
  // ne propose plus valider/déplacer/supprimer sur un enfant que le serveur refuserait.
  const lockedByPointage = (bk: Booking): boolean =>
    isBookingLockedByPointage(bk, parentsWithPointedChild.has(bk.id));

  // Réservation cible des actions de GESTION (valider / supprimer / déplacer) : en
  // Semaine réelle, le badge d'un récurrent est l'OCCURRENCE (enfant) → ces gestes portent
  // sur toute la récurrente, donc sur la réservation PARENTE. Ponctuel, ou récurrent en
  // Modèle (bk = parent) : la réservation elle-même. Le POINTAGE, lui, reste par occurrence.
  // Index id → réservation mémoïsé (audit perf 2026-07-19) : le bookings.find O(B) était
  // appelé PAR BADGE au rendu des blocs → O(badges × réservations) à chaque recalcul.
  const bookingById = useMemo(() => new Map(bookings.map((b) => [b.id, b])), [bookings]);
  const actionBooking = (bk: Booking): Booking =>
    bk.parentBookingId != null ? (bookingById.get(bk.parentBookingId) ?? bk) : bk;

  function onBlockQuickAction(bk: Booking): boolean {
    if (validation) {
      // Validation sur la réservation PARENTE (propagée aux occurrences) pour un récurrent.
      const target = actionBooking(bk);
      // Une résa verrouillée (pointée, ou parent à miroir pointé) ne se valide plus.
      // On laisse le clic ouvrir la fiche plutôt que d'agir silencieusement.
      if (lockedByPointage(target)) return false;
      // Bascule validé ↔ en attente (legacy _quickValidate togglait dans les deux sens).
      runResult(setBookingValidatedAction(target.id, service.id, !target.validated));
      return true;
    }
    if (pointageMode) {
      // Pointage = PAR OCCURRENCE → sur l'enfant cliqué (bk), pas la parente.
      const next: Pointage = !bk.pointage ? "present" : bk.pointage === "present" ? "absent" : null;
      runResult(setBookingPointageAction(bk.id, service.id, next));
      return true;
    }
    return false;
  }

  // Impression « liste » (bouton N&B) : au lieu du modèle graphique, la LISTE nominative
  // des réservations de TOUS les usagers pour la semaine affichée. Une ligne par occurrence
  // datée (ponctuels + miroirs des récurrentes), via une action gardée gestionnaire
  // (listDatedSessions). Rendu dans un iframe caché (printHtmlDocument) — sans pop-up.
  async function printSessionsList() {
    if (typeof window === "undefined") return;
    if (!mondayStr) return;
    const from = mondayStr;
    const to = sundayStr ?? mondayStr;
    const scopeLabel = `Semaine du ${shortDateFmt.format(
      addDays(mondayStr, 0),
    )} au ${shortDateFmt.format(addDays(mondayStr, 6))}`;
    if (!from || !to) return;

    let sessions: Awaited<ReturnType<typeof listAgendaSessionsAction>> = [];
    try {
      sessions = await listAgendaSessionsAction(service.id, from, to);
    } catch {
      // requireServiceManager peut rejeter un appelant non autorisé — liste vide alors.
    }
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
              `<tr><td>${escapeHtml(r.date)}</td><td>${escapeHtml(r.creneau)}</td><td>${escapeHtml(r.identite)}</td><td>${escapeHtml(r.struct)}</td><td class="c">${r.enfants}</td><td class="c">${r.accompagnants}</td><td>${escapeHtml(r.theme)}</td><td class="c">${escapeHtml(r.pointage)}</td></tr>`,
          )
          .join("")}</tbody></table>`
      : '<p class="empty">Aucune réservation pour cette période.</p>';
    const titleStr = `${service.label} — ${scopeLabel}`;
    // Plus compact : police réduite, cellules sur une seule ligne (white-space:nowrap)
    // pour que « 09:00 – 10:00 » et l'identité ne se coupent pas.
    const css =
      "*{color:#000;background:#fff}body{font-family:system-ui,Arial,sans-serif;margin:18px;font-size:10px}h1{font-size:14px;margin:0 0 3px}.meta{color:#444;margin:0 0 10px;font-size:10px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:2px 6px;text-align:left;white-space:nowrap}td.c{text-align:center}th{background:#eee !important;font-size:9px;text-transform:uppercase;letter-spacing:.03em}.empty{color:#444}";
    printHtmlDocument(
      `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(titleStr)}</title><style>${css}</style></head><body><h1>${escapeHtml(titleStr)}</h1><div class="meta">${rows.length} réservation${rows.length > 1 ? "s" : ""}</div>${inner}</body></html>`,
    );
  }

  // Restaure la vue (exercice / période / semaine) depuis sessionStorage au montage,
  // puis la persiste à chaque changement (hook partagé usePersistedAgendaView —
  // clé PAR gestionnaire). À défaut, ancre la semaine réelle sur le lundi courant.
  usePersistedAgendaView<{
    exerciceId: number | null;
    anchorMonday: string | null;
  }>({
    storageKey: `agenda-admin-view:${service.id}:${viewerEmail}`,
    restore: (v) => {
      let anchored = false;
      if (v) {
        // Ne restaure l'exercice que s'il existe encore ; un `null` mémorisé (vue
        // enregistrée quand le service n'avait pas d'exercice) est ignoré, sinon il
        // désactiverait le filtre d'exercice (toutes les périodes affichées, nav «—»).
        if (v.exerciceId != null && exercices.some((e) => e.id === v.exerciceId)) {
          setCurrentExerciceId(v.exerciceId);
        }
        if (typeof v.anchorMonday === "string") {
          setAnchorMonday(v.anchorMonday);
          anchored = true;
        }
      }
      if (!anchored) setAnchorMonday(ymd(mondayOf(new Date())));
    },
    snapshot: () => ({ exerciceId: currentExerciceId, anchorMonday }),
    deps: [service.id, viewerEmail, currentExerciceId, anchorMonday],
  });

  // Verrouille la période active en semaine réelle (hook partagé, cf. agenda-hooks).
  useCoveringPeriodLock(true, coveringPeriod, rwPeriodId, setRwPeriodId);

  function openCreate(dayKey: string, slotId: string, ponctuel = false, slotDate?: string) {
    setCreateCtx({ dayKey, slotId, ponctuel, slotDate });
  }

  // Envoi du formulaire de création (BookingCreateModal) : l'action serveur reste
  // ici (période/semaine effectives, refresh) ; la modale affiche l'erreur renvoyée.
  async function submitCreate(form: {
    userId: string;
    enfants: number;
    accompagnants: number;
    theme: string;
  }): Promise<{ ok: boolean; error?: string | null }> {
    if (!createCtx) return { ok: false, error: "Contexte de création perdu." };
    // Créneau ponctuel : réservation ponctuelle (pas de période ni de jour).
    if (createCtx.ponctuel) {
      const res = await createUniqueBookingAction({
        serviceId: service.id,
        slotId: createCtx.slotId,
        userId: form.userId,
        enfants: form.enfants,
        accompagnants: form.accompagnants,
        theme: form.theme,
      });
      if (!res.ok) return { ok: false, error: res.error };
      setCreateCtx(null);
      router.refresh();
      return { ok: true };
    }
    const createPeriodId =
      effectivePeriodId != null && effectivePeriodId > 0 ? effectivePeriodId : null;
    if (createPeriodId == null) {
      return { ok: false, error: "Aucune période active pour créer une réservation." };
    }
    const res = await createRecurringBookingAction({
      serviceId: service.id,
      slotId: createCtx.slotId,
      periodId: createPeriodId,
      dayKey: createCtx.dayKey,
      userId: form.userId,
      enfants: form.enfants,
      accompagnants: form.accompagnants,
      theme: form.theme,
      week: effectiveWeek ?? "",
    });
    if (!res.ok) return { ok: false, error: res.error };
    setCreateCtx(null);
    router.refresh();
    return { ok: true };
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
        // effectiveWeek (= parité de la semaine affichée) suit cette même convention →
        // comparaison directe, le jour en cours est inclus.
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
    jauge?: boolean;
    recurInfo?: { period: string; week: string; dayHours: string };
    batchCount?: number;
    multiCadence?: string;
  } => {
    const slot = slots.find((s) => s.id === slotId);
    const block = blocksByDay[dayKey]?.find((bl) => bl.slotId === slotId);
    const capacity = block?.capacity ?? slot?.capacity ?? service.capacity;
    // Taille du lot « multi » d'un créneau ponctuel (0 = pas un lot ; > 1 → affichée).
    // Affichée UNIQUEMENT en mode « Création multiple » (comme le reste de l'UI de lot) :
    // hors de ce mode, on ne mentionne pas « Lot : n créneaux » au survol.
    const batchCount =
      creationMode && createKind === "multi" ? countSlotSeries(slotId) || undefined : undefined;
    // Cadence du lot « multi » (portée de parité posée sur Slot.weeks) : « Semaine A »,
    // « Semaine B » ou « Toutes » — affichée « Multi - <cadence> » à la place du décompte.
    let multiCadence: string | undefined;
    if (batchCount) {
      const w = uniqueSlots.find((u) => u.id === slotId)?.weeks ?? "";
      multiCadence = w === "A" ? "Semaine A" : w === "B" ? "Semaine B" : "Toutes les semaines";
    }
    // État de la jauge DU créneau (slots.jauge) : bloc affiché, sinon récurrent,
    // sinon ponctuel/miroir.
    const jauge =
      block?.jauge ?? slot?.jauge ?? uniqueSlots.find((u) => u.id === slotId)?.jauge ?? false;
    // Résumé récurrent affiché dans l'info-bulle : période active + cadence (Semaine A/B
    // ou Toutes les semaines) + jour/heures du créneau PARENT (remplace la liste des dates
    // côté admin).
    let recurInfo: { period: string; week: string; dayHours: string } | undefined;
    if (slot) {
      const w = parseWeeks(slot.weeks);
      const cadence = abMode && w.length === 1 ? `Semaine ${w[0]}` : "Toutes les semaines";
      const dayName = DAY_NAMES[slot.slotDay ?? ""] ?? slot.slotDay ?? "";
      recurInfo = {
        period: periods.find((p) => p.id === effectivePeriodId)?.label ?? "",
        // `week` = cadence (affichée en gras, suivie de « : ») ; `dayHours` = jour · heures.
        week: cadence,
        dayHours: `${dayName} · ${slot.startTime}–${slot.endTime}`,
      };
    }
    if (!serviceDemandeurs.length) return { capacity, jauge, recurInfo, batchCount, multiCadence };
    const ids = slotDemandeurs[slotId] ?? [];
    const demandeurs = serviceDemandeurs.filter((d) => ids.includes(d.id)).map((d) => d.label);
    return { capacity, demandeurs, jauge, recurInfo, batchCount, multiCadence };
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
    lockedByPointage,
    actionBooking,
  };
  const blockApiRef = useRef(blockApi);
  blockApiRef.current = blockApi;

  // Créneau SOURCE d'un déplacement / redimensionnement en cours (estompé 0.35).
  // Dérivé STABLE des états de drag : il ne change qu'au début et à la fin du
  // geste (le slotId est constant pendant le drag), PAS à chaque mousemove —
  // c'est lui qui est mis dans les déps de renderBlock (et non moveDrag/resizeDrag
  // entiers, dont curMin/curDay changent à chaque pas) → renderBlock et
  // dayBlockEls gardent la même référence pendant tout le geste et React ne
  // réconcilie AUCUN des ~100 blocs au mousemove (le fantôme de prévisualisation
  // est rendu à part, hors des blocs mémoïsés). Couvre move + resize-V, les cas
  // laissés ouverts par la passe 051f820.
  const dragSourceSlotId = moveDrag?.slotId ?? resizeDrag?.slotId ?? null;

  // draggingId / copiedBooking mirrorés en refs (audit perf 2026-07-19) : les handlers
  // de drop/coller des cellules les lisent AU MOMENT de l'événement via ces refs → ils
  // restent frais SANS que ces états transitoires soient en déps de renderBlock (sinon
  // chaque start/end de glisser et chaque copier/couper re-rendait les ~100 blocs).
  // L'atténuation visuelle du badge glissé/coupé est posée en DOM direct (cf. data-bkid).
  const draggingIdRef = useRef(draggingId);
  draggingIdRef.current = draggingId;
  const copiedBookingRef = useRef(copiedBooking);
  copiedBookingRef.current = copiedBooking;

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
        lockedByPointage,
        actionBooking,
      } = blockApiRef.current;
      // Info-bulle de survol du créneau (capacité + demandeurs autorisés, et pour les
      // Créneau COMPLET (mode-aware) → pas de création possible. Jauge = enfants[+adultes] ;
      // sinon = nombre de réservations (1/résa).
      const isPonctuelCell = uniqueIdSet.has(b.slotId);
      // NB : un créneau récurrent affiché en Semaine réelle est désormais PLEINEMENT gérable
      // (créneau : édition en mode création ; réservations : créer/valider/déplacer/supprimer/
      // copier via la réservation parente) — plus aucun verrou « consultation » spécifique.
      // Le créneau porte-t-il une réservation ? (toutes semaines pour un récurrent) —
      // verrou d'édition structurelle (déplacer/redimension/suppression = créneaux vides).
      const slotBooked = isPonctuelCell
        ? b.bookings.length > 0
        : recurringSlotsWithBookings.has(b.slotId);
      // Parité d'un créneau récurrent limité à une seule semaine (A/B) → lettre au centre.
      const blockParity = isPonctuelCell ? undefined : slotParityById.get(b.slotId);
      // Portée de parité d'un créneau MULTI ponctuel (mode multi) : "A" | "B" | "" (toutes),
      // lue sur Slot.weeks (posée à la création). Distingue Multi A / Multi B / Multi (toutes).
      const multiWeeks =
        creationMode && createKind === "multi" && batchSlotIds.has(b.slotId)
          ? (uniqueSlots.find((u) => u.id === b.slotId)?.weeks ?? "")
          : "";
      // Créneau de 15 min : bloc trop court pour la lettre A/B à 1.2rem → on la réduit.
      const abFontSize = !allday && b.endMin - b.startMin <= 15 ? "0.8rem" : "1.2rem";
      // Libellé de cadence au centre d'un créneau RÉCURRENT : sa parité (A/B) si le service
      // alterne et que le créneau est mono-parité ; sinon « Toutes » (toutes semaines).
      const blockCadence = isPonctuelCell
        ? undefined
        : (blockParity ?? (modes.abMode ? "Toutes" : undefined));
      // b.used est déjà compté selon la jauge DU créneau (cf. construction des blocs).
      const gaugeForCell = b.jauge;
      const cellFull = b.used >= b.capacity;
      // Le créneau est cliquable pour créer une réservation (hors mode création). Récurrent
      // en Semaine réelle INCLUS : la réservation récurrente se pose sur la période
      // couvrante + parité de la semaine affichée (cf. submitCreate).
      const cellCreatable =
        !creationMode &&
        !cellFull &&
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
            ...(creationMode && !slotBooked && !allday
              ? { cursor: "move" }
              : cellCreatable
                ? { cursor: "pointer" }
                : {}),
            ...(dragSourceSlotId === b.slotId ? { opacity: 0.35 } : {}),
          }}
          onMouseDown={(e) => onMoveSlotMouseDown(e, b)}
          // Clic droit sur la zone vide d'un créneau → menu « Coller » (si presse-papier actif).
          // Récurrent en Semaine réelle inclus (coller y crée une réservation récurrente).
          onContextMenu={(e) => {
            if (creationMode) return;
            e.preventDefault();
            clearTip(); // ferme l'info-bulle
            if (!copiedBookingRef.current) return;
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
              // Configure le créneau (récurrent inclus en Semaine réelle : édite le parent).
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
            const dg = draggingIdRef.current;
            if (dg == null) return;
            const dragged = bookings.find((bk) => bk.id === dg);
            if (!dragged) return;
            // Cible valide = MÊME type que la source (récurrent↔récurrent ou
            // ponctuel↔ponctuel). Récurrent en Semaine réelle inclus (déplace la parente).
            if (uniqueIdSet.has(dragged.slotId) === isPonctuelCell) e.preventDefault();
          }}
          onDrop={(e) => {
            // Le créneau est la cible de drop : déplace la résa glissée ici.
            e.preventDefault();
            e.stopPropagation();
            const id = draggingIdRef.current;
            if (id == null) return;
            const dragged = bookings.find((bk) => bk.id === id);
            setDraggingId(null);
            if (!dragged) return;
            // Refus : changement de type (récurrent↔ponctuel).
            if (uniqueIdSet.has(dragged.slotId) !== isPonctuelCell) return;
            // Récurrent en Semaine réelle : on déplace la réservation PARENTE (toute la
            // récurrente), pas l'occurrence glissée.
            runResult(moveBookingAction(actionBooking(dragged).id, service.id, b.slotId));
          }}
        >
          {/* Créneau récurrent : cadence au centre — parité A/B (mono-parité) ou « Toutes »
              (toutes semaines) — dans la couleur du contour pointillé (jaune récurrent).
              Décorative (derrière les badges), n'intercepte pas les clics. */}
          {blockCadence && (
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#ffdc00",
                fontWeight: 800,
                // « Toutes » (multi-lettres) plus petit que la lettre A/B pour tenir.
                fontSize: blockCadence.length > 1 ? "1rem" : abFontSize,
                overflow: "hidden",
                whiteSpace: "nowrap",
                pointerEvents: "none",
                zIndex: 0,
              }}
            >
              {blockCadence}
            </span>
          )}
          {/* Repère « Multi » (coin haut-gauche) : créneau appartenant à un lot (batchId),
              affiché en mode création multi. Couleur du contour pointillé gris-bleu du
              ponctuel (--slot-uniq-color), sans fond. Décoratif (pointerEvents none). */}
          {creationMode && createKind === "multi" && batchSlotIds.has(b.slotId) && (
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                top: 1,
                left: 3,
                fontSize: "0.7rem",
                fontWeight: 700,
                lineHeight: 1,
                color: "var(--slot-uniq-color)",
                pointerEvents: "none",
                zIndex: 1,
              }}
            >
              Multi
            </span>
          )}
          {/* Multi ponctuel : lettre A/B au centre = PORTÉE du lot (Slot.weeks) → Multi A ou
              Multi B ; rien pour « Multi (toutes) » (weeks ""). Gris-bleu du ponctuel.
              Décorative (derrière les badges), n'intercepte pas les clics. */}
          {(multiWeeks === "A" || multiWeeks === "B") && (
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--slot-uniq-color)",
                fontWeight: 800,
                fontSize: abFontSize,
                pointerEvents: "none",
                zIndex: 0,
              }}
            >
              {multiWeeks}
            </span>
          )}
          {/* Mode création : poignées de bord (haut/bas) pour redimensionner un créneau
          vide. Curseur ns-resize au survol ; le mousedown amorce le glisser-étirer
          (stopPropagation → n'amorce ni déplacer ni créer). Récurrent en Semaine réelle
          inclus (édite le parent) tant qu'il est vide — cf. slotBooked. */}
          {creationMode && !slotBooked && !allday && (
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
              Récurrent en Semaine réelle : suppression EN TOTALITÉ (toutes occurrences) via
              cette croix, uniquement s'il ne porte aucune réservation (toutes semaines,
              slotBooked). */}
            {creationMode && !slotBooked && (
              <button
                type="button"
                className="planning-name-tag-close"
                data-tip="Supprimer ce créneau"
                // Créneau de 15 min : bloc trop court, la croix (top:1px) chevauche la
                // poignée de redimensionnement basse → on la remonte pour la rendre cliquable.
                style={!allday && b.endMin - b.startMin <= 15 ? { top: -5 } : undefined}
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
                const quickActive = pendingValidation || pointageMode;
                // Legacy : ligne1 = structure sinon catégorie (demandeur),
                // ligne2 = NOM Prénom, ligne3 = thème (si présent).
                const primaryLabel = bk.structure || bk.demandeur;
                const accentColor = bk.validated ? "var(--accent)" : "rgba(232, 164, 90, .95)";
                // Verrou pointage des actions de GESTION (déplacer/supprimer/valider) :
                // évalué sur la réservation cible (la parente pour une occurrence récurrente),
                // qui inclut « une occurrence pointée » (parentsWithPointedChild).
                const locked = lockedByPointage(actionBooking(bk));
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: badge (clic = valider/pointer/éditer)
                  <div
                    key={bk.id}
                    // data-bkid : cible de l'atténuation « en cours de glisser / couper »,
                    // posée en DOM DIRECT (cf. effet dimBadges) — l'ancien calcul d'opacité
                    // dans le rendu mettait draggingId/copiedBooking en déps de renderBlock →
                    // un glisser (start/end) ou un copier/couper re-rendait les ~100 blocs
                    // (audit perf 2026-07-19).
                    data-bkid={bk.id}
                    className={`planning-name-tag ${bk.validated ? "is-validated" : "is-pending"}${locked ? " is-locked" : ""}`}
                    // Déplaçable (récurrent en Semaine réelle inclus : déplace la parente).
                    draggable={!locked}
                    style={{
                      ...badgeStyle(bk.validated),
                      position: "relative",
                      cursor: quickActive ? "pointer" : locked ? "default" : "grab",
                      // L'ombre portée (box-shadow 2px 2px 4px) déborde sous le badge sans
                      // occuper de hauteur en flux : on réserve l'extent de l'ombre (offset 2
                      // + blur 4 = 6px) afin que le centrage vertical (justify-content du
                      // créneau) tienne compte de l'ombre, plutôt que de centrer la seule boîte.
                      marginBottom: 6,
                    }}
                    data-tip={badgeTitle(bk)}
                    // Clic droit → menu « Copier » (récurrent en Semaine réelle inclus :
                    // copie/coupe la réservation récurrente, résolue à la parente au collage).
                    onContextMenu={(e) => {
                      // Verrouillée (pointée / occurrence pointée) → pas de copier/couper.
                      if (creationMode || locked) return;
                      e.preventDefault();
                      e.stopPropagation();
                      clearTip();
                      setCtxMenu({ x: e.clientX, y: e.clientY, kind: "booking", booking: bk });
                    }}
                    onDragStart={
                      locked
                        ? undefined
                        : (e) => {
                            e.stopPropagation();
                            setDraggingId(bk.id);
                          }
                    }
                    onDragEnd={locked ? undefined : () => setDraggingId(null)}
                    onClick={(e) => {
                      // Le badge porte les actions sur la réservation (cf. legacy).
                      // Validation/pointage ON = clic rapide (valider = parente, pointer =
                      // occurrence) ; sinon = modale d'édition/consultation.
                      e.stopPropagation();
                      if (onBlockQuickAction(bk)) return;
                      setDetail({ booking: bk });
                    }}
                  >
                    {/* Croix de suppression (survol) — masquée si la résa est verrouillée
                      (pointée / occurrence pointée). Récurrent en Semaine réelle : supprime
                      la réservation récurrente (toutes occurrences) via la parente. */}
                    {!locked && (
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
                          setDeleteTarget(actionBooking(bk));
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
          {/* Jauge DE CE CRÉNEAU (slots.jauge, source unique) ON → barre
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
      modes,
      creationMode,
      effectivePeriodId,
      mapMinToY,
      gridStartMin,
      gridEndMin,
      dragSourceSlotId,
      bookings,
      uniqueSlots,
      service,
      validation,
      pointageMode,
      recurringSlotsWithBookings,
      slotParityById,
      createKind,
      batchSlotIds,
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

  // Atténuation « en cours de glisser / couper » posée en DOM DIRECT (cf. data-bkid) :
  // la réservation glissée (HTML5, transitoire) ou coupée (jusqu'au collage) passe à
  // opacity .4 sans que draggingId/copiedBooking soient en déps de renderBlock — sinon
  // chaque start/end de glisser et chaque copier/couper re-rendait les ~100 blocs.
  // Réappliqué après un re-rendu légitime des blocs (dayBlockEls en dép) — un refresh
  // de données recrée les badges à opacity 1, l'effet ré-atténue celui qui l'est.
  const dimmedBadgeElsRef = useRef<HTMLElement[]>([]);
  useEffect(() => {
    // Lecture réelle de dayBlockEls : le nombre de colonnes rendues n'a pas d'effet, mais
    // le référencer relie l'effet au re-rendu des blocs (un refresh de données pendant une
    // « coupe » recrée les badges à opacity 1 → il faut ré-atténuer le badge coupé). Le
    // glisser HTML5, lui, suspend l'auto-refresh (cf. condition draggingId).
    void dayBlockEls.timed.size;
    for (const el of dimmedBadgeElsRef.current) el.style.opacity = "1";
    dimmedBadgeElsRef.current = [];
    const ids = new Set<number>();
    if (draggingId != null) ids.add(draggingId);
    if (copiedBooking?.mode === "cut") ids.add(copiedBooking.id);
    for (const id of ids) {
      // bk.id est unique par badge (occurrence datée) → un seul élément par id.
      const el = document.querySelector<HTMLElement>(`.planning-name-tag[data-bkid="${id}"]`);
      if (el) {
        el.style.opacity = "0.4";
        dimmedBadgeElsRef.current.push(el);
      }
    }
  }, [draggingId, copiedBooking, dayBlockEls]);

  return (
    // Info-bulle déléguée : un seul handler lit data-tip / data-slot-tip au survol.
    // Pendant un glisser (créer / déplacer / redimensionner), on la supprime : elle n'a
    // pas de sens en plein geste et masquerait le compteur de portée du lot.
    <div
      id="tab-content-agenda"
      onMouseMove={(e) => {
        if (createDrag || moveDrag || resizeDrag) {
          clearTip();
          return;
        }
        onAgendaTip(e);
      }}
      onMouseLeave={clearTip}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          marginBottom: ".4rem",
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
        {/* Navigation semaine : centrée sur la même ligne que le titre et le sélecteur.
            gap resserré : flèches ◀ ▶ au plus près du libellé (largeur figée). */}
        <div className="periode-nav" style={{ margin: "0 auto", gap: ".1rem" }}>
          <button
            type="button"
            className="ex-arrow"
            disabled={!canWeekPrev}
            onClick={() => canWeekPrev && shiftWeek(-1)}
          >
            ◀
          </button>
          <span
            className="ex-nav-label"
            // Largeur FIGÉE (calibrée sur la semaine la plus longue, texte centré) :
            // les flèches ◀ ▶ ne bougent plus d'une semaine à l'autre. Police inchangée.
            style={{ width: "8rem", textAlign: "center" }}
          >
            {mondayStr
              ? `${shortDateFmt.format(addDays(mondayStr, firstDayOffset))} → ${shortDateFmt.format(addDays(mondayStr, lastDayOffset))}`
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
                // Retour à la semaine courante : on verrouille sur la période
                // qui couvre AUJOURD'HUI (et non celle du lundi de la semaine,
                // qui diffère quand la semaine chevauche deux périodes — sinon
                // on afficherait la période du mois précédent).
                setRwPeriodId(periodCoveringDate(todayYmd)?.id ?? null);
                setAnchorMonday(ymd(mondayOf(new Date())));
              }}
            >
              Aujourd&apos;hui
            </button>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
          {/* Hors création : cases à cocher (masquer horaires / validation / pointage),
              à gauche du bouton Imprimer. */}
          {!creationMode && (
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
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  alignSelf: "stretch",
                  justifyContent: "space-between",
                }}
              >
                <label className="planning-option">
                  Mode validation
                  <input
                    type="checkbox"
                    checked={validation}
                    onChange={(e) => toggleValidation(e.target.checked)}
                  />
                </label>
                <label className="planning-option">
                  Mode pointage
                  <input
                    type="checkbox"
                    checked={pointageMode}
                    onChange={(e) => togglePointageMode(e.target.checked)}
                  />
                </label>
              </div>
            </div>
          )}
          {/* Hors création : bouton Imprimer, à gauche du bouton « Mode création ». */}
          {!creationMode && (
            <PrintIconButton onClick={printSessionsList} tip="Imprimer la liste des réservations" />
          )}
          {/* Capacité / jauge / demandeurs par défaut des créneaux créés (mode création). */}
          {creationMode && (
            <>
              <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                <input
                  id="create-cap"
                  type="number"
                  min={1}
                  data-tip="Capacité par défaut"
                  aria-label="Capacité par défaut"
                  value={capStr}
                  onChange={(e) => onCapChange(e.target.value)}
                  style={{
                    width: 38,
                    fontSize: ".62rem",
                    padding: ".12rem .1rem",
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
              {/* Bascule « mode Jauge » (capsule vert/orange/rouge). OFF par défaut : grisée ;
                  ON : en couleur. Les créneaux créés portent jauge = ce mode. */}
              <button
                type="button"
                onClick={() => setJaugeMode((v) => !v)}
                data-tip="Jauge"
                aria-label="Jauge"
                aria-pressed={jaugeMode}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  ...(jaugeMode ? {} : { filter: "grayscale(1)", opacity: 0.55 }),
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="13"
                  height="26"
                  viewBox="6 0 12 24"
                  aria-hidden="true"
                >
                  {/* Capsule extérieure : intérieur BLANC (pourtour interne et liserés
                    entre segments), contour externe var(--border). Puis 3 segments
                    (thème : accent/warn/danger) arrondis par le clip interne. */}
                  <rect
                    x="6.5"
                    y="1"
                    width="11"
                    height="22"
                    rx="5.5"
                    fill="#fff"
                    stroke="var(--border)"
                    strokeWidth="1.4"
                  />
                  <clipPath id="tricolor-pill-clip">
                    <rect x="9" y="3.4" width="6" height="17.2" rx="3" />
                  </clipPath>
                  <g clipPath="url(#tricolor-pill-clip)">
                    <rect x="9" y="3.4" width="6" height="5.4" fill="var(--accent)" />
                    <rect x="9" y="9.3" width="6" height="5.4" fill="var(--warn)" />
                    <rect x="9" y="15.2" width="6" height="5.4" fill="var(--danger)" />
                  </g>
                </svg>
              </button>
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
            </>
          )}
          {/* Bouton « Mode création » (bascule), à droite du sélecteur de type. */}
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
          {visiblePeriods.map((p) => {
            const active = p.id === coveringPeriod?.id;
            return (
              <button
                key={p.id}
                type="button"
                className={`period-btn ${active ? "active" : ""}`}
                style={{ "--period-color": p.color } as React.CSSProperties}
                onClick={() => {
                  // Onglet choisi = source de vérité : on fige la période ET on ancre la
                  // semaine sur son début (cf. legacy _pickedP).
                  if (p.dateStart) {
                    setRwPeriodId(p.id);
                    setAnchorMonday(ymd(mondayOf(new Date(`${p.dateStart}T00:00:00`))));
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
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          {/* En mode création : champ « Capacité » + 👥 (+ Copier A/B). Les cases à cocher
              (masquer horaires / validation / pointage) sont dans l'en-tête. */}
          {creationMode && (
            <div style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
              {/* Sélecteur du type de créneau à créer : récurrent / ponctuel unique /
                  ponctuel répliqué. L'état "rec" n'est proposé qu'avec un mode récurrent. */}
              <div style={{ display: "inline-flex", alignItems: "center" }}>
                {CREATE_KINDS.filter((k) => k.kind !== "rec" || modes.recurringMode).map((k) => {
                  const active = createKind === k.kind;
                  return (
                    <button
                      key={k.kind}
                      type="button"
                      data-tip={k.tip}
                      aria-label={k.label}
                      aria-pressed={active}
                      onClick={() => setCreateKind(k.kind)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        padding: ".1rem .3rem",
                        cursor: "pointer",
                        border: "1px solid",
                        borderColor: active ? "var(--accent)" : "transparent",
                        borderRadius: "calc(var(--rad-sm) - 2px)",
                        background: active
                          ? "color-mix(in srgb, var(--accent) 15%, transparent)"
                          : "transparent",
                        opacity: active ? 1 : 0.5,
                      }}
                    >
                      {/* Multi → « Multi » dans la pastille, dans la couleur de la bordure
                          pointillée du créneau ponctuel (--legend-color = --slot-uniq-color
                          pour is-uniq). Récurrent + Semaine A/B activé → la parité (A/B) en
                          jaune #ffdc00 (couleur de la bordure récurrente). */}
                      <span
                        className={`agenda-legend-swatch ${k.swatch}`}
                        style={{
                          width: 30,
                          height: 20,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: ".5rem",
                          fontWeight: 700,
                          color: "var(--text)",
                        }}
                      >
                        {k.multi && (
                          <span style={{ color: "var(--legend-color)" }}>
                            {parityScoped && realWeekParity ? `Multi ${realWeekParity}` : "Multi"}
                          </span>
                        )}
                        {k.kind === "rec" && parityScoped && realWeekParity && (
                          <span style={{ color: "#ffdc00", fontSize: ".6rem" }}>
                            {realWeekParity}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
              {/* Bouton « Semaine A/B » (service A/B) : le libellé = parité de la semaine
                  affichée. Désactivé (estompé) → récurrents créés pour toutes les semaines ;
                  activé → limités à la parité affichée. */}
              {abMode && realWeekParity && (
                <button
                  type="button"
                  aria-label={`Limiter les créneaux récurrents à la semaine ${realWeekParity}`}
                  aria-pressed={parityScoped}
                  onClick={() => setParityScoped((v) => !v)}
                  data-tip={
                    parityScoped
                      ? `Créneaux récurrents créés en semaine ${realWeekParity} uniquement (cliquer pour toutes les semaines)`
                      : "Créneaux récurrents créés pour toutes les semaines (cliquer pour limiter à la semaine affichée)"
                  }
                  style={{
                    boxSizing: "border-box",
                    padding: ".32rem .35rem",
                    border: `1px solid ${parityScoped ? "var(--accent)" : "var(--border)"}`,
                    borderRadius: "var(--rad-sm)",
                    background: parityScoped ? "var(--accent-dim)" : "none",
                    color: parityScoped ? "var(--accent)" : "var(--muted)",
                    fontSize: ".62rem",
                    fontWeight: 600,
                    lineHeight: 1,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    whiteSpace: "nowrap",
                    // OFF = aspect désactivé (estompé), comme le sélecteur 3 états inactif.
                    opacity: parityScoped ? 1 : 0.5,
                  }}
                >
                  Semaine {realWeekParity}
                </button>
              )}
              {/* Copie des créneaux d'une semaine A/B vers l'autre (service A/B) : grisé/
                  désactivé tant que le mode Semaine A/B n'est pas activé. */}
              {abMode &&
                effectiveWeek != null &&
                effectivePeriodId != null &&
                effectivePeriodId > 0 && (
                  <button
                    type="button"
                    onClick={copyWeek}
                    disabled={!parityScoped}
                    data-tip={
                      parityScoped
                        ? `Copier les créneaux de la semaine ${effectiveWeek} vers la semaine ${effectiveWeek === "A" ? "B" : "A"}`
                        : "Activez le mode « Semaine A/B » pour copier une parité vers l'autre"
                    }
                    style={{
                      boxSizing: "border-box",
                      padding: ".32rem .35rem",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--rad-sm)",
                      background: "none",
                      // Désactivé = même aspect que « Semaine A/B » OFF (grisé, estompé).
                      color: parityScoped ? "var(--text)" : "var(--muted)",
                      fontSize: ".62rem",
                      fontWeight: 600,
                      lineHeight: 1,
                      cursor: parityScoped ? "pointer" : "default",
                      display: "flex",
                      alignItems: "center",
                      whiteSpace: "nowrap",
                      opacity: parityScoped ? 1 : 0.5,
                    }}
                  >
                    Copier → {effectiveWeek === "A" ? "B" : "A"}
                  </button>
                )}
            </div>
          )}
        </div>
      </div>

      <div className="planning-wrap">
        {/* Aucune colonne de jour (semaine hors période) : le squelette de grille n'a aucun
            sens (colonne horaire orpheline) — on affiche un état vide explicite à la place. */}
        {days.length === 0 ? (
          <AgendaEmptyWeekNotice>
            Aucune période ne couvre cette semaine — utilisez les flèches ou les raccourcis de
            période pour rejoindre une semaine couverte.
          </AgendaEmptyWeekNotice>
        ) : (
          <div
            className="agenda-grid is-realweek"
            style={{ gridTemplateColumns: `44px repeat(${days.length}, minmax(0, 1fr))` }}
          >
            <AgendaWeekHeader
              days={days}
              abMode={abMode}
              effectiveWeek={effectiveWeek}
              realweek={true}
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
                  // Couleur de l'aperçu = celle du créneau créé : jaune récurrent (#ffdc00,
                  // cf. .agenda-block) / gris-bleu ponctuel (--slot-uniq-color, .is-uniq).
                  const drawColor = createKind === "rec" ? "#ffdc00" : "var(--slot-uniq-color)";
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
                  const slot = slotAtClientY(
                    e.currentTarget.getBoundingClientRect().top,
                    e.clientY,
                  );
                  const id = draggingId;
                  setDraggingId(null);
                  const dragged = bookings.find((bk) => bk.id === id);
                  // Récurrent en Semaine réelle : on déplace la réservation PARENTE (le
                  // serveur refuse un changement de type récurrent↔ponctuel).
                  if (slot && dragged)
                    runResult(moveBookingAction(actionBooking(dragged).id, service.id, slot.id));
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
                    // Couleur de l'aperçu = celle du créneau créé : jaune récurrent (#ffdc00,
                    // cf. .agenda-block) / gris-bleu ponctuel (--slot-uniq-color, .is-uniq).
                    const drawColor = createKind === "rec" ? "#ffdc00" : "var(--slot-uniq-color)";
                    return renderDragPreviewSegments({
                      startMin: s,
                      endMin: e2,
                      color: drawColor,
                      dashed: true,
                      bgPct: 22,
                      zIndex: 3,
                      className: "agenda-create-preview",
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
                    const moveColor = moveDrag.isUnique ? "var(--slot-uniq-color)" : "#ffdc00";
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
                {/* Aperçu du créneau en cours de redimensionnement (glisser-étirer) :
                    DÉCOUPÉ en 2 au passage de la pause, comme la création (code mutualisé). */}
                {resizeDrag &&
                  resizeDrag.dayKey === d &&
                  (() => {
                    const rColor = resizeDrag.isUnique ? "var(--slot-uniq-color)" : "#ffdc00";
                    return renderDragPreviewSegments({
                      startMin: resizeDrag.curStart,
                      endMin: resizeDrag.curEnd,
                      color: rColor,
                      dashed: false,
                      bgPct: 28,
                      zIndex: 4,
                      className: "agenda-resize-preview",
                    });
                  })()}
                {/* Aperçu des créneaux générés en étendant latéralement (un par colonne
                  couverte, hormis la source). Pointillé = à créer, comme le glisser-créer. */}
                {hResizeDrag &&
                  hResizeDrag.fromDay !== d &&
                  daysSpan(hResizeDrag.fromDay, hResizeDrag.curDay).includes(d) &&
                  (() => {
                    const top = mapMinToY(hResizeDrag.startMin);
                    const h = mapMinToY(hResizeDrag.endMin) - top;
                    const rColor = hResizeDrag.isUnique ? "var(--slot-uniq-color)" : "#ffdc00";
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
        )}
      </div>

      {/* Sous le tableau : astuce à gauche, légende complète à droite (reprise du
          legacy #agenda-legend-realweek). La légende n'a de sens qu'en « Semaine
          réelle » (pointage P/A + créneaux ponctuels datés) — et rien de tout ça
          n'a d'objet quand la grille est vide (état vide ci-dessus). */}
      {days.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1rem",
            flexWrap: "wrap",
            marginTop: ".1rem",
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
        </div>
      )}

      {stackKey && stackBlock && (
        <BookingStackModal
          stackKey={stackKey}
          block={stackBlock}
          slot={stackSlot}
          isPonctuel={uniqueIdSet.has(stackKey.slotId)}
          ponctuelDate={uniqueSlots.find((s) => s.id === stackKey.slotId)?.slotDate}
          periodLabel={periods.find((p) => p.id === effectivePeriodId)?.label ?? ""}
          validation={validation}
          pointageMode={pointageMode}
          creationMode={creationMode}
          // Créables : pas complet, période active pour un récurrent (mêmes conditions
          // que cellCreatable — récurrent en Semaine réelle inclus).
          creatable={
            stackBlock.used < stackBlock.capacity &&
            (uniqueIdSet.has(stackKey.slotId) ||
              (effectivePeriodId != null && effectivePeriodId > 0))
          }
          themeMode={modes.themeMode}
          gaugeAccompagnants={service.gaugeAccompagnants}
          draggingId={draggingId}
          copiedBooking={copiedBooking}
          // Verrou de gestion résolu sur la parente (occurrence récurrente → réservation
          // récurrente), comme dans la grille.
          lockedByPointage={(bk) => lockedByPointage(actionBooking(bk))}
          onToggleValidation={toggleValidation}
          onTogglePointage={togglePointageMode}
          onCreateClick={() => {
            clearTip();
            // La pile reste ouverte derrière : fermer la création y ramène
            // (même patron que la modale détail).
            openCreate(
              stackKey.dayKey,
              stackKey.slotId,
              uniqueIdSet.has(stackKey.slotId),
              uniqueSlots.find((s) => s.id === stackKey.slotId)?.slotDate,
            );
          }}
          onQuickAction={onBlockQuickAction}
          onOpenDetail={(bk) => setDetail({ booking: bk })}
          // Récurrent en Semaine réelle : supprime la réservation récurrente (via la parente).
          onDelete={(bk) => setDeleteTarget(actionBooking(bk))}
          onContextMenu={(bk, x, y) => {
            clearTip();
            setCtxMenu({ x, y, kind: "booking", booking: bk });
          }}
          onDragStartBooking={(bk) => {
            // On amorce le drag, PUIS on ferme la pile au tick suivant pour libérer
            // la grille comme cible de dépôt (port legacy _onDragStartFromStackModal).
            setDraggingId(bk.id);
            setTimeout(() => setStackKey(null), 0);
          }}
          onDragEndBooking={() => setDraggingId(null)}
          onClose={() => setStackKey(null)}
        />
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
          // Lecture seule si la fiche pointe une réservation récurrente PARENTE (les actions
          // de gestion passent par les occurrences), ou si elle est verrouillée par un
          // pointage (pointée / parent à miroir pointé) → ni suppression, ni validation.
          const readOnly = !!recurSlot || lockedByPointage(bk);
          // Récurrent : la fiche peut porter la PARENTE (vue Modèle) ou une occurrence
          // miroir (vue Semaine réelle) — dans les deux cas l'édition cible la parente,
          // qui propage aux occurrences.
          const parentBk = actionBooking(bk);
          const isRecurring = !!recurSlot || bk.parentBookingId != null;
          // Participants / thème : modifiables tant que la réservation n'est pas validée
          // (récurrent), sinon comme avant (tout sauf verrou pointage).
          const canEdit = isRecurring
            ? !parentBk.validated && !lockedByPointage(parentBk)
            : !readOnly;
          const editBookingId = isRecurring ? parentBk.id : bk.id;
          const notice = !isRecurring
            ? null
            : canEdit
              ? "Réservation récurrente — les participants et le thème s'appliquent à toutes les occurrences."
              : parentBk.validated
                ? "Réservation récurrente validée — dévalidez-la pour modifier les participants."
                : "Consultation — réservation récurrente.";
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
              canEdit={canEdit}
              editBookingId={editBookingId}
              notice={notice}
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
          // Période du créneau : récurrent → periodId du slot ; ponctuel → période
          // couvrant la date (affichée en pastille dans le titre de la modale).
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
          return (
            <BookingCreateModal
              ctx={{ ...createCtx, ponctuel: createCtx.ponctuel ?? false }}
              createSlot={createSlot}
              period={createPeriod}
              users={users}
              serviceDemandeurs={serviceDemandeurs}
              themeMode={modes.themeMode}
              themesListMode={service.themesMode === "liste"}
              themes={themes}
              // « Créneaux concernés » = occurrences qui seront EFFECTIVEMENT créées :
              // miroirs du slot ≥ aujourd'hui (le gestionnaire ne crée pas le passé),
              // de la semaine A/B effective (en mode A/B), et hors vacances scolaires
              // si l'EXERCICE de la date ferme les vacances ou si le demandeur
              // sélectionné est fermé.
              occurrenceDatesFor={(selUser) => {
                const todayISO = ymd(new Date());
                return uniqueSlots
                  .filter((u) => u.parentSlotId === createCtx.slotId && u.slotDate)
                  .map((u) => u.slotDate as string)
                  .filter((d) => {
                    if (d < todayISO) return false;
                    const closedOnSchool =
                      !openingForYmd(d).openOnSchoolHolidays ||
                      selUser?.openOnSchoolHolidays === false;
                    if (closedOnSchool && inSchoolHolidayRange(d, schoolHolidays)) return false;
                    if (!abMode || effectiveWeek == null) return true;
                    return slotWeekTag(d) === effectiveWeek;
                  })
                  .sort();
              }}
              onSubmit={submitCreate}
              onClose={() => setCreateCtx(null)}
            />
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
          // Créneau récurrent (dans `slots`) OU ponctuel (dans `uniqueSlots`) — recherchés
          // séparément pour préserver leur type (slotDay vs slotDate).
          const recurSlot = slots.find((s) => s.id === capModal.slotId);
          const uniqSlot = uniqueSlots.find((s) => s.id === capModal.slotId);
          const slot = recurSlot ?? uniqSlot ?? null;
          const timePart = slot ? `${slot.startTime}–${slot.endTime}` : "";
          // Titre complet du créneau seul :
          //  • récurrent → « Créneau récurrent · <cadence> · <Jour> · <h–h> »
          //  • ponctuel  → « Créneau ponctuel · <Jour> <JJ/MM/AAAA> · <h–h> »
          let heading = "Configuration du créneau";
          if (recurSlot) {
            const w = parseWeeks(recurSlot.weeks);
            const cadence = abMode && w.length === 1 ? `Semaine ${w[0]}` : "Toutes les semaines";
            const dayName = DAY_NAMES[recurSlot.slotDay ?? ""] ?? "";
            heading = ["Créneau récurrent", cadence, dayName, timePart].filter(Boolean).join(" · ");
          } else if (uniqSlot) {
            const sd = uniqSlot.slotDate ?? "";
            const dayName = sd ? (DAY_NAMES[dayKeyFromYmd(sd)] ?? "") : "";
            const dateStr = sd ? new Date(`${sd}T12:00:00`).toLocaleDateString("fr-FR") : "";
            const dayDate = [dayName, dateStr].filter(Boolean).join(" ");
            heading = ["Créneau ponctuel", dayDate, timePart].filter(Boolean).join(" · ");
          }
          return (
            <SlotConfigModal
              key={capModal.slotId}
              serviceId={service.id}
              slotId={capModal.slotId}
              title={slot ? ` · ${timePart}` : ""}
              heading={heading}
              batchCount={countSlotSeries(capModal.slotId)}
              // Le SCOPE suit le mode courant : « Création multiple » → tout le lot ;
              // ponctuel/récurrent → le seul créneau (même s'il appartient à un lot).
              applyToLot={createKind === "multi"}
              initialCapacity={String(slot?.capacity ?? service.capacity)}
              initialJauge={slot?.jauge ?? false}
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

      {/* Confirmation de suppression d'un créneau (mode création). Créneau ponctuel
          « Multi » : un ponctuel avec des jumeaux sur la période propose aussi la
          suppression de toute la série. */}
      {slotDeleteTarget &&
        (() => {
          // Récurrent = créneau présent dans `slots` (les ponctuels sont dans uniqueSlots).
          const isRecurring = slots.some((s) => s.id === slotDeleteTarget);
          const slot =
            slots.find((s) => s.id === slotDeleteTarget) ??
            uniqueSlots.find((s) => s.id === slotDeleteTarget) ??
            null;
          const timePart = slot ? `${slot.startTime}–${slot.endTime}` : "";
          // Choix « ce créneau / toute la série » dès que le créneau appartient à un lot
          // (batchId) — indépendant du sélecteur de type courant.
          const seriesCount = countSlotSeries(slotDeleteTarget);
          return (
            <SlotDeleteModal
              timePart={timePart}
              recurring={isRecurring}
              seriesCount={seriesCount > 1 ? seriesCount : undefined}
              onCancel={() => setSlotDeleteTarget(null)}
              onConfirm={confirmDeleteSlot}
              onConfirmSeries={seriesCount > 1 ? confirmDeleteSlotSeries : undefined}
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

      {/* Compteur de portée pendant un glisser de LOT (« valeur · N créneaux »), au curseur. */}
      {dragInfo &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: dragInfo.x + 14,
              top: dragInfo.y + 14,
              zIndex: 60,
              pointerEvents: "none",
              background: "var(--text)",
              color: "var(--surface)",
              fontSize: ".72rem",
              fontWeight: 600,
              padding: "3px 8px",
              borderRadius: "var(--rad-sm)",
              whiteSpace: "nowrap",
              boxShadow: "0 2px 8px rgba(0,0,0,.25)",
            }}
          >
            {dragInfo.text}
          </div>,
          document.body,
        )}

      {/* Bandeau de bilan d'une édition de LOT + Annuler (le seul filet contre une modif
          de masse sur des semaines qu'on ne voit pas). */}
      {batchEdit &&
        createPortal(
          // Survol/focus → le minuteur d'auto-fermeture se suspend (batchPaused) : le
          // bandeau ne s'évapore jamais pendant qu'on le lit ou qu'on vise « Annuler ».
          <div
            onMouseEnter={() => setBatchPaused(true)}
            onMouseLeave={() => setBatchPaused(false)}
            onFocusCapture={() => setBatchPaused(true)}
            onBlurCapture={() => setBatchPaused(false)}
            style={{
              position: "fixed",
              left: "50%",
              bottom: 24,
              transform: "translateX(-50%)",
              zIndex: 60,
              display: "flex",
              alignItems: "center",
              gap: ".75rem",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--rad)",
              padding: ".5rem .75rem",
              boxShadow: "0 4px 16px rgba(0,0,0,.2)",
              fontSize: ".8rem",
              overflow: "hidden",
            }}
          >
            <span>
              {batchEdit.updated.length} créneau{batchEdit.updated.length > 1 ? "x" : ""} modifié
              {batchEdit.updated.length > 1 ? "s" : ""}
              {batchEdit.skipped > 0
                ? ` (${batchEdit.skipped} ignoré${batchEdit.skipped > 1 ? "s" : ""} — réservé${
                    batchEdit.skipped > 1 ? "s" : ""
                  })`
                : ""}
            </span>
            {batchEdit.updated.length > 0 && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: ".2rem .5rem" }}
                onClick={undoBatchEdit}
              >
                Annuler
              </button>
            )}
            <button
              type="button"
              aria-label="Fermer"
              onClick={() => setBatchEdit(null)}
              style={{
                border: "none",
                background: "none",
                cursor: "pointer",
                color: "var(--muted)",
                fontSize: "1rem",
                lineHeight: 1,
              }}
            >
              ×
            </button>
            {/* Barre de progression : se vide sur BATCH_DISMISS_MS en animation CSS pure
                (keyframes batch-dismiss, transform compositor — zéro re-render), figée
                pendant la pause via play-state. key=batchSeq → repart de 100 % par lot. */}
            <div
              key={batchSeq}
              aria-hidden="true"
              style={{
                position: "absolute",
                left: 0,
                bottom: 0,
                height: 2,
                width: "100%",
                background: "var(--accent)",
                opacity: 0.6,
                pointerEvents: "none",
                transformOrigin: "left",
                animation: `batch-dismiss ${BATCH_DISMISS_MS}ms linear forwards`,
                animationPlayState: batchPaused ? "paused" : "running",
              }}
            />
          </div>,
          document.body,
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
                    // Récurrent en Semaine réelle : supprime la réservation récurrente (parente).
                    setDeleteTarget(actionBooking(ctxMenu.booking));
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
