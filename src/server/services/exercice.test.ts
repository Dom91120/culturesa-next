import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseYmdUtc } from "@/lib/date-utc";
import { DEFAULT_OPENING } from "@/server/services/opening";

// `vi.hoisted` : les factories de vi.mock sont remontées en tête de module, les doubles
// qu'elles référencent doivent l'être aussi. `db` est un objet MUTABLE : chaque test y
// installe les modèles dont il a besoin (cf. installDb) ; `$transaction` exécute le
// callback avec ce même objet en guise de `tx` — tout accès imprévu explose (undefined
// is not a function), ce qui est voulu : le test documente ce que lit le module.
const {
  db,
  refreshPeriodHolidays,
  loadMirrorContext,
  buildMirrorRows,
  newRecurId,
  markWaitlistBookingsDeleted,
  getSchoolZone,
  loadSchoolHolidayRanges,
} = vi.hoisted(() => ({
  db: {} as Record<string, unknown>,
  refreshPeriodHolidays: vi.fn(),
  loadMirrorContext: vi.fn(),
  buildMirrorRows: vi.fn(),
  newRecurId: vi.fn(),
  markWaitlistBookingsDeleted: vi.fn(),
  getSchoolZone: vi.fn(),
  loadSchoolHolidayRanges: vi.fn(),
}));
vi.mock("@/server/db", () => ({ prisma: db }));
// Modules voisins : fériés de période (periods.ts), pipeline des miroirs (slots.ts),
// trace liste d'attente et vacances scolaires — ils ne sont pas l'objet du test.
vi.mock("@/server/services/periods", () => ({ refreshPeriodHolidays }));
vi.mock("@/server/services/slots", () => ({ loadMirrorContext, buildMirrorRows, newRecurId }));
vi.mock("@/server/services/waiting-list-close", () => ({ markWaitlistBookingsDeleted }));
vi.mock("@/server/services/holidays", () => ({ getSchoolZone, loadSchoolHolidayRanges }));

import {
  CycleError,
  currentExerciceIdForService,
  currentExerciceIdsAllServices,
  cycleService,
  eligiblePeriodsWhere,
  getExercicePaneData,
  pickEligibleExercices,
  setShowPreviousExercices,
  undoCycle,
} from "./exercice";

// ─── Outillage ───────────────────────────────────────────────────────────────

type AnyFn = (...args: never[]) => unknown;
type Mock = ReturnType<typeof vi.fn>;

/** Options de transaction capturées (timeout élargi attendu). */
let lastTxOptions: { timeout?: number; maxWait?: number } | undefined;

/** Remplace le contenu du client factice par `models` (+ `$transaction`). */
function installDb(models: Record<string, Record<string, AnyFn>>): void {
  for (const k of Object.keys(db)) delete db[k];
  Object.assign(db, models, {
    $transaction: vi.fn(
      async (fn: (tx: unknown) => Promise<unknown>, opts?: typeof lastTxOptions) => {
        lastTxOptions = opts;
        return fn(db);
      },
    ),
  });
}

/** Accès typé à un mock installé (`db.slot.createMany`…). */
function m(model: string, method: string): Mock {
  return (db[model] as Record<string, Mock>)[method];
}

/** Premier argument du n-ième appel d'un mock (défaut : premier appel). */
function arg<T = Record<string, unknown>>(mock: Mock, call = 0): T {
  return mock.mock.calls[call]?.[0] as T;
}

const D = parseYmdUtc; // « YYYY-MM-DD » → Date à minuit UTC (valeur @db.Date)
const SVC = "svc1";

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetAllMocks();
  lastTxOptions = undefined;
  // Doubles par défaut des voisins — surchargés localement si le test en dépend.
  let n = 0;
  newRecurId.mockImplementation(() => `n${++n}`);
  refreshPeriodHolidays.mockResolvedValue(undefined);
  loadMirrorContext.mockResolvedValue({
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    activeDays: ["lun", "mar", "jeu"],
    openOnHolidays: false,
    holidaySet: new Set<string>(),
  });
  // Un miroir par créneau cloné, à l'id déterministe du pipeline (`u_<slotId>_<date>`).
  buildMirrorRows.mockImplementation(
    (a: {
      serviceId: string;
      periodId: number;
      slot: { id: string };
      ctx: { startDate: string };
    }) => [
      {
        id: `u_${a.slot.id}_${a.ctx.startDate}`,
        serviceId: a.serviceId,
        slotType: "unique",
        periodId: a.periodId,
        parentSlotId: a.slot.id,
      },
    ],
  );
  markWaitlistBookingsDeleted.mockResolvedValue(0);
  getSchoolZone.mockResolvedValue("C");
  loadSchoolHolidayRanges.mockResolvedValue([]);
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Helpers purs exportés ───────────────────────────────────────────────────

describe("eligiblePeriodsWhere — périmètre unique agenda / stats / éditions", () => {
  it("par défaut : périodes de l'exercice courant uniquement", () => {
    expect(eligiblePeriodsWhere(SVC, false, 11)).toEqual({ serviceId: SVC, exerciceId: 11 });
  });
  it("« afficher les exercices précédents » ou service sans exercice → tout le service", () => {
    expect(eligiblePeriodsWhere(SVC, true, 11)).toEqual({ serviceId: SVC });
    expect(eligiblePeriodsWhere(SVC, false, null)).toEqual({ serviceId: SVC });
  });
});

describe("pickEligibleExercices — dédup + sélection", () => {
  const periods = [
    { exercice: { id: 2, label: "2025-2026" } },
    { exercice: { id: 1, label: "2024-2025" } },
    { exercice: { id: 2, label: "2025-2026" } }, // doublon (deux périodes du même exercice)
    { exercice: null }, // période sans exercice (legacy) : ignorée
  ];
  it("exercices distincts triés par libellé, sélection par spId", () => {
    const r = pickEligibleExercices(periods, 1);
    expect(r.exercices.map((e) => e.id)).toEqual([1, 2]);
    expect(r.selected?.id).toBe(1);
  });
  it("spId absent ou inconnu → le dernier (libellé le plus récent) ; rien → null", () => {
    expect(pickEligibleExercices(periods, undefined).selected?.id).toBe(2);
    expect(pickEligibleExercices(periods, 999).selected?.id).toBe(2);
    expect(pickEligibleExercices([], undefined)).toEqual({ exercices: [], selected: null });
  });
});

// ─── Exercice courant (comparateur unique « le plus récent d'abord ») ────────

