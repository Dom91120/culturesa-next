import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import type { DayKey } from "@/lib/mirror-dates";

// Le module sous test lit le client GLOBAL `prisma` (@/server/db) ET un `tx` reçu en
// paramètre ou fourni par `prisma.$transaction`. On expose un objet mutable unique,
// rempli par chaque test (`installPrisma`) : les lectures hors transaction et dans la
// transaction tombent sur les mêmes doubles, ce qui documente exactement ce que lit
// chaque fonction — tout accès imprévu explose (undefined is not a function), voulu.
// `vi.hoisted` : la factory de vi.mock est remontée en tête de module, l'objet aussi.
const { db } = vi.hoisted(() => ({ db: {} as Record<string, unknown> }));
vi.mock("@/server/db", () => ({ prisma: db }));
// Resynchronisation des enfants des récurrentes : hors sujet ici, espionnée pour
// vérifier le contrat « un cache partagé pour toute la régénération ».
vi.mock("@/server/services/recurring-children", () => ({
  syncChildrenForRecurringSlot: vi.fn(async () => undefined),
  createSyncRecurringCache: vi.fn(() => ({ tag: "cache-neuf" })),
}));
// Vacances scolaires : zone et plages contrôlées par le test (sinon lecture DB).
vi.mock("@/server/services/holidays", () => ({
  getSchoolZone: vi.fn(async () => "C"),
  loadSchoolHolidayRanges: vi.fn(async () => []),
}));

import { loadSchoolHolidayRanges } from "@/server/services/holidays";
import {
  createSyncRecurringCache,
  syncChildrenForRecurringSlot,
} from "@/server/services/recurring-children";
import {
  addRecurringSlot,
  addUniqueSlotBatch,
  buildMirrorRows,
  cloneSlotAtTimes,
  copyPonctuelWeek,
  copyRecurringWeek,
  deleteSlots,
  loadMirrorContext,
  moveRecurringSlot,
  moveUniqueSlot,
  moveUniqueSlotBatch,
  newRecurId,
  regenerateRecurringMirrorsForPeriodInTx,
  SlotMutationError,
} from "./slots";

/** Client transactionnel factice (mêmes conventions que bookings.test.ts). */
function fakeTx(models: Record<string, unknown>): Prisma.TransactionClient {
  return models as unknown as Prisma.TransactionClient;
}

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("boom", {
    code,
    clientVersion: "test",
  });
}

type TxOptions = { isolationLevel?: string; timeout?: number; maxWait?: number };

/**
 * Remplit le client global factice avec les modèles fournis et un `$transaction` qui
 * rejoue le callback sur CE MÊME objet. Renvoie l'espion `$transaction` (options,
 * nombre d'appels).
 */
function installPrisma(models: Record<string, unknown>) {
  for (const k of Object.keys(db)) delete db[k];
  const transaction = vi.fn(
    async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>, _opts?: TxOptions) =>
      fn(db as unknown as Prisma.TransactionClient),
  );
  Object.assign(db, models, { $transaction: transaction });
  return transaction;
}

function txOptions(transaction: ReturnType<typeof installPrisma>): TxOptions | undefined {
  return transaction.mock.calls[0]?.[1];
}

/** « YYYY-MM-DD » → Date à minuit UTC (valeur @db.Date). */
const d = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

// ─── Fixtures calendaires ─────────────────────────────────────────────────────
// Période du lundi 07/09/2026 (semaine ISO 37, impaire → A) au dimanche 04/10/2026.
//   lundis : 07/09 A · 14/09 B · 21/09 A · 28/09 B
//   mardis : 08/09 A · 15/09 B · 22/09 A · 29/09 B
const PERIOD_START = "2026-09-07";
const PERIOD_END = "2026-10-04";
const WEEKDAYS: DayKey[] = ["lun", "mar", "mer", "jeu", "ven"];

const period4 = {
  id: 4,
  serviceId: "s1",
  dateStart: d(PERIOD_START),
  dateEnd: d(PERIOD_END),
  exerciceId: 1,
};

/** Réglages d'ouverture de l'exercice (cf. opening.ts / EXERCICE_OPENING_SELECT). */
const opening = {
  morningStart: "09:00",
  morningEnd: "12:00",
  afternoonStart: "14:00",
  afternoonEnd: "18:00",
  activeDays: "lun,mar,mer,jeu,ven",
  openOnHolidays: false,
  openOnSchoolHolidays: false,
  bookingDelay: 0,
};

/** Modèles lus par loadMirrorContext (ouverture de l'exercice + fériés de la période). */
function mirrorEnv(over: { opening?: typeof opening | null; holidays?: string[] } = {}) {
  return {
    exercice: {
      findUnique: vi.fn(async () => (over.opening === undefined ? opening : over.opening)),
    },
    periodHoliday: {
      findMany: vi.fn(async () => (over.holidays ?? []).map((h) => ({ date: d(h) }))),
    },
  };
}

function ctxOf(over: Partial<ReturnType<typeof baseCtx>> = {}) {
  return { ...baseCtx(), ...over };
}
function baseCtx() {
  return {
    startDate: PERIOD_START,
    endDate: PERIOD_END,
    activeDays: WEEKDAYS,
    openOnHolidays: false,
    holidaySet: new Set<string>(),
  };
}

const baseSlot = {
  id: "sl_abc",
  startTime: "09:00",
  endTime: "10:00",
  weeks: "" as string | null,
  slotDay: "lun" as string | null,
  capacity: 3 as number | null,
  jauge: false,
};

const datesOf = (rows: Prisma.SlotCreateManyInput[]) =>
  rows.map((r) => (r.slotDate as Date).toISOString().slice(0, 10));

// Doubles d'écriture TYPÉS sur leur argument (sinon `mock.calls` est un tuple vide pour tsc).
const createManyFn = () =>
  vi.fn(async (_args: { data: Prisma.SlotCreateManyInput[] }) => ({ count: 0 }));
const createFn = () => vi.fn(async (_args: { data: Record<string, unknown> }) => ({}));
const countFn = () => vi.fn(async (_args: unknown) => ({ count: 0 }));
/** Lignes passées au premier `createMany` espionné. */
const rowsOf = (m: ReturnType<typeof createManyFn>) => m.mock.calls[0]?.[0].data ?? [];
/** `data` passé au premier `create` espionné. */
const dataOf = (m: ReturnType<typeof createFn>) => m.mock.calls[0]?.[0].data ?? {};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── newRecurId ─────────────────────────────────────────────────────────────