describe("currentExerciceIdForService", () => {
  it("date de début la plus tardive gagne ; sans date en dernier", async () => {
    installDb({
      exercice: {
        findMany: vi.fn(async () => [
          { id: 3, dateStart: null },
          { id: 1, dateStart: D("2025-09-01") },
          { id: 2, dateStart: D("2024-09-01") },
        ]),
      },
    });
    expect(await currentExerciceIdForService(SVC)).toBe(1);
    expect(arg(m("exercice", "findMany")).where).toEqual({ serviceId: SVC });
  });
  it("égalité de dates → id décroissant ; que des nulls → id le plus grand", async () => {
    installDb({
      exercice: {
        findMany: vi.fn(async () => [
          { id: 5, dateStart: D("2025-09-01") },
          { id: 8, dateStart: D("2025-09-01") },
        ]),
      },
    });
    expect(await currentExerciceIdForService(SVC)).toBe(8);
    installDb({
      exercice: {
        findMany: vi.fn(async () => [
          { id: 5, dateStart: null },
          { id: 8, dateStart: null },
        ]),
      },
    });
    expect(await currentExerciceIdForService(SVC)).toBe(8);
  });
  it("service sans exercice → null", async () => {
    installDb({ exercice: { findMany: vi.fn(async () => []) } });
    expect(await currentExerciceIdForService(SVC)).toBeNull();
  });
});

describe("currentExerciceIdsAllServices", () => {
  it("un courant par service en UNE requête ; exercices sans service ignorés", async () => {
    installDb({
      exercice: {
        findMany: vi.fn(async () => [
          { id: 1, serviceId: "a", dateStart: D("2024-09-01") },
          { id: 2, serviceId: "a", dateStart: D("2025-09-01") },
          { id: 3, serviceId: "b", dateStart: null },
          { id: 4, serviceId: null, dateStart: D("2030-01-01") },
        ]),
      },
    });
    expect((await currentExerciceIdsAllServices()).sort()).toEqual([2, 3]);
    expect(m("exercice", "findMany")).toHaveBeenCalledTimes(1);
  });
});

describe("setShowPreviousExercices", () => {
  it("écrit le drapeau sur le service ciblé", async () => {
    installDb({ service: { update: vi.fn(async () => ({})) } });
    await setShowPreviousExercices(SVC, true);
    expect(arg(m("service", "update"))).toEqual({
      where: { id: SVC },
      data: { showPreviousExercices: true },
    });
  });
});

// ─── Pane exercice (libellés, décalage d'un an, undoCycleInfo) ───────────────

type PaneOpts = {
  exercices?: unknown[];
  service?: { showPreviousExercices: boolean } | null;
  event?: { id: number; createdAt: Date; data: unknown } | null;
  bookingCount?: number;
  user?: { prenom: string; nom: string; name: string | null } | null;
  periods?: number;
  recurring?: number;
  multi?: unknown[];
};

function installPaneDb(o: PaneOpts = {}) {
  installDb({
    exercice: { findMany: vi.fn(async () => o.exercices ?? []) },
    service: {
      findUnique: vi.fn(async () =>
        o.service === undefined ? { showPreviousExercices: false } : o.service,
      ),
    },
    period: { count: vi.fn(async () => o.periods ?? 0) },
    slot: {
      count: vi.fn(async () => o.recurring ?? 0),
      findMany: vi.fn(async () => o.multi ?? []),
    },
    cycleEvent: { findFirst: vi.fn(async () => o.event ?? null) },
    booking: { count: vi.fn(async () => o.bookingCount ?? 0) },
    user: { findUnique: vi.fn(async () => o.user ?? null) },
  });
}

const EXO_CUR = {
  id: 11,
  label: "2025-2026",
  type: "scolaire",
  dateStart: D("2025-09-01"),
  dateEnd: D("2026-07-04"),
  visibleToUsers: true,
};
const EXO_PREV = {
  id: 10,
  label: "2024-2025",
  type: "scolaire",
  dateStart: D("2024-09-01"),
  dateEnd: D("2025-07-05"),
  visibleToUsers: false,
};

describe("getExercicePaneData — libellés et périmètre", () => {
  it("scolaire : courant / précédent / suivant décalé d'un an, bornes, tuiles", async () => {
    installPaneDb({
      exercices: [EXO_PREV, EXO_CUR],
      periods: 3,
      recurring: 7,
      multi: [{ batchId: "b1" }, { batchId: "b2" }],
      service: { showPreviousExercices: true },
    });
    const pane = await getExercicePaneData(SVC);
    expect(pane.currentName).toBe("2025-2026");
    expect(pane.previousName).toBe("2024-2025");
    expect(pane.nextName).toBe("2026-2027");
    expect(pane.currentRange).toEqual({ start: "2025-09-01", end: "2026-07-04" });
    expect(pane.currentVisible).toBe(true);
    expect(pane.hasActivePeriods).toBe(true);
    expect(pane.counts).toEqual({ periods: 3, recurring: 7, multiLots: 2 });
    expect(pane.showPreviousExercices).toBe(true);
    // Les tuiles comptent sur les périodes de l'exercice COURANT, pas de tout le service.
    expect(arg(m("period", "count")).where).toEqual({ serviceId: SVC, exerciceId: 11 });
    expect(arg(m("slot", "count")).where).toMatchObject({
      period: { serviceId: SVC, exerciceId: 11 },
      slotType: "recurring",
    });
  });
  it("civile : libellé = année seule (« 2026 » → suivant « 2027 »)", async () => {
    installPaneDb({
      exercices: [
        {
          ...EXO_CUR,
          label: "2026",
          type: "civile",
          dateStart: D("2026-01-01"),
          dateEnd: D("2026-12-31"),
        },
      ],
    });
    const pane = await getExercicePaneData(SVC);
    expect(pane.nextName).toBe("2027");
    expect(pane.previousName).toBeNull();
  });
  it("exercice sans dates → « <label> (suivant) », plage nulle", async () => {
    installPaneDb({
      exercices: [{ ...EXO_CUR, dateStart: null, dateEnd: null, visibleToUsers: false }],
    });
    const pane = await getExercicePaneData(SVC);
    expect(pane.nextName).toBe("2025-2026 (suivant)");
    expect(pane.currentRange).toBeNull();
    expect(pane.currentVisible).toBe(false);
  });
  it("aucun exercice : « — », suivant = année scolaire prochaine, périmètre = service, service introuvable → drapeau false", async () => {
    installPaneDb({ exercices: [], service: null });
    const pane = await getExercicePaneData(SVC);
    const y = new Date().getUTCFullYear() + 1;
    expect(pane.currentName).toBe("—");
    expect(pane.nextName).toBe(`${y}-${y + 1}`);
    expect(pane.currentRange).toBeNull();
    expect(pane.hasActivePeriods).toBe(false);
    expect(pane.showPreviousExercices).toBe(false);
    expect(arg(m("period", "count")).where).toEqual({ serviceId: SVC });
  });
});