describe("newRecurId", () => {
  it("préfixe « sl_ » + 8 hexadécimaux, unique à chaque appel", () => {
    const a = newRecurId();
    expect(a).toMatch(/^sl_[0-9a-f]{8}$/);
    expect(newRecurId()).not.toBe(a);
  });
});

// ─── buildMirrorRows — pipeline unique des miroirs d'un récurrent ────────────

describe("buildMirrorRows", () => {
  const build = (slot: Partial<typeof baseSlot> = {}, ctx = ctxOf(), serviceCapacity = 9) =>
    buildMirrorRows({
      serviceId: "s1",
      periodId: 4,
      slot: { ...baseSlot, ...slot },
      ctx,
      serviceCapacity,
    });

  it("un miroir par occurrence du jour sur la période, tout hérité du parent", () => {
    const rows = build();
    expect(datesOf(rows)).toEqual(["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"]);
    expect(rows[0]).toEqual({
      id: "u_sl_abc_2026-09-07",
      serviceId: "s1",
      slotType: "unique",
      startTime: "09:00",
      endTime: "10:00",
      slotDate: d("2026-09-07"),
      capacity: 3,
      periodId: 4,
      parentSlotId: "sl_abc",
      jauge: false,
    });
  });

  it("créneau sans jour ou jour inconnu → aucun miroir", () => {
    expect(build({ slotDay: null })).toEqual([]);
    expect(build({ slotDay: "xyz" })).toEqual([]);
  });

  it("jour hors des jours actifs de l'exercice (ex. samedi) → aucun miroir", () => {
    expect(build({ slotDay: "sam" })).toEqual([]);
  });

  it("parité : « A » = semaines ISO impaires, « B » = paires", () => {
    expect(datesOf(build({ weeks: "A" }))).toEqual(["2026-09-07", "2026-09-21"]);
    expect(datesOf(build({ weeks: "B" }))).toEqual(["2026-09-14", "2026-09-28"]);
  });

  it("« A,B », null ou toute valeur sale → TOUTES les semaines (« A,B » jamais persisté)", () => {
    const all = ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"];
    expect(datesOf(build({ weeks: "A,B" }))).toEqual(all);
    expect(datesOf(build({ weeks: null }))).toEqual(all);
    expect(datesOf(build({ weeks: "B,A" }))).toEqual(all);
    expect(datesOf(build({ weeks: " a " }))).toEqual(all);
  });

  it("jour férié (period_holidays) exclu, sauf exercice ouvert les fériés", () => {
    const holidaySet = new Set(["2026-09-14"]);
    expect(datesOf(build({}, ctxOf({ holidaySet })))).toEqual([
      "2026-09-07",
      "2026-09-21",
      "2026-09-28",
    ]);
    expect(datesOf(build({}, ctxOf({ holidaySet, openOnHolidays: true })))).toHaveLength(4);
  });

  it("capacité du créneau absente → repli sur la capacité du service", () => {
    const rows = build({ capacity: null }, ctxOf(), 7);
    expect(rows.every((r) => r.capacity === 7)).toBe(true);
  });

  it("jauge du parent propagée à chaque miroir", () => {
    expect(build({ jauge: true }).every((r) => r.jauge === true)).toBe(true);
  });

  it("créneau « Journée entière » (horaires vides) → miroirs à horaires vides, pas de corruption", () => {
    const rows = build({ startTime: "", endTime: "" });
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.startTime === "" && r.endTime === "")).toBe(true);
  });

  it("plage propre du créneau rognée sur la période", () => {
    expect(datesOf(build({ ...baseSlot, dateStart: d("2026-09-14") } as never))).toEqual([
      "2026-09-14",
      "2026-09-21",
      "2026-09-28",
    ]);
    expect(
      datesOf(
        buildMirrorRows({
          serviceId: "s1",
          periodId: 4,
          slot: { ...baseSlot, dateStart: d("2026-08-01"), dateEnd: d("2026-09-20") },
          ctx: ctxOf(),
          serviceCapacity: 9,
        }),
      ),
    ).toEqual(["2026-09-07", "2026-09-14"]);
  });

  it("plage propre hors de la période (recouvrement vide) → repli sur la période entière", () => {
    const rows = buildMirrorRows({
      serviceId: "s1",
      periodId: 4,
      slot: { ...baseSlot, dateStart: d("2026-11-01"), dateEnd: d("2026-11-30") },
      ctx: ctxOf(),
      serviceCapacity: 9,
    });
    expect(datesOf(rows)).toHaveLength(4);
  });
});

// ─── loadMirrorContext — bornes + ouverture de l'exercice + fériés ───────────

describe("loadMirrorContext", () => {
  it("période avec exercice : jours actifs filtrés, fériés lus dans period_holidays en ISO", async () => {
    const env = mirrorEnv({
      opening: { ...opening, activeDays: "lun, foo,mar", openOnHolidays: true },
      holidays: ["2026-11-11"],
    });
    const ctx = await loadMirrorContext(fakeTx(env), period4);
    expect(ctx).toEqual({
      startDate: PERIOD_START,
      endDate: PERIOD_END,
      activeDays: ["lun", "mar"],
      openOnHolidays: true,
      holidaySet: new Set(["2026-11-11"]),
    });
    expect(env.periodHoliday.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { periodId: 4 } }),
    );
  });

  it("période SANS exercice = fermée : aucun jour actif, exercice non interrogé", async () => {
    const env = mirrorEnv();
    const ctx = await loadMirrorContext(fakeTx(env), { ...period4, exerciceId: null });
    expect(ctx.activeDays).toEqual([]);
    expect(ctx.openOnHolidays).toBe(false);
    expect(env.exercice.findUnique).not.toHaveBeenCalled();
  });
});

// ─── regenerateRecurringMirrorsForPeriodInTx — diff des miroirs ──────────────