const VALID_EVENT_DATA = {
  newPeriodIds: [100, 101],
  newRecurringSlotIds: ["n1"],
  newMirrorSlotIds: ["u_n1_2026-09-01"],
  newMultiSlotIds: ["m1"],
  newExerciceId: 900,
  visibleFromExerciceId: 11,
  actorId: "adm",
};

describe("undoCycleInfo (via getExercicePaneData) — lecture validée du CycleEvent", () => {
  const createdAt = new Date("2026-09-10T08:00:00.000Z");

  it("aucune bascule journalisée → hasUndo false, aucune requête de comptage", async () => {
    installPaneDb({ exercices: [EXO_CUR], event: null });
    const { undo } = await getExercicePaneData(SVC);
    expect(undo).toEqual({ hasUndo: false, createdAt: null, bookingsCount: 0, actorLabel: null });
    expect(arg(m("cycleEvent", "findFirst"))).toMatchObject({
      where: { serviceId: SVC },
      orderBy: { id: "desc" },
    });
    expect(m("booking", "count")).not.toHaveBeenCalled();
  });

  it("payload valide → hasUndo, comptage sur périodes ET créneaux (enfants exclus), auteur « Prénom Nom »", async () => {
    installPaneDb({
      exercices: [EXO_CUR],
      event: { id: 77, createdAt, data: VALID_EVENT_DATA },
      bookingCount: 4,
      user: { prenom: "Marie", nom: "Dupont", name: "marie.d" },
    });
    const { undo } = await getExercicePaneData(SVC);
    expect(undo).toEqual({
      hasUndo: true,
      createdAt: createdAt.toISOString(),
      bookingsCount: 4,
      actorLabel: "Marie Dupont",
    });
    // Ce que l'undo supprimera RÉELLEMENT : rattachement aux nouvelles périodes (les
    // créneaux ajoutés après la bascule partent par cascade) + ids figés.
    expect(arg(m("booking", "count")).where).toEqual({
      parentBookingId: null,
      OR: [
        { periodId: { in: [100, 101] } },
        { slot: { periodId: { in: [100, 101] } } },
        { slotId: { in: ["n1", "u_n1_2026-09-01", "m1"] } },
      ],
    });
    expect(arg(m("user", "findUnique")).where).toEqual({ id: "adm" });
  });

  it("auteur : prénom/nom vides → repli sur name ; actorId absent (bascule ancienne) → null sans requête", async () => {
    installPaneDb({
      exercices: [EXO_CUR],
      event: { id: 77, createdAt, data: VALID_EVENT_DATA },
      user: { prenom: "", nom: "", name: "compte-admin" },
    });
    expect((await getExercicePaneData(SVC)).undo.actorLabel).toBe("compte-admin");

    const { actorId: _omis, ...sansActeur } = VALID_EVENT_DATA;
    installPaneDb({ exercices: [EXO_CUR], event: { id: 78, createdAt, data: sansActeur } });
    expect((await getExercicePaneData(SVC)).undo.actorLabel).toBeNull();
    expect(m("user", "findUnique")).not.toHaveBeenCalled();
  });

  it("forme antérieure (sans multi / exercice / visibilité / acteur) → acceptée, comptage sur ce qui existe", async () => {
    installPaneDb({
      exercices: [EXO_CUR],
      event: {
        id: 5,
        createdAt,
        data: { newPeriodIds: [100], newRecurringSlotIds: ["n1"], newMirrorSlotIds: [] },
      },
      bookingCount: 1,
    });
    const { undo } = await getExercicePaneData(SVC);
    expect(undo.hasUndo).toBe(true);
    expect(arg(m("booking", "count")).where).toMatchObject({
      OR: [
        { periodId: { in: [100] } },
        { slot: { periodId: { in: [100] } } },
        { slotId: { in: ["n1"] } },
      ],
    });
  });

  it("payload illisible → hasUndo false, date conservée pour situer le problème, journalisé avec l'id, aucun comptage", async () => {
    installPaneDb({
      exercices: [EXO_CUR],
      // Forme historique divergente : clé renommée + ids en chaînes.
      event: {
        id: 42,
        createdAt,
        data: { periodIds: [1], newRecurringSlotIds: [1, 2], newMirrorSlotIds: [] },
      },
      bookingCount: 99,
    });
    const { undo } = await getExercicePaneData(SVC);
    expect(undo).toEqual({
      hasUndo: false,
      createdAt: createdAt.toISOString(),
      bookingsCount: 0,
      actorLabel: null,
    });
    expect(m("booking", "count")).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(String(consoleError.mock.calls[0]?.[0])).toContain("#42");
  });

  it("payload incomplet (tableau obligatoire manquant) ou non-objet → illisible", async () => {
    installPaneDb({
      exercices: [EXO_CUR],
      event: { id: 43, createdAt, data: { newPeriodIds: [1], newRecurringSlotIds: [] } }, // newMirrorSlotIds manquant
    });
    expect((await getExercicePaneData(SVC)).undo.hasUndo).toBe(false);
    installPaneDb({ exercices: [EXO_CUR], event: { id: 44, createdAt, data: null } });
    expect((await getExercicePaneData(SVC)).undo.hasUndo).toBe(false);
    installPaneDb({ exercices: [EXO_CUR], event: { id: 45, createdAt, data: "[]" } });
    expect((await getExercicePaneData(SVC)).undo.hasUndo).toBe(false);
  });

  it("champs optionnels : null accepté pour les exercices, refusé pour les tableaux ou l'acteur", async () => {
    const base = { newPeriodIds: [1], newRecurringSlotIds: [], newMirrorSlotIds: [] };
    installPaneDb({
      exercices: [EXO_CUR],
      event: {
        id: 46,
        createdAt,
        data: { ...base, newExerciceId: null, visibleFromExerciceId: null },
      },
    });
    expect((await getExercicePaneData(SVC)).undo.hasUndo).toBe(true);
    installPaneDb({
      exercices: [EXO_CUR],
      event: { id: 47, createdAt, data: { ...base, newMultiSlotIds: null } },
    });
    expect((await getExercicePaneData(SVC)).undo.hasUndo).toBe(false);
    installPaneDb({
      exercices: [EXO_CUR],
      event: { id: 48, createdAt, data: { ...base, actorId: 12 } },
    });
    expect((await getExercicePaneData(SVC)).undo.hasUndo).toBe(false);
  });
});

// ─── cycleService — bascule d'exercice ───────────────────────────────────────

type CycleFixture = {
  service?: { id: string; capacity: number } | null;
  /** Lignes `exercice.findMany` (id, dateStart, visibleToUsers). */
  exercices?: { id: number; dateStart: Date | null; visibleToUsers: boolean }[];
  /** Détail de l'exercice courant (`exercice.findUnique`). */
  currentExo?: Record<string, unknown> | null;
  periods?: Record<string, unknown>[];
  recurringSlots?: Record<string, unknown>[];
  multiSlots?: Record<string, unknown>[];
};

const CURRENT_EXO_DETAIL = {
  type: "scolaire",
  dateStart: D("2025-09-01"),
  dateEnd: D("2026-07-04"),
  maxReservations: 3,
  maxReservationsPeriod: 2,
  morningStart: "08:30",
  morningEnd: "12:00",
  afternoonStart: "13:30",
  afternoonEnd: "17:00",
  activeDays: "lun,mar,jeu",
  openOnHolidays: true,
  openOnSchoolHolidays: false,
  bookingDelay: 2,
};

const P1 = {
  id: 1,
  serviceId: SVC,
  exerciceId: 11,
  label: "Trimestre 1",
  etiquette: "T1",
  dateStart: D("2025-09-01"),
  dateEnd: D("2025-12-19"),
  color: "#abc",
  position: 1,
};
const P2 = {
  ...P1,
  id: 2,
  label: "Trimestre 2",
  etiquette: "T2",
  dateStart: D("2026-01-05"),
  dateEnd: D("2026-07-03"),
  position: 2,
};