describe("regenerateRecurringMirrorsForPeriodInTx", () => {
  type RecurringRow = {
    id: string;
    slotDay: string | null;
    weeks: string | null;
    capacity: number | null;
    jauge: boolean;
    startTime: string;
    endTime: string;
    dateStart: Date | null;
    dateEnd: Date | null;
  };
  const recurring = (over: Partial<RecurringRow> = {}): RecurringRow => ({
    id: "sl_1",
    slotDay: "lun",
    weeks: "",
    capacity: 2,
    jauge: false,
    startTime: "09:00",
    endTime: "10:00",
    dateStart: null,
    dateEnd: null,
    ...over,
  });

  function regenTx(opts: {
    period?: { dateStart: Date | null; dateEnd: Date | null; exerciceId: number | null } | null;
    recurring?: RecurringRow[];
    existingMirrors?: string[];
    booked?: number;
  }) {
    const findMany = vi.fn(async (args: { where: Record<string, unknown> }) =>
      args.where.slotType === "recurring"
        ? (opts.recurring ?? [])
        : (opts.existingMirrors ?? []).map((id) => ({ id })),
    );
    const deleteMany = countFn();
    const createMany = createManyFn();
    const count = vi.fn(async () => opts.booked ?? 0);
    const service = { findUnique: vi.fn(async () => ({ capacity: 5 })) };
    const tx = fakeTx({
      period: {
        findUnique: vi.fn(async () =>
          opts.period === undefined
            ? { dateStart: d(PERIOD_START), dateEnd: d(PERIOD_END), exerciceId: 1 }
            : opts.period,
        ),
      },
      service,
      ...mirrorEnv(),
      slot: { findMany, deleteMany, createMany },
      booking: { count },
    });
    return { tx, findMany, deleteMany, createMany, count, service };
  }

  it("période sans dates → aucun miroir attendu, rien lu ni écrit", async () => {
    const { tx, service, findMany } = regenTx({
      period: { dateStart: null, dateEnd: d(PERIOD_END), exerciceId: 1 },
    });
    await expect(regenerateRecurringMirrorsForPeriodInTx(tx, "s1", 4)).resolves.toBeUndefined();
    expect(service.findUnique).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it("diff : miroirs devenus invalides SANS réservation purgés, manquants créés, enfants resynchronisés", async () => {
    const { tx, deleteMany, createMany, count, findMany } = regenTx({
      recurring: [recurring()],
      // Un miroir périmé (avant la période) et un déjà en place.
      existingMirrors: ["u_sl_1_2026-08-31", "u_sl_1_2026-09-07"],
    });
    await regenerateRecurringMirrorsForPeriodInTx(tx, "s1", 4);
    // Créneaux récurrents de LA période du service, pas d'une autre.
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { serviceId: "s1", slotType: "recurring", periodId: 4 } }),
    );
    expect(count).toHaveBeenCalledWith({ where: { slotId: { in: ["u_sl_1_2026-08-31"] } } });
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["u_sl_1_2026-08-31"] } } });
    expect(datesOf(rowsOf(createMany))).toEqual(["2026-09-14", "2026-09-21", "2026-09-28"]);
    expect(syncChildrenForRecurringSlot).toHaveBeenCalledWith(tx, "sl_1", {
      cache: { tag: "cache-neuf" },
    });
  });

  it("miroir devenu invalide portant une réservation → SlotMutationError, rien supprimé", async () => {
    const { tx, deleteMany, createMany } = regenTx({
      recurring: [recurring()],
      existingMirrors: ["u_sl_1_2026-08-31"],
      booked: 1,
    });
    await expect(regenerateRecurringMirrorsForPeriodInTx(tx, "s1", 4)).rejects.toThrow(
      SlotMutationError,
    );
    await expect(regenerateRecurringMirrorsForPeriodInTx(tx, "s1", 4)).rejects.toThrow(
      "Des réservations existent sur des dates qui ne seraient plus proposées — annulez-les d'abord.",
    );
    expect(deleteMany).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  it("miroirs tous à jour : ni suppression ni création, mais resynchronisation quand même", async () => {
    const { tx, deleteMany, createMany, count } = regenTx({
      recurring: [recurring({ weeks: "A" })],
      existingMirrors: ["u_sl_1_2026-09-07", "u_sl_1_2026-09-21"],
    });
    await regenerateRecurringMirrorsForPeriodInTx(tx, "s1", 4);
    expect(count).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
    expect(syncChildrenForRecurringSlot).toHaveBeenCalledTimes(1);
  });

  it("créneau récurrent sans jour → ignoré (ni miroirs ni resynchronisation)", async () => {
    const { tx, createMany } = regenTx({ recurring: [recurring({ slotDay: null })] });
    await regenerateRecurringMirrorsForPeriodInTx(tx, "s1", 4);
    expect(createMany).not.toHaveBeenCalled();
    expect(syncChildrenForRecurringSlot).not.toHaveBeenCalled();
  });

  it("cache partagé : celui de l'appelant est transmis tel quel, sinon UN seul cache pour tous les créneaux", async () => {
    const shared = { tag: "cache-appelant" } as never;
    const two = [recurring({ id: "sl_1" }), recurring({ id: "sl_2", slotDay: "mar" })];
    const withCache = regenTx({ recurring: two });
    await regenerateRecurringMirrorsForPeriodInTx(withCache.tx, "s1", 4, shared);
    expect(createSyncRecurringCache).not.toHaveBeenCalled();
    expect(syncChildrenForRecurringSlot).toHaveBeenNthCalledWith(1, withCache.tx, "sl_1", {
      cache: shared,
    });
    expect(syncChildrenForRecurringSlot).toHaveBeenNthCalledWith(2, withCache.tx, "sl_2", {
      cache: shared,
    });

    vi.clearAllMocks();
    const without = regenTx({ recurring: two });
    await regenerateRecurringMirrorsForPeriodInTx(without.tx, "s1", 4);
    expect(createSyncRecurringCache).toHaveBeenCalledTimes(1);
    expect(syncChildrenForRecurringSlot).toHaveBeenCalledTimes(2);
  });
});

// ─── addRecurringSlot — création d'UN récurrent + ses miroirs ────────────────