function installCycleDb(f: CycleFixture = {}) {
  let nextPeriodId = 100;
  installDb({
    service: {
      findUnique: vi.fn(async () =>
        f.service === undefined ? { id: SVC, capacity: 30 } : f.service,
      ),
    },
    exercice: {
      findMany: vi.fn(
        async () =>
          f.exercices ?? [
            { id: 10, dateStart: D("2024-09-01"), visibleToUsers: false },
            { id: 11, dateStart: D("2025-09-01"), visibleToUsers: true },
          ],
      ),
      findUnique: vi.fn(async () =>
        f.currentExo === undefined ? CURRENT_EXO_DETAIL : f.currentExo,
      ),
      create: vi.fn(async () => ({ id: 900 })),
      update: vi.fn(async () => ({})),
    },
    period: {
      findMany: vi.fn(async () => f.periods ?? [P1, P2]),
      // Renvoie la ligne créée (id séquentiel + données) : la bascule relit dateStart/dateEnd.
      create: vi.fn(async (a: { data: Record<string, unknown> }) => ({
        id: nextPeriodId++,
        ...a.data,
      })),
    },
    slot: {
      findMany: vi.fn(async (a: { where: { slotType: string } }) =>
        a.where.slotType === "recurring" ? (f.recurringSlots ?? []) : (f.multiSlots ?? []),
      ),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    slotDemandeur: { createMany: vi.fn(async () => ({ count: 0 })) },
    cycleEvent: { create: vi.fn(async () => ({ id: 1 })) },
  });
}

const ALL_OPTS = {
  recreatePeriods: true,
  recreateSlots: true,
  recreateMultiSlots: true,
  actorId: "adm",
};
const PERIODS_ONLY = { recreatePeriods: true, recreateSlots: false, recreateMultiSlots: false };

describe("cycleService — gardes", () => {
  it("« Recréer les périodes » décoché → no-op legacy, aucune transaction", async () => {
    installCycleDb();
    expect(await cycleService(SVC, { ...ALL_OPTS, recreatePeriods: false })).toEqual({
      created: 0,
      slotsCreated: 0,
      multiSlotsCreated: 0,
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("service introuvable → CycleError explicite", async () => {
    installCycleDb({ service: null });
    await expect(cycleService(SVC, PERIODS_ONLY)).rejects.toThrow(CycleError);
    await expect(cycleService(SVC, PERIODS_ONLY)).rejects.toThrow("Service introuvable.");
    expect(m("exercice", "create")).not.toHaveBeenCalled();
  });
  it("aucune période sur l'exercice courant → CycleError ; périodes cherchées sur l'exercice COURANT", async () => {
    installCycleDb({ periods: [] });
    await expect(cycleService(SVC, PERIODS_ONLY)).rejects.toThrow(
      "Aucune période active à reconduire.",
    );
    expect(arg(m("period", "findMany")).where).toEqual({ serviceId: SVC, exerciceId: 11 });
    expect(m("exercice", "create")).not.toHaveBeenCalled();
  });
  it("transaction au timeout élargi (la bascule est l'opération la plus lourde)", async () => {
    installCycleDb();
    await cycleService(SVC, PERIODS_ONLY);
    expect(lastTxOptions?.timeout).toBeGreaterThan(5_000);
  });
});

describe("cycleService — nouvel exercice et périodes décalées d'un an", () => {
  it("l'exercice reconduit est copié (type, dates +1 an, ouverture, délai, maxima) sous le libellé scolaire suivant", async () => {
    installCycleDb();
    const r = await cycleService(SVC, { ...PERIODS_ONLY, actorId: "adm" });
    expect(r).toEqual({ created: 2, slotsCreated: 0, multiSlotsCreated: 0 });
    // Détail relu sur l'exercice courant (le plus récent = id 11), pas sur un autre.
    expect(arg(m("exercice", "findUnique")).where).toEqual({ id: 11 });
    expect(arg(m("exercice", "create")).data).toEqual({
      serviceId: SVC,
      label: "2026-2027",
      type: "scolaire",
      dateStart: D("2026-09-01"),
      dateEnd: D("2027-07-04"),
      morningStart: "08:30",
      morningEnd: "12:00",
      afternoonStart: "13:30",
      afternoonEnd: "17:00",
      activeDays: "lun,mar,jeu",
      openOnHolidays: true,
      openOnSchoolHolidays: false,
      bookingDelay: 2,
      maxReservations: 3,
      maxReservationsPeriod: 2,
    });
  });

  it("chaque période est recopiée sur le nouvel exercice, dates +1 an, libellé/étiquette/couleur/position conservés", async () => {
    installCycleDb();
    await cycleService(SVC, PERIODS_ONLY);
    const create = m("period", "create");
    expect(create).toHaveBeenCalledTimes(2);
    expect(arg(create, 0).data).toEqual({
      serviceId: SVC,
      exerciceId: 900,
      label: "Trimestre 1",
      etiquette: "T1",
      dateStart: D("2026-09-01"),
      dateEnd: D("2026-12-19"),
      color: "#abc",
      position: 1,
    });
    expect(arg(create, 1).data).toMatchObject({
      label: "Trimestre 2",
      dateStart: D("2027-01-05"),
      dateEnd: D("2027-07-03"),
      position: 2,
    });
    // Fériés de chaque nouvelle période via la source unique (periods.ts), dans le tx.
    expect(refreshPeriodHolidays).toHaveBeenCalledTimes(2);
    expect(refreshPeriodHolidays).toHaveBeenNthCalledWith(1, 100, db);
    expect(refreshPeriodHolidays).toHaveBeenNthCalledWith(2, 101, db);
  });

  it("29 février → 28 février quand l'année cible n'est pas bissextile ; 28 février reste 28", async () => {
    installCycleDb({
      periods: [
        { ...P1, id: 1, dateStart: D("2024-02-29"), dateEnd: D("2024-03-31") },
        { ...P1, id: 2, dateStart: D("2023-02-28"), dateEnd: D("2023-06-30") },
      ],
    });
    await cycleService(SVC, PERIODS_ONLY);
    const create = m("period", "create");
    expect(arg(create, 0).data).toMatchObject({
      dateStart: D("2025-02-28"),
      dateEnd: D("2025-03-31"),
    });
    expect(arg(create, 1).data).toMatchObject({
      dateStart: D("2024-02-28"),
      dateEnd: D("2024-06-30"),
    });
  });

  it("période sans dates : recopiée telle quelle, sans fériés ni contexte de miroirs (créneaux clonés sans occurrences)", async () => {
    installCycleDb({
      periods: [{ ...P1, dateStart: null, dateEnd: null }],
      recurringSlots: [
        {
          id: "r1",
          periodId: 1,
          startTime: "09:00",
          endTime: "10:00",
          capacity: 5,
          slotDay: "mar",
          weeks: "",
          jauge: false,
          demandeurs: [],
        },
      ],
    });
    const r = await cycleService(SVC, { ...ALL_OPTS, recreateMultiSlots: false });
    expect(arg(m("period", "create")).data).toMatchObject({ dateStart: null, dateEnd: null });
    expect(refreshPeriodHolidays).not.toHaveBeenCalled();
    expect(loadMirrorContext).not.toHaveBeenCalled();
    expect(buildMirrorRows).not.toHaveBeenCalled();
    expect(r.slotsCreated).toBe(1);
    expect(m("slot", "createMany")).toHaveBeenCalledTimes(1); // récurrents seuls, pas de miroirs
  });

  it("service sans exercice (legacy) : toutes les périodes du service, exercice scolaire aux dates des périodes décalées, ouverture par défaut", async () => {
    installCycleDb({ exercices: [], currentExo: null });
    await cycleService(SVC, PERIODS_ONLY);
    expect(arg(m("period", "findMany")).where).toEqual({ serviceId: SVC });
    expect(m("exercice", "findUnique")).not.toHaveBeenCalled();
    expect(arg(m("exercice", "create")).data).toEqual({
      serviceId: SVC,
      label: "2026-2027",
      type: "scolaire",
      dateStart: D("2026-09-01"), // plus petit début décalé
      dateEnd: D("2027-07-03"), // plus grande fin décalée
      ...DEFAULT_OPENING,
    });
    // Pas de transfert de visibilité : personne ne la portait.
    expect(m("exercice", "update")).not.toHaveBeenCalled();
  });
});

describe("cycleService — « Affiché aux utilisateurs » (un seul par service)", () => {
  it("l'exercice reconduit était visible → le flag passe au nouvel exercice, mémorisé dans le journal", async () => {
    installCycleDb();
    await cycleService(SVC, PERIODS_ONLY);
    const update = m("exercice", "update");
    expect(update).toHaveBeenCalledTimes(2);
    expect(arg(update, 0)).toEqual({ where: { id: 11 }, data: { visibleToUsers: false } });
    expect(arg(update, 1)).toEqual({ where: { id: 900 }, data: { visibleToUsers: true } });
    expect(arg(m("cycleEvent", "create")).data).toMatchObject({
      data: { visibleFromExerciceId: 11 },
    });
  });
  it("l'exercice reconduit n'était pas visible → aucun transfert, visibleFromExerciceId null", async () => {
    installCycleDb({
      exercices: [
        { id: 10, dateStart: D("2024-09-01"), visibleToUsers: true }, // ancien exercice visible : pas touché
        { id: 11, dateStart: D("2025-09-01"), visibleToUsers: false },
      ],
    });
    await cycleService(SVC, PERIODS_ONLY);
    expect(m("exercice", "update")).not.toHaveBeenCalled();
    expect(arg(m("cycleEvent", "create")).data).toMatchObject({
      data: { visibleFromExerciceId: null },
    });
  });
});

describe("cycleService — journal CycleEvent", () => {
  it("payload complet conforme au schéma de lecture, rattaché au service, acteur mémorisé", async () => {
    installCycleDb();
    await cycleService(SVC, { ...PERIODS_ONLY, actorId: "adm" });
    expect(arg(m("cycleEvent", "create"))).toEqual({
      data: {
        serviceId: SVC,
        data: {
          newPeriodIds: [100, 101],
          newRecurringSlotIds: [],
          newMirrorSlotIds: [],
          newMultiSlotIds: [],
          newExerciceId: 900,
          visibleFromExerciceId: 11,
          actorId: "adm",
        },
      },
    });
  });
  it("sans acteur : la clé actorId est ABSENTE (pas undefined/null — le schéma la veut string ou absente)", async () => {
    installCycleDb();
    await cycleService(SVC, PERIODS_ONLY);
    const payload = (arg(m("cycleEvent", "create")).data as { data: Record<string, unknown> }).data;
    expect("actorId" in payload).toBe(false);
  });
});

const R1 = {
  id: "r1",
  periodId: 1,
  startTime: "09:00",
  endTime: "10:00",
  capacity: 12,
  slotDay: "mar",
  weeks: "A",
  jauge: true,
  demandeurs: [{ demandeurId: 3 }, { demandeurId: 5 }],
};
const R2 = {
  id: "r2",
  periodId: 2,
  startTime: "14:00",
  endTime: "15:30",
  capacity: null,
  slotDay: "jeu",
  weeks: "",
  jauge: false,
  demandeurs: [],
};

describe("cycleService — créneaux récurrents clonés", () => {
  it("snapshot en UNE requête (pas de N+1), clones par période avec restrictions de demandeurs et miroirs", async () => {
    installCycleDb({ recurringSlots: [R1, R2] });
    const r = await cycleService(SVC, { ...ALL_OPTS, recreateMultiSlots: false });
    expect(r).toEqual({ created: 2, slotsCreated: 2, multiSlotsCreated: 0 });

    const findMany = m("slot", "findMany");
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(arg(findMany).where).toEqual({
      serviceId: SVC,
      periodId: { in: [1, 2] },
      slotType: "recurring",
    });

    // Période 1 : créneau n1 (clone de r1), puis ses demandeurs, puis son miroir.
    const createMany = m("slot", "createMany");
    expect(createMany).toHaveBeenCalledTimes(4); // (récurrents + miroirs) × 2 périodes
    expect(arg(createMany, 0).data).toEqual([
      {
        id: "n1",
        serviceId: SVC,
        slotType: "recurring",
        startTime: "09:00",
        endTime: "10:00",
        slotDate: null,
        capacity: 12,
        slotDay: "mar",
        periodId: 100,
        parentSlotId: null,
        weeks: "A",
        jauge: true,
      },
    ]);
    expect(arg(m("slotDemandeur", "createMany"), 0).data).toEqual([
      { slotId: "n1", demandeurId: 3 },
      { slotId: "n1", demandeurId: 5 },
    ]);
    expect(arg(createMany, 1).data).toEqual([
      expect.objectContaining({ id: "u_n1_2026-09-01", parentSlotId: "n1" }),
    ]);
    // Période 2 : clone de r2 (capacité null conservée, aucune restriction → pas d'insert demandeurs).
    expect(arg(createMany, 2).data).toEqual([
      expect.objectContaining({
        id: "n2",
        periodId: 101,
        capacity: null,
        slotDay: "jeu",
        weeks: "",
        jauge: false,
      }),
    ]);
    expect(m("slotDemandeur", "createMany")).toHaveBeenCalledTimes(1);

    // Miroirs via le pipeline unique, avec la capacité du service en repli.
    expect(buildMirrorRows).toHaveBeenCalledTimes(2);
    expect(arg(buildMirrorRows, 0)).toMatchObject({
      serviceId: SVC,
      periodId: 100,
      slot: {
        id: "n1",
        startTime: "09:00",
        endTime: "10:00",
        weeks: "A",
        slotDay: "mar",
        capacity: 12,
        jauge: true,
      },
      serviceCapacity: 30,
    });
    expect(arg(m("cycleEvent", "create")).data).toMatchObject({
      data: {
        newRecurringSlotIds: ["n1", "n2"],
        newMirrorSlotIds: ["u_n1_2026-09-01", "u_n2_2026-09-01"],
      },
    });
  });

  it("le contexte de miroirs est chargé APRÈS les fériés de la période neuve, sur le NOUVEL exercice", async () => {
    installCycleDb({ periods: [P1], recurringSlots: [R1] });
    await cycleService(SVC, { ...ALL_OPTS, recreateMultiSlots: false });
    expect(loadMirrorContext).toHaveBeenCalledWith(db, {
      id: 100,
      dateStart: D("2026-09-01"),
      dateEnd: D("2026-12-19"),
      exerciceId: 900,
    });
    const holidaysOrder = refreshPeriodHolidays.mock.invocationCallOrder[0];
    const ctxOrder = loadMirrorContext.mock.invocationCallOrder[0];
    expect(holidaysOrder).toBeLessThan(ctxOrder);
    // Les miroirs sont insérés APRÈS leurs parents.
    const createMany = m("slot", "createMany");
    expect(arg(createMany, 0).data).toEqual([expect.objectContaining({ slotType: "recurring" })]);
    expect(arg(createMany, 1).data).toEqual([expect.objectContaining({ slotType: "unique" })]);
  });

  it("« Recréer les créneaux » décoché → aucun clone, journal aux tableaux vides", async () => {
    installCycleDb({ recurringSlots: [R1, R2] });
    const r = await cycleService(SVC, PERIODS_ONLY);
    expect(r.slotsCreated).toBe(0);
    expect(m("slot", "createMany")).not.toHaveBeenCalled();
    expect(m("slotDemandeur", "createMany")).not.toHaveBeenCalled();
    expect(loadMirrorContext).not.toHaveBeenCalled();
    expect(arg(m("cycleEvent", "create")).data).toMatchObject({
      data: { newRecurringSlotIds: [], newMirrorSlotIds: [] },
    });
  });
});

// Lot multi-ponctuel : mardi 2025-09-09 (les mardis de septembre 2026 dans le contexte
// par défaut = 01, 08, 15, 22, 29).
const LOT_B1_A = {
  id: "m1",
  batchId: "b1",
  periodId: 1,
  slotDate: D("2025-09-09"),
  startTime: "14:00",
  endTime: "15:00",
  capacity: 8,
  jauge: true,
  weeks: "",
  demandeurs: [{ demandeurId: 3 }],
};
const LOT_B1_B = { ...LOT_B1_A, id: "m2", slotDate: D("2025-09-16") }; // même lot → ignoré

describe("cycleService — lots multi-ponctuels reconduits", () => {
  it("un représentant par batchId ; dates régénérées sur la nouvelle période ; vacances scolaires exclues ; lot uuid + demandeurs", async () => {
    // Convention ]dateStart, dateEnd] : 15 et 22 septembre en vacances.
    loadSchoolHolidayRanges.mockResolvedValue([{ dateStart: "2026-09-14", dateEnd: "2026-09-22" }]);
    installCycleDb({ periods: [P1], multiSlots: [LOT_B1_A, LOT_B1_B] });
    const r = await cycleService(SVC, { ...ALL_OPTS, recreateSlots: false });
    expect(r).toEqual({ created: 1, slotsCreated: 0, multiSlotsCreated: 3 });

    // Filtre du snapshot : ponctuels de lot, jamais les miroirs ni les ponctuels isolés.
    const findMany = m("slot", "findMany");
    expect(arg(findMany, 1).where).toEqual({
      serviceId: SVC,
      periodId: { in: [1] },
      slotType: "unique",
      batchId: { not: null },
      parentSlotId: null,
    });
    expect(loadSchoolHolidayRanges).toHaveBeenCalledWith(db, "C");

    const rows = arg(m("slot", "createMany")).data as Record<string, unknown>[];
    expect(rows.map((x) => x.slotDate)).toEqual([
      D("2026-09-01"),
      D("2026-09-08"),
      D("2026-09-29"),
    ]);
    const batchIds = new Set(rows.map((x) => x.batchId));
    expect(batchIds.size).toBe(1);
    expect(typeof rows[0]?.batchId).toBe("string");
    expect(rows[0]).toMatchObject({
      serviceId: SVC,
      slotType: "unique",
      startTime: "14:00",
      endTime: "15:00",
      capacity: 8,
      periodId: 100,
      jauge: true,
      weeks: "",
    });
    expect(arg(m("slotDemandeur", "createMany")).data).toEqual(
      rows.map((x) => ({ slotId: x.id, demandeurId: 3 })),
    );
    expect(arg(m("cycleEvent", "create")).data).toMatchObject({
      data: { newMultiSlotIds: rows.map((x) => x.id) },
    });
  });

  it("nouvel exercice ouvert pendant les vacances scolaires → plages non chargées, aucune date exclue", async () => {
    installCycleDb({
      periods: [P1],
      multiSlots: [LOT_B1_A],
      currentExo: { ...CURRENT_EXO_DETAIL, openOnSchoolHolidays: true },
    });
    const r = await cycleService(SVC, { ...ALL_OPTS, recreateSlots: false });
    expect(loadSchoolHolidayRanges).not.toHaveBeenCalled();
    expect(r.multiSlotsCreated).toBe(5);
  });

  it("parité du lot conservée ; une seule date régénérée → ponctuel isolé (sans batchId ni parité)", async () => {
    // Mardis de septembre 2026 : 01 (S36, B), 08 (S37, A), 15 (B), 22 (A), 29 (B).
    installCycleDb({ periods: [P1], multiSlots: [{ ...LOT_B1_A, weeks: "A" }] });
    await cycleService(SVC, { ...ALL_OPTS, recreateSlots: false });
    let rows = arg(m("slot", "createMany")).data as Record<string, unknown>[];
    expect(rows.map((x) => x.slotDate)).toEqual([D("2026-09-08"), D("2026-09-22")]);
    expect(rows.every((x) => x.weeks === "A" && typeof x.batchId === "string")).toBe(true);

    loadMirrorContext.mockResolvedValue({
      startDate: "2026-09-01",
      endDate: "2026-09-10",
      activeDays: ["lun", "mar", "jeu"],
      openOnHolidays: false,
      holidaySet: new Set<string>(),
    });
    installCycleDb({ periods: [P1], multiSlots: [{ ...LOT_B1_A, weeks: "A" }] });
    await cycleService(SVC, { ...ALL_OPTS, recreateSlots: false });
    rows = arg(m("slot", "createMany")).data as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ slotDate: D("2026-09-08"), batchId: null, weeks: "" });
  });

  it("jour du lot fermé sur le nouvel exercice ou date férié → rien n'est créé", async () => {
    // Mercredi 2025-09-10 : « mer » n'est pas dans les jours actifs du contexte.
    installCycleDb({ periods: [P1], multiSlots: [{ ...LOT_B1_A, slotDate: D("2025-09-10") }] });
    const r = await cycleService(SVC, { ...ALL_OPTS, recreateSlots: false });
    expect(r.multiSlotsCreated).toBe(0);
    expect(m("slot", "createMany")).not.toHaveBeenCalled();
    expect(m("slotDemandeur", "createMany")).not.toHaveBeenCalled();

    // Fériés de la nouvelle période (period_holidays) exclus tant que l'exercice n'ouvre pas les fériés.
    loadMirrorContext.mockResolvedValue({
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      activeDays: ["lun", "mar", "jeu"],
      openOnHolidays: false,
      holidaySet: new Set(["2026-09-08", "2026-09-15"]),
    });
    installCycleDb({ periods: [P1], multiSlots: [LOT_B1_A] });
    expect((await cycleService(SVC, { ...ALL_OPTS, recreateSlots: false })).multiSlotsCreated).toBe(
      3,
    );
  });

  it("option décochée → les lots ne sont même pas lus", async () => {
    installCycleDb({ periods: [P1], multiSlots: [LOT_B1_A] });
    const r = await cycleService(SVC, PERIODS_ONLY);
    expect(r.multiSlotsCreated).toBe(0);
    expect(m("slot", "findMany")).toHaveBeenCalledTimes(1); // snapshot récurrent seulement
    expect(loadSchoolHolidayRanges).not.toHaveBeenCalled();
  });
});

// ─── undoCycle — annulation de la dernière bascule ───────────────────────────

function installUndoDb(event: { id: number; data: unknown } | null, periodsLeft = 0) {
  installDb({
    cycleEvent: {
      findFirst: vi.fn(async () =>
        event ? { ...event, serviceId: SVC, createdAt: new Date() } : null,
      ),
      delete: vi.fn(async () => ({})),
    },
    booking: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    slot: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    periodHoliday: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    period: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    exercice: {
      updateMany: vi.fn(async () => ({ count: 0 })),
      update: vi.fn(async () => ({})),
      findUnique: vi.fn(async () => ({ _count: { periods: periodsLeft } })),
      delete: vi.fn(async () => ({})),
    },
  });
}

describe("undoCycle", () => {
  it("aucune bascule journalisée → no-op (dernier événement DU service, anti-IDOR)", async () => {
    installUndoDb(null);
    await expect(undoCycle(SVC)).resolves.toBeUndefined();
    expect(arg(m("cycleEvent", "findFirst"))).toEqual({
      where: { serviceId: SVC },
      orderBy: { id: "desc" },
    });
    expect(m("period", "deleteMany")).not.toHaveBeenCalled();
    expect(m("cycleEvent", "delete")).not.toHaveBeenCalled();
  });

  it("événement illisible → CycleError « Événement de bascule illisible », RIEN n'est supprimé", async () => {
    installUndoDb({
      id: 42,
      data: { newPeriodIds: ["100"], newRecurringSlotIds: [], newMirrorSlotIds: [] },
    });
    await expect(undoCycle(SVC)).rejects.toThrow(CycleError);
    await expect(undoCycle(SVC)).rejects.toThrow(/Événement de bascule illisible/);
    for (const [model, method] of [
      ["booking", "deleteMany"],
      ["slot", "deleteMany"],
      ["period", "deleteMany"],
      ["periodHoliday", "deleteMany"],
      ["exercice", "updateMany"],
      ["exercice", "delete"],
      ["cycleEvent", "delete"],
    ] as const) {
      expect(m(model, method), `${model}.${method}`).not.toHaveBeenCalled();
    }
    expect(markWaitlistBookingsDeleted).not.toHaveBeenCalled();
    expect(String(consoleError.mock.calls[0]?.[0])).toContain("#42");
  });

  it("nominal : traces liste d'attente puis réservations puis créneaux puis périodes, visibilité restaurée, événement et exercice supprimés", async () => {
    installUndoDb({ id: 77, data: VALID_EVENT_DATA });
    await undoCycle(SVC);

    // 1. miroirs + ponctuels des lots (populations disjointes, mêmes suppressions).
    expect(markWaitlistBookingsDeleted).toHaveBeenNthCalledWith(
      1,
      db,
      { slotId: { in: ["u_n1_2026-09-01", "m1"] } },
      "creneau",
    );
    const bookingDel = m("booking", "deleteMany");
    const slotDel = m("slot", "deleteMany");
    expect(arg(bookingDel, 0).where).toEqual({
      slotId: { in: ["u_n1_2026-09-01", "m1"] },
      bookingType: "unique",
    });
    expect(arg(slotDel, 0).where).toEqual({ id: { in: ["u_n1_2026-09-01", "m1"] } });
    // 2. récurrents.
    expect(markWaitlistBookingsDeleted).toHaveBeenNthCalledWith(
      2,
      db,
      { slotId: { in: ["n1"] } },
      "creneau",
    );
    expect(arg(bookingDel, 1).where).toEqual({ slotId: { in: ["n1"] }, bookingType: "recurring" });
    expect(arg(slotDel, 1).where).toEqual({ id: { in: ["n1"] } });
    // 3. périodes : réservations récurrentes rattachées, fériés, périodes.
    expect(markWaitlistBookingsDeleted).toHaveBeenNthCalledWith(
      3,
      db,
      { periodId: { in: [100, 101] } },
      "periode",
    );
    expect(arg(bookingDel, 2).where).toEqual({
      periodId: { in: [100, 101] },
      bookingType: "recurring",
    });
    expect(arg(m("periodHoliday", "deleteMany")).where).toEqual({ periodId: { in: [100, 101] } });
    expect(arg(m("period", "deleteMany")).where).toEqual({ id: { in: [100, 101] } });

    // Ordre : la trace précède la suppression des réservations, qui précède celle des créneaux.
    const order = (mock: Mock, i = 0) => mock.mock.invocationCallOrder[i];
    expect(order(markWaitlistBookingsDeleted)).toBeLessThan(order(bookingDel));
    expect(order(bookingDel)).toBeLessThan(order(slotDel));
    expect(order(bookingDel, 2)).toBeLessThan(order(m("period", "deleteMany")));

    // 5 bis. « Affiché aux utilisateurs » : tout le service éteint (scopé), puis l'ancien
    // porteur rallumé par un updateMany scopé au service (tolérant s'il a disparu).
    expect(arg(m("exercice", "updateMany"), 0)).toEqual({
      where: { serviceId: SVC, visibleToUsers: true },
      data: { visibleToUsers: false },
    });
    expect(arg(m("exercice", "updateMany"), 1)).toEqual({
      where: { id: 11, serviceId: SVC },
      data: { visibleToUsers: true },
    });
    expect(m("exercice", "update")).not.toHaveBeenCalled();

    // 6-7. événement supprimé ; exercice créé par la bascule supprimé s'il est vide.
    expect(arg(m("cycleEvent", "delete"))).toEqual({ where: { id: 77 } });
    expect(arg(m("exercice", "findUnique")).where).toEqual({ id: 900 });
    expect(arg(m("exercice", "delete"))).toEqual({ where: { id: 900 } });
    expect(lastTxOptions?.timeout).toBeGreaterThan(5_000);
  });

  it("l'exercice créé porte encore des périodes (ajoutées à la main) → il est conservé", async () => {
    installUndoDb({ id: 77, data: VALID_EVENT_DATA }, 1);
    await undoCycle(SVC);
    expect(m("exercice", "delete")).not.toHaveBeenCalled();
    expect(m("cycleEvent", "delete")).toHaveBeenCalledTimes(1);
  });

  it("événement de forme antérieure (sans multi / exercice / visibilité) : suppression du seul contenu connu, ni visibilité ni exercice touchés", async () => {
    installUndoDb({
      id: 5,
      data: { newPeriodIds: [100], newRecurringSlotIds: ["n1"], newMirrorSlotIds: ["u1"] },
    });
    await undoCycle(SVC);
    expect(arg(m("slot", "deleteMany"), 0).where).toEqual({ id: { in: ["u1"] } });
    expect(arg(m("slot", "deleteMany"), 1).where).toEqual({ id: { in: ["n1"] } });
    expect(m("exercice", "updateMany")).not.toHaveBeenCalled();
    expect(m("exercice", "update")).not.toHaveBeenCalled();
    expect(m("exercice", "findUnique")).not.toHaveBeenCalled();
    expect(m("exercice", "delete")).not.toHaveBeenCalled();
    expect(m("cycleEvent", "delete")).toHaveBeenCalledTimes(1);
  });

  it("tableaux vides → aucune suppression ciblée, mais l'événement est bien retiré", async () => {
    installUndoDb({
      id: 6,
      data: {
        newPeriodIds: [],
        newRecurringSlotIds: [],
        newMirrorSlotIds: [],
        newMultiSlotIds: [],
        newExerciceId: null,
        visibleFromExerciceId: null,
      },
    });
    await undoCycle(SVC);
    expect(markWaitlistBookingsDeleted).not.toHaveBeenCalled();
    expect(m("booking", "deleteMany")).not.toHaveBeenCalled();
    expect(m("slot", "deleteMany")).not.toHaveBeenCalled();
    expect(m("period", "deleteMany")).not.toHaveBeenCalled();
    expect(m("exercice", "update")).not.toHaveBeenCalled();
    expect(m("exercice", "delete")).not.toHaveBeenCalled();
    expect(arg(m("cycleEvent", "delete"))).toEqual({ where: { id: 6 } });
  });
});