describe("addRecurringSlot", () => {
  const input = {
    startTime: "09:00",
    endTime: "10:00",
    weeks: "A,B",
    dayKey: "mar" as DayKey,
    capacity: 4,
  };

  function addEnv(over: { period?: typeof period4 | null; exerciceId?: number | null } = {}) {
    const create = createFn();
    const createMany = createManyFn();
    const demCreateMany = countFn();
    const periodFindFirst = vi.fn(async () =>
      over.period === undefined
        ? { ...period4, exerciceId: over.exerciceId === undefined ? 1 : over.exerciceId }
        : over.period,
    );
    const transaction = installPrisma({
      service: { findUnique: vi.fn(async () => ({ capacity: 9 })) },
      period: { findFirst: periodFindFirst },
      ...mirrorEnv(),
      slot: { create, createMany },
      slotDemandeur: { createMany: demCreateMany },
    });
    return { create, createMany, demCreateMany, periodFindFirst, transaction };
  }

  it("service introuvable → refus avant toute transaction", async () => {
    const transaction = installPrisma({ service: { findUnique: vi.fn(async () => null) } });
    expect(await addRecurringSlot("s1", 4, input)).toEqual({
      ok: false,
      error: "Service introuvable",
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("période d'un autre service ou sans dates → refus (scope {id, serviceId})", async () => {
    const { periodFindFirst, transaction } = addEnv({ period: null });
    expect(await addRecurringSlot("s1", 4, input)).toEqual({
      ok: false,
      error: "Période introuvable ou sans dates",
    });
    expect(periodFindFirst).toHaveBeenCalledWith({ where: { id: 4, serviceId: "s1" } });
    expect(transaction).not.toHaveBeenCalled();

    addEnv({ period: { ...period4, dateEnd: null as unknown as Date } });
    expect(await addRecurringSlot("s1", 4, input)).toEqual({
      ok: false,
      error: "Période introuvable ou sans dates",
    });
  });

  it("nominal : semaines normalisées (« A,B » → toutes), jauge false par défaut, demandeurs dédupliqués, miroirs en un createMany", async () => {
    const { create, createMany, demCreateMany } = addEnv();
    const res = await addRecurringSlot("s1", 4, {
      ...input,
      demandeurIds: [3, 3, 0, -1, 2.5, 7],
      dateStart: "2026-09-14",
    });
    expect(res.ok).toBe(true);
    const id = (res as { id: string }).id;
    expect(id).toMatch(/^sl_[0-9a-f]{8}$/);
    expect(create).toHaveBeenCalledWith({
      data: {
        id,
        serviceId: "s1",
        slotType: "recurring",
        startTime: "09:00",
        endTime: "10:00",
        periodId: 4,
        weeks: "",
        slotDay: "mar",
        capacity: 4,
        jauge: false,
        // Bornes stockées TELLES QUE SAISIES, rognage à la lecture seulement.
        dateStart: d("2026-09-14"),
        dateEnd: null,
      },
    });
    expect(demCreateMany).toHaveBeenCalledWith({
      data: [
        { slotId: id, demandeurId: 3 },
        { slotId: id, demandeurId: 7 },
      ],
    });
    const rows = rowsOf(createMany);
    // Mardis à partir du 14/09 : 15, 22, 29 (le 08/09 est hors de la plage propre).
    expect(datesOf(rows)).toEqual(["2026-09-15", "2026-09-22", "2026-09-29"]);
    expect(rows.every((r) => r.parentSlotId === id && r.capacity === 4)).toBe(true);
  });

  it("période sans exercice = fermée : créneau créé mais AUCUN miroir ; sans demandeur → pas d'écriture slot_demandeurs", async () => {
    const { create, createMany, demCreateMany } = addEnv({ exerciceId: null });
    expect((await addRecurringSlot("s1", 4, input)).ok).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    expect(createMany).not.toHaveBeenCalled();
    expect(demCreateMany).not.toHaveBeenCalled();
  });

  it("erreurs de la transaction mappées : métier tel quel, P2034 → conflit, inattendue → générique + log", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const env = addEnv();
    env.create.mockRejectedValueOnce(new SlotMutationError("Refus métier."));
    expect(await addRecurringSlot("s1", 4, input)).toEqual({ ok: false, error: "Refus métier." });

    env.create.mockRejectedValueOnce(prismaError("P2034"));
    expect(await addRecurringSlot("s1", 4, input)).toEqual({
      ok: false,
      error: "Réservation simultanée détectée, merci de réessayer.",
    });
    expect(consoleError).not.toHaveBeenCalled();

    env.create.mockRejectedValueOnce(prismaError("P2002"));
    expect(await addRecurringSlot("s1", 4, input)).toEqual({
      ok: false,
      error: "Échec de l'enregistrement du créneau.",
    });
    expect(consoleError).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});

// ─── copyRecurringWeek — copie A ↔ B des récurrents d'une période ────────────

describe("copyRecurringWeek", () => {
  type StoredSlot = {
    id: string;
    startTime: string;
    endTime: string;
    weeks: string | null;
    slotDay: string | null;
    capacity: number | null;
    jauge: boolean;
    dateStart: Date | null;
    dateEnd: Date | null;
  };
  const stored = (over: Partial<StoredSlot>): StoredSlot => ({
    id: "x",
    startTime: "09:00",
    endTime: "10:00",
    weeks: "A",
    slotDay: "lun",
    capacity: 2,
    jauge: false,
    dateStart: null,
    dateEnd: null,
    ...over,
  });

  it("semaines identiques → refus immédiat, aucune lecture", async () => {
    const transaction = installPrisma({});
    expect(await copyRecurringWeek("s1", 4, "A", "A")).toEqual({
      ok: false,
      error: "Semaines identiques",
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("A → B : copie uniquement les créneaux A absents de B (signature), en conservant jauge, plage et demandeurs", async () => {
    const create = createFn();
    const createMany = createManyFn();
    const demCreateMany = countFn();
    const transaction = installPrisma({
      service: { findUnique: vi.fn(async () => ({ capacity: 9 })) },
      period: { findFirst: vi.fn(async (): Promise<typeof period4 | null> => period4) },
      ...mirrorEnv(),
      slot: {
        findMany: vi.fn(async () => [
          // À copier : A, restreint à partir du 14/09, jaugé.
          stored({ id: "a1", jauge: true, dateStart: d("2026-09-14") }),
          // Toutes semaines (déjà sur B) : ignoré.
          stored({ id: "ab", weeks: "", slotDay: "mar" }),
          // A dont un jumeau identique existe déjà sur B : ignoré (anti-doublon).
          stored({ id: "a2", slotDay: "mer", startTime: "10:00", endTime: "11:00" }),
          stored({ id: "b2", weeks: "B", slotDay: "mer", startTime: "10:00", endTime: "11:00" }),
        ]),
        create,
        createMany,
      },
      slotDemandeur: {
        findMany: vi.fn(async () => [{ slotId: "a1", demandeurId: 3 }]),
        createMany: demCreateMany,
      },
    });
    expect(await copyRecurringWeek("s1", 4, "A", "B")).toEqual({ ok: true, created: 1 });
    expect(create).toHaveBeenCalledTimes(1);
    const data = dataOf(create);
    expect(data).toMatchObject({
      serviceId: "s1",
      slotType: "recurring",
      periodId: 4,
      weeks: "B",
      slotDay: "lun",
      capacity: 2,
      jauge: true,
      dateStart: d("2026-09-14"),
      dateEnd: null,
    });
    expect(data.id).not.toBe("a1");
    // Miroirs B du lundi dans la plage propre : 14/09 et 28/09.
    const rows = rowsOf(createMany);
    expect(datesOf(rows)).toEqual(["2026-09-14", "2026-09-28"]);
    expect(rows.every((r) => r.parentSlotId === data.id && r.jauge === true)).toBe(true);
    expect(demCreateMany).toHaveBeenCalledWith({ data: [{ slotId: data.id, demandeurId: 3 }] });
    // Lot potentiellement long : timeout élargi.
    expect(txOptions(transaction)?.timeout).toBe(60_000);
  });
});

// ─── copyPonctuelWeek — copie A ↔ B des lots ponctuels ───────────────────────

describe("copyPonctuelWeek", () => {
  // Période élargie au dimanche 18/10 : mardis B = 15/09 · 29/09 · 13/10.
  const periodLong = { ...period4, dateEnd: d("2026-10-18") };
  const repr = {
    id: "p1",
    batchId: "lot-1",
    startTime: "14:00",
    endTime: "15:00",
    slotDate: d("2026-09-08"), // mardi, semaine A
    capacity: 2,
    jauge: true,
  };

  function copyEnv(opts: {
    src?: (typeof repr)[];
    existing?: { slotDate: Date; startTime: string; endTime: string }[];
    opening?: typeof opening;
  }) {
    const createMany = createManyFn();
    const demCreateMany = countFn();
    const transaction = installPrisma({
      period: { findFirst: vi.fn(async () => periodLong) },
      ...mirrorEnv({ opening: opts.opening ?? opening }),
      slot: {
        findMany: vi.fn(async (args: { where: Record<string, unknown> }) =>
          args.where.batchId ? (opts.src ?? []) : (opts.existing ?? []),
        ),
        createMany,
      },
      slotDemandeur: {
        findMany: vi.fn(async () => [{ slotId: "p1", demandeurId: 5 }]),
        createMany: demCreateMany,
      },
    });
    return { createMany, demCreateMany, transaction };
  }

  it("semaines identiques → refus ; aucun lot source → created 0 sans transaction", async () => {
    expect(await copyPonctuelWeek("s1", 4, "B", "B")).toEqual({
      ok: false,
      error: "Semaines identiques",
    });
    const { transaction } = copyEnv({ src: [] });
    expect(await copyPonctuelWeek("s1", 4, "A", "B")).toEqual({ ok: true, created: 0 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("lot A du mardi → lot B aux mardis de parité B, hors vacances scolaires, avec batchId et demandeurs", async () => {
    // Vacances ]14/09, 20/09] : le mardi 15/09 tombe dedans → exclu.
    vi.mocked(loadSchoolHolidayRanges).mockResolvedValueOnce([
      { dateStart: "2026-09-14", dateEnd: "2026-09-20" },
    ]);
    // Le second créneau du même lot n'est qu'un doublon de représentant.
    const { createMany, demCreateMany } = copyEnv({
      src: [repr, { ...repr, id: "p2", slotDate: d("2026-09-22") }],
    });
    expect(await copyPonctuelWeek("s1", 4, "A", "B")).toEqual({ ok: true, created: 2 });
    const rows = rowsOf(createMany);
    expect(datesOf(rows)).toEqual(["2026-09-29", "2026-10-13"]);
    expect(rows[0]).toMatchObject({
      serviceId: "s1",
      slotType: "unique",
      startTime: "14:00",
      endTime: "15:00",
      capacity: 2,
      periodId: 4,
      jauge: true,
      weeks: "B",
    });
    expect(typeof rows[0]?.batchId).toBe("string");
    expect(rows[0]?.batchId).toBe(rows[1]?.batchId);
    expect(demCreateMany).toHaveBeenCalledWith({
      data: [
        { slotId: rows[0]?.id, demandeurId: 5 },
        { slotId: rows[1]?.id, demandeurId: 5 },
      ],
    });
  });

  it("dates déjà occupées par un ponctuel de même horaire → sautées ; exercice ouvert en vacances → plages non chargées", async () => {
    const { createMany } = copyEnv({
      src: [repr],
      existing: [
        { slotDate: d("2026-09-15"), startTime: "14:00", endTime: "15:00" },
        { slotDate: d("2026-09-29"), startTime: "14:00", endTime: "15:00" },
        // Même date mais autre horaire : n'occupe pas.
        { slotDate: d("2026-10-13"), startTime: "16:00", endTime: "17:00" },
      ],
      opening: { ...opening, openOnSchoolHolidays: true },
    });
    expect(await copyPonctuelWeek("s1", 4, "A", "B")).toEqual({ ok: true, created: 1 });
    expect(loadSchoolHolidayRanges).not.toHaveBeenCalled();
    const rows = rowsOf(createMany);
    // Une seule date → ponctuel isolé : ni lot ni parité.
    expect(datesOf(rows)).toEqual(["2026-10-13"]);
    expect(rows[0]).toMatchObject({ batchId: null, weeks: "" });
  });
});

// ─── addUniqueSlotBatch — lot ponctuel en UNE transaction ────────────────────

describe("addUniqueSlotBatch", () => {
  const input = { startTime: "14:00", endTime: "15:00", capacity: 2 };

  function batchEnv() {
    const createMany = createManyFn();
    const demCreateMany = countFn();
    const transaction = installPrisma({
      service: { findUnique: vi.fn(async () => ({ id: "s1" })) },
      period: {
        findMany: vi.fn(async () => [
          { id: 4, dateStart: d(PERIOD_START), dateEnd: d(PERIOD_END) },
          { id: 5, dateStart: d("2026-10-05"), dateEnd: d("2026-10-31") },
        ]),
      },
      slot: { createMany },
      slotDemandeur: { createMany: demCreateMany },
    });
    return { createMany, demCreateMany, transaction };
  }

  it("dates dédupliquées, rattachées chacune à SA période, hors période comptées en skipped", async () => {
    const { createMany, demCreateMany } = batchEnv();
    const res = await addUniqueSlotBatch("s1", {
      ...input,
      dates: ["2026-09-08", "2026-09-08", "2026-10-06", "2026-12-01"],
      weeks: "B",
      demandeurIds: [3, 3],
    });
    expect(res).toEqual({ ok: true, created: 2, skipped: 1 });
    const rows = rowsOf(createMany);
    expect(rows.map((r) => r.periodId)).toEqual([4, 5]);
    expect(rows[0]).toMatchObject({
      serviceId: "s1",
      slotType: "unique",
      startTime: "14:00",
      endTime: "15:00",
      slotDate: d("2026-09-08"),
      capacity: 2,
      jauge: false,
      weeks: "B",
    });
    // Lot multi-dates : batchId serveur partagé par toutes les lignes.
    expect(typeof rows[0]?.batchId).toBe("string");
    expect(rows[1]?.batchId).toBe(rows[0]?.batchId);
    expect(demCreateMany).toHaveBeenCalledWith({
      data: [
        { slotId: rows[0]?.id, demandeurId: 3 },
        { slotId: rows[1]?.id, demandeurId: 3 },
      ],
    });
  });

  it("une seule date → ponctuel isolé : pas de batchId ni de parité, même si weeks fourni", async () => {
    const { createMany, demCreateMany } = batchEnv();
    expect(await addUniqueSlotBatch("s1", { ...input, dates: ["2026-09-08"], weeks: "A" })).toEqual(
      { ok: true, created: 1, skipped: 0 },
    );
    expect(rowsOf(createMany)[0]).toMatchObject({ batchId: null, weeks: "" });
    expect(demCreateMany).not.toHaveBeenCalled();
  });

  it("toutes les dates hors période → rien créé, tout compté en skipped", async () => {
    const { createMany } = batchEnv();
    expect(
      await addUniqueSlotBatch("s1", { ...input, dates: ["2026-12-01", "2026-12-08"] }),
    ).toEqual({ ok: true, created: 0, skipped: 2 });
    expect(createMany).not.toHaveBeenCalled();
  });
});

// ─── cloneSlotAtTimes — découpage à la pause méridienne ──────────────────────

describe("cloneSlotAtTimes", () => {
  const found = {
    slotType: "unique",
    slotDay: null as string | null,
    weeks: "" as string | null,
    capacity: 2 as number | null,
    jauge: true,
    periodId: 4 as number | null,
    slotDate: d("2026-09-08") as Date | null,
    batchId: null as string | null,
  };

  function cloneEnv(slot: typeof found | null) {
    const findFirst = vi.fn(async () => slot);
    const create = createFn();
    const createMany = createManyFn();
    installPrisma({
      service: { findUnique: vi.fn(async () => ({ id: "s1", capacity: 9 })) },
      slot: { findFirst, create, createMany },
      slotDemandeur: {
        findMany: vi.fn(async () => [{ demandeurId: 3 }]),
        createMany: countFn(),
      },
      period: {
        findFirst: vi.fn(async (): Promise<typeof period4 | null> => period4),
        findMany: vi.fn(async () => [
          { id: 4, dateStart: d(PERIOD_START), dateEnd: d(PERIOD_END) },
        ]),
      },
      ...mirrorEnv(),
    });
    return { findFirst, create, createMany };
  }

  it("créneau d'un autre service → introuvable (scope {id, serviceId})", async () => {
    const { findFirst } = cloneEnv(null);
    expect(await cloneSlotAtTimes("s1", "sl_x", "10:00", "11:00")).toEqual({
      ok: false,
      error: "Créneau introuvable",
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "sl_x", serviceId: "s1" } }),
    );
  });

  it("récurrent sans jour ou sans période → « Créneau récurrent incomplet » ; ponctuel sans date → refus", async () => {
    cloneEnv({ ...found, slotType: "recurring", slotDay: "lun", periodId: null });
    expect(await cloneSlotAtTimes("s1", "sl_x", "10:00", "11:00")).toEqual({
      ok: false,
      error: "Créneau récurrent incomplet",
    });
    cloneEnv({ ...found, slotDate: null });
    expect(await cloneSlotAtTimes("s1", "sl_x", "10:00", "11:00")).toEqual({
      ok: false,
      error: "Créneau ponctuel sans date",
    });
  });

  it("ponctuel isolé → un ponctuel à la MÊME date, nouveaux horaires, capacité/jauge/demandeurs conservés", async () => {
    const { createMany } = cloneEnv(found);
    expect(await cloneSlotAtTimes("s1", "p1", "10:00", "11:00")).toEqual({ ok: true });
    const rows = rowsOf(createMany);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      slotType: "unique",
      slotDate: d("2026-09-08"),
      startTime: "10:00",
      endTime: "11:00",
      capacity: 2,
      jauge: true,
      batchId: null,
      weeks: "",
    });
  });

  it("récurrent → nouveau récurrent même jour/parité, capacité repliée sur le service, miroirs régénérés", async () => {
    const { create, createMany } = cloneEnv({
      ...found,
      slotType: "recurring",
      slotDay: "lun",
      weeks: "A",
      capacity: null,
      slotDate: null,
    });
    expect(await cloneSlotAtTimes("s1", "sl_1", "10:00", "11:00")).toEqual({ ok: true });
    const data = dataOf(create);
    expect(data).toMatchObject({
      slotType: "recurring",
      periodId: 4,
      startTime: "10:00",
      endTime: "11:00",
      weeks: "A",
      slotDay: "lun",
      capacity: 9,
      jauge: true,
    });
    expect(data.id).not.toBe("sl_1");
    const rows = rowsOf(createMany);
    expect(datesOf(rows)).toEqual(["2026-09-07", "2026-09-21"]);
  });
});

// ─── moveRecurringSlot — déplacement d'un récurrent VIDE ─────────────────────

describe("moveRecurringSlot", () => {
  const recurringSlot = {
    id: "sl_1",
    serviceId: "s1",
    slotType: "recurring",
    periodId: 4,
    weeks: "A",
    slotDay: "lun",
    capacity: null as number | null,
    jauge: true,
    dateStart: d("2026-09-14") as Date | null,
    dateEnd: null as Date | null,
  };

  function moveEnv(opts: {
    slot?: typeof recurringSlot | null;
    mirrors?: string[];
    booked?: number;
  }) {
    const findFirst = vi.fn(async () => (opts.slot === undefined ? recurringSlot : opts.slot));
    const deleteMany = countFn();
    const update = vi.fn(async (_args: unknown) => ({}));
    const createMany = createManyFn();
    const periodFindFirst = vi.fn(async (): Promise<typeof period4 | null> => period4);
    const transaction = installPrisma({
      service: { findUnique: vi.fn(async () => ({ capacity: 5 })) },
      period: { findFirst: periodFindFirst },
      ...mirrorEnv(),
      slot: {
        findFirst,
        findMany: vi.fn(async () => (opts.mirrors ?? []).map((id) => ({ id }))),
        deleteMany,
        update,
        createMany,
      },
      booking: { count: vi.fn(async () => opts.booked ?? 0) },
    });
    return { findFirst, deleteMany, update, createMany, periodFindFirst, transaction };
  }

  it("créneau ponctuel ou d'un autre service → introuvable (scope {id, serviceId, recurring})", async () => {
    const { findFirst, transaction } = moveEnv({ slot: null });
    expect(await moveRecurringSlot("s1", "sl_1", "lun", "mar", "10:00", "11:00")).toEqual({
      ok: false,
      error: "Créneau introuvable",
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "sl_1", serviceId: "s1", slotType: "recurring" },
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("période du créneau relue dans le service (anti-IDOR) ; absente → refus", async () => {
    const env = moveEnv({});
    env.periodFindFirst.mockResolvedValueOnce(null);
    expect(await moveRecurringSlot("s1", "sl_1", "lun", "mar", "10:00", "11:00")).toEqual({
      ok: false,
      error: "Période introuvable ou sans dates",
    });
    expect(env.periodFindFirst).toHaveBeenCalledWith({ where: { id: 4, serviceId: "s1" } });
  });

  it("réservation sur le créneau OU un miroir → refus dans la transaction sérialisable, rien touché", async () => {
    const { deleteMany, update, createMany, transaction } = moveEnv({
      mirrors: ["u_sl_1_2026-09-14"],
      booked: 1,
    });
    expect(await moveRecurringSlot("s1", "sl_1", "lun", "mar", "10:00", "11:00")).toEqual({
      ok: false,
      error: "Créneau avec réservation : déplacement impossible.",
    });
    expect((db.booking as { count: ReturnType<typeof vi.fn> }).count).toHaveBeenCalledWith({
      where: { slotId: { in: ["sl_1", "u_sl_1_2026-09-14"] } },
    });
    expect(deleteMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
    expect(txOptions(transaction)?.isolationLevel).toBe(
      Prisma.TransactionIsolationLevel.Serializable,
    );
  });

  it("nominal : anciens miroirs purgés, créneau mis à jour, miroirs régénérés sur le nouveau jour avec plage et jauge conservées", async () => {
    const { deleteMany, update, createMany } = moveEnv({ mirrors: ["u_a", "u_b"] });
    expect(await moveRecurringSlot("s1", "sl_1", "lun", "mar", "10:00", "11:00")).toEqual({
      ok: true,
    });
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["u_a", "u_b"] } } });
    expect(update).toHaveBeenCalledWith({
      where: { id: "sl_1" },
      // Capacité NON touchée : `null` continue de suivre celle du service (le
      // déplacement ne fige plus le repli) ; les miroirs, eux, reçoivent le repli.
      data: { startTime: "10:00", endTime: "11:00", weeks: "A", slotDay: "mar" },
    });
    const rows = rowsOf(createMany);
    // Mardis A à partir du 14/09 : seul le 22/09 (08/09 hors plage, 15 et 29 = B).
    expect(datesOf(rows)).toEqual(["2026-09-22"]);
    expect(rows[0]).toMatchObject({
      parentSlotId: "sl_1",
      startTime: "10:00",
      endTime: "11:00",
      capacity: 5,
      jauge: true,
    });
  });
});

// ─── moveUniqueSlot — déplacement d'un ponctuel VIDE ─────────────────────────

describe("moveUniqueSlot", () => {
  function moveEnv(opts: {
    slot?: Record<string, unknown> | null;
    periodId?: number | null;
    booked?: number;
  }) {
    const update = vi.fn(async (_args: unknown) => ({}));
    const periodFindFirst = vi.fn(async () =>
      opts.periodId === null ? null : { id: opts.periodId ?? 4 },
    );
    const transaction = installPrisma({
      slot: {
        findFirst: vi.fn(async () =>
          opts.slot === undefined ? { id: "p1", parentSlotId: null } : opts.slot,
        ),
        update,
      },
      period: { findFirst: periodFindFirst },
      booking: { count: vi.fn(async () => opts.booked ?? 0) },
    });
    return { update, periodFindFirst, transaction };
  }

  it("miroir d'un récurrent → « ne se déplace pas directement »", async () => {
    const { transaction } = moveEnv({ slot: { id: "u_1", parentSlotId: "sl_1" } });
    expect(await moveUniqueSlot("s1", "u_1", "2026-09-15", "10:00", "11:00")).toEqual({
      ok: false,
      error: "Un miroir ne se déplace pas directement.",
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("aucune période du service ne couvre la date cible → refus nommant la date (résolution déterministe par id)", async () => {
    const { periodFindFirst } = moveEnv({ periodId: null });
    expect(await moveUniqueSlot("s1", "p1", "2026-12-01", "10:00", "11:00")).toEqual({
      ok: false,
      error: "Aucune période ne couvre la date 2026-12-01",
    });
    expect(periodFindFirst).toHaveBeenCalledWith({
      where: {
        serviceId: "s1",
        dateStart: { lte: d("2026-12-01") },
        dateEnd: { gte: d("2026-12-01") },
      },
      select: { id: true },
      orderBy: { id: "asc" },
    });
  });

  it("créneau réservé → refus sérialisable sans update ; vide → horaires, date et période re-résolue", async () => {
    const booked = moveEnv({ booked: 1 });
    expect(await moveUniqueSlot("s1", "p1", "2026-09-15", "10:00", "11:00")).toEqual({
      ok: false,
      error: "Créneau avec réservation : déplacement impossible.",
    });
    expect(booked.update).not.toHaveBeenCalled();
    expect(txOptions(booked.transaction)?.isolationLevel).toBe(
      Prisma.TransactionIsolationLevel.Serializable,
    );

    const free = moveEnv({ periodId: 5 });
    expect(await moveUniqueSlot("s1", "p1", "2026-09-15", "10:00", "11:00")).toEqual({ ok: true });
    expect(free.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { startTime: "10:00", endTime: "11:00", slotDate: d("2026-09-15"), periodId: 5 },
    });
  });
});

// ─── moveUniqueSlotBatch — lot ponctuel, occurrences non déplaçables ignorées ─

describe("moveUniqueSlotBatch", () => {
  it("liste vide → ok sans transaction", async () => {
    const transaction = installPrisma({});
    expect(await moveUniqueSlotBatch("s1", [])).toEqual({ ok: true, movedIds: [] });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("réservé, miroir, hors service ou hors période → ignorés ; le reste mis à jour atomiquement", async () => {
    const update = vi.fn(async (_args: unknown) => ({}));
    const transaction = installPrisma({
      slot: {
        // « d » (autre service) n'est pas renvoyé par la requête scopée.
        findMany: vi.fn(async () => [
          { id: "a", parentSlotId: null },
          { id: "b", parentSlotId: null },
          { id: "c", parentSlotId: "sl_1" },
          { id: "e", parentSlotId: null },
        ]),
        update,
      },
      booking: { findMany: vi.fn(async () => [{ slotId: "b" }]) },
      period: {
        findMany: vi.fn(async () => [
          { id: 4, dateStart: d(PERIOD_START), dateEnd: d(PERIOD_END) },
        ]),
      },
    });
    const it_ = (id: string, slotDate: string) => ({
      id,
      slotDate,
      startTime: "10:00",
      endTime: "11:00",
    });
    expect(
      await moveUniqueSlotBatch("s1", [
        it_("a", "2026-09-15"),
        it_("b", "2026-09-15"),
        it_("c", "2026-09-15"),
        it_("d", "2026-09-15"),
        it_("e", "2026-12-01"),
      ]),
    ).toEqual({ ok: true, movedIds: ["a"] });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: "a" },
      data: { startTime: "10:00", endTime: "11:00", slotDate: d("2026-09-15"), periodId: 4 },
    });
    expect((db.slot as { findMany: ReturnType<typeof vi.fn> }).findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["a", "b", "c", "d", "e"] }, serviceId: "s1", slotType: "unique" },
      }),
    );
    expect(txOptions(transaction)).toMatchObject({
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 60_000,
    });
  });
});

// ─── deleteSlots — suppression de créneaux VIDES + miroirs ───────────────────

describe("deleteSlots", () => {
  function deleteEnv(opts: { owned: string[]; mirrors?: string[]; booked?: number }) {
    const findMany = vi.fn(async (args: { where: Record<string, unknown> }) =>
      args.where.parentSlotId
        ? (opts.mirrors ?? []).map((id) => ({ id }))
        : opts.owned.map((id) => ({ id })),
    );
    const deleteMany = countFn();
    const count = vi.fn(async () => opts.booked ?? 0);
    const transaction = installPrisma({
      slot: { findMany, deleteMany },
      booking: { count },
    });
    return { findMany, deleteMany, count, transaction };
  }

  it("liste vide → 0 sans requête ; aucun créneau du service → 0 sans transaction (anti-IDOR)", async () => {
    const none = installPrisma({});
    expect(await deleteSlots("s1", [])).toEqual({ ok: true, deleted: 0 });
    expect(none).not.toHaveBeenCalled();

    const { findMany, transaction } = deleteEnv({ owned: [] });
    expect(await deleteSlots("s1", ["sl_autre"])).toEqual({ ok: true, deleted: 0 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["sl_autre"] }, serviceId: "s1" } }),
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it("réservation sur le créneau ou l'un de ses miroirs → refus, rien supprimé", async () => {
    const { deleteMany, count, transaction } = deleteEnv({
      owned: ["sl_1"],
      mirrors: ["u_1"],
      booked: 1,
    });
    expect(await deleteSlots("s1", ["sl_1"])).toEqual({
      ok: false,
      error: "Créneau avec réservation : suppression impossible.",
    });
    expect(count).toHaveBeenCalledWith({ where: { slotId: { in: ["sl_1", "u_1"] } } });
    expect(deleteMany).not.toHaveBeenCalled();
    expect(txOptions(transaction)?.isolationLevel).toBe(
      Prisma.TransactionIsolationLevel.Serializable,
    );
  });

  it("nominal : miroirs puis créneaux supprimés, `deleted` = créneaux possédés (pas demandés)", async () => {
    const { deleteMany } = deleteEnv({ owned: ["sl_1"], mirrors: ["u_1", "u_2"] });
    expect(await deleteSlots("s1", ["sl_1", "sl_autre_service"])).toEqual({
      ok: true,
      deleted: 1,
    });
    expect(deleteMany).toHaveBeenNthCalledWith(1, { where: { id: { in: ["u_1", "u_2"] } } });
    expect(deleteMany).toHaveBeenNthCalledWith(2, { where: { id: { in: ["sl_1"] } } });
  });

  it("récurrent sans miroir : une seule suppression", async () => {
    const { deleteMany } = deleteEnv({ owned: ["p1"] });
    expect(await deleteSlots("s1", ["p1"])).toEqual({ ok: true, deleted: 1 });
    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["p1"] } } });
  });
});
