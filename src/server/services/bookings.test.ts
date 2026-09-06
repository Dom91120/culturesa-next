import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";

// Le module sous test importe `@/server/db` (instancie PrismaClient) et
// `@/server/guards` (next/headers) : on les neutralise — toutes les fonctions
// testées reçoivent de toute façon leur client via le paramètre `db`/`tx`.
vi.mock("@/server/db", () => ({ prisma: {} }));
vi.mock("@/server/guards", () => ({ getSession: vi.fn(async () => null) }));
// Vacances scolaires : zone et plages contrôlées par le test (sinon lecture DB).
vi.mock("@/server/services/holidays", () => ({
  getSchoolZone: vi.fn(async () => "C"),
  loadSchoolHolidayRanges: vi.fn(async () => [
    // Convention ]dateStart, dateEnd] (cf. lib/school-holidays) : vacances d'été.
    { dateStart: "2026-07-03", dateEnd: "2026-08-31" },
  ]),
}));

import {
  assertBookingUnlocked,
  assertNotSchoolHolidayForUser,
  assertPeriodOpenForUser,
  assertReservationLimits,
  assertSlotCapacity,
  BookingError,
  effectiveOpenOnSchoolHolidays,
  isValidationMode,
  limitesEpuiseesPourListeAttente,
  mapBookingError,
  resolveEffectiveDemandeurId,
  userCanAccessService,
} from "./bookings";

/**
 * Client transactionnel factice : on ne fournit que les modèles/méthodes que la
 * fonction sous test utilise ; tout accès imprévu explose (undefined is not a
 * function), ce qui est voulu — le test documente exactement ce que lit la garde.
 */
function fakeTx(models: Record<string, unknown>): Prisma.TransactionClient {
  return models as unknown as Prisma.TransactionClient;
}

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("boom", {
    code,
    clientVersion: "test",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── mapBookingError — mappage unique erreur → { ok:false, error } ───────────

describe("mapBookingError", () => {
  it("BookingError → message métier tel quel", () => {
    expect(mapBookingError(new BookingError("Complet."))).toEqual({
      ok: false,
      error: "Complet.",
    });
  });
  it("P2002 (doublon uq_recurring) → message doublon, surchargeable", () => {
    expect(mapBookingError(prismaError("P2002")).error).toBe("Vous avez déjà réservé ce créneau.");
    expect(mapBookingError(prismaError("P2002"), { duplicate: "Doublon admin." }).error).toBe(
      "Doublon admin.",
    );
  });
  it("P2034 (conflit de sérialisation) → message conflit, surchargeable", () => {
    expect(mapBookingError(prismaError("P2034")).error).toBe(
      "Réservation simultanée détectée, réessayez.",
    );
    expect(mapBookingError(prismaError("P2034"), { conflict: "Conflit." }).error).toBe("Conflit.");
  });
  it("toute autre erreur est RELANCÉE (500 générique en amont)", () => {
    expect(() => mapBookingError(new Error("panne"))).toThrow("panne");
    expect(() => mapBookingError(prismaError("P2025"))).toThrow();
  });
});

// ─── Demandeur effectif (cloisonnement usager) ───────────────────────────────

describe("resolveEffectiveDemandeurId", () => {
  it("le demandeur personnel prime", () => {
    expect(resolveEffectiveDemandeurId({ demandeurId: 7, structure: { demandeurId: 3 } })).toBe(7);
  });
  it("repli sur le demandeur de la structure", () => {
    expect(resolveEffectiveDemandeurId({ demandeurId: null, structure: { demandeurId: 3 } })).toBe(
      3,
    );
  });
  it("aucun des deux → null (ex. administrateur)", () => {
    expect(resolveEffectiveDemandeurId({ demandeurId: null, structure: null })).toBeNull();
  });
});

describe("effectiveOpenOnSchoolHolidays", () => {
  it("réglage du demandeur personnel prioritaire", () => {
    expect(
      effectiveOpenOnSchoolHolidays({
        demandeur: { openOnSchoolHolidays: false },
        structure: { demandeur: { openOnSchoolHolidays: true } },
      }),
    ).toBe(false);
  });
  it("repli sur le demandeur de la structure", () => {
    expect(
      effectiveOpenOnSchoolHolidays({
        demandeur: null,
        structure: { demandeur: { openOnSchoolHolidays: false } },
      }),
    ).toBe(false);
  });
  it("aucun demandeur effectif → ouvert par défaut", () => {
    expect(effectiveOpenOnSchoolHolidays({ demandeur: null, structure: null })).toBe(true);
    expect(effectiveOpenOnSchoolHolidays(null)).toBe(true);
  });
});

// ─── assertPeriodOpenForUser — exercice visible + date de disponibilité ──────

describe("assertPeriodOpenForUser", () => {
  it("sans periodId (ponctuel hors période) : aucune restriction, aucune requête", async () => {
    const findUnique = vi.fn();
    await assertPeriodOpenForUser(fakeTx({ period: { findUnique } }), null);
    await assertPeriodOpenForUser(fakeTx({ period: { findUnique } }), 0);
    expect(findUnique).not.toHaveBeenCalled();
  });
  it("période d'un exercice NON affiché aux utilisateurs → refus (requête forgée)", async () => {
    const tx = fakeTx({
      period: {
        findUnique: vi.fn(async () => ({
          disponibilite: null,
          exercice: { visibleToUsers: false },
        })),
      },
    });
    await expect(assertPeriodOpenForUser(tx, 5)).rejects.toThrow(
      "Cet exercice n'est pas ouvert aux réservations.",
    );
  });
  it("date de disponibilité future → refus avec la date d'ouverture", async () => {
    const tx = fakeTx({
      period: {
        findUnique: vi.fn(async () => ({
          disponibilite: new Date("2999-01-01T00:00:00Z"),
          exercice: { visibleToUsers: true },
        })),
      },
    });
    await expect(assertPeriodOpenForUser(tx, 5)).rejects.toThrow(BookingError);
  });
  it("date de disponibilité atteinte ou absente → autorisé", async () => {
    const open = fakeTx({
      period: {
        findUnique: vi.fn(async () => ({
          disponibilite: new Date("2000-01-01T00:00:00Z"),
          exercice: { visibleToUsers: true },
        })),
      },
    });
    await expect(assertPeriodOpenForUser(open, 5)).resolves.toBeUndefined();
    const noDate = fakeTx({
      period: {
        findUnique: vi.fn(async () => ({ disponibilite: null, exercice: null })),
      },
    });
    await expect(assertPeriodOpenForUser(noDate, 5)).resolves.toBeUndefined();
  });
});

// ─── Accès service & mode validation (scoping par demandeur effectif) ────────

function userTx(opts: {
  user?: { demandeurId: number | null; structure: { demandeurId: number | null } | null };
  setting?: { validation?: boolean } | null;
}) {
  return fakeTx({
    user: { findUnique: vi.fn(async () => opts.user ?? null) },
    serviceDemandeurSettings: { findFirst: vi.fn(async () => opts.setting ?? null) },
  });
}

describe("userCanAccessService", () => {
  it("sans demandeur effectif (ex. admin) → accès libre", async () => {
    const tx = userTx({ user: { demandeurId: null, structure: null } });
    expect(await userCanAccessService(tx, "u1", "s1")).toBe(true);
  });
  it("demandeur effectif référencé par le service → accès", async () => {
    const tx = userTx({
      user: { demandeurId: null, structure: { demandeurId: 3 } },
      setting: {},
    });
    expect(await userCanAccessService(tx, "u1", "s1")).toBe(true);
  });
  it("demandeur effectif non référencé → refus", async () => {
    const tx = userTx({ user: { demandeurId: 7, structure: null }, setting: null });
    expect(await userCanAccessService(tx, "u1", "s1")).toBe(false);
  });
});

describe("isValidationMode", () => {
  it("sans demandeur effectif → auto-validé (false)", async () => {
    const tx = userTx({ user: { demandeurId: null, structure: null } });
    expect(await isValidationMode(tx, "u1", "s1")).toBe(false);
  });
  it("demandeur via la STRUCTURE en mode validation → true (régression audit 2026-07-14)", async () => {
    const tx = userTx({
      user: { demandeurId: null, structure: { demandeurId: 3 } },
      setting: { validation: true },
    });
    expect(await isValidationMode(tx, "u1", "s1")).toBe(true);
  });
  it("réglage absent ou validation désactivée → false", async () => {
    expect(
      await isValidationMode(userTx({ user: { demandeurId: 7, structure: null } }), "u1", "s1"),
    ).toBe(false);
    expect(
      await isValidationMode(
        userTx({ user: { demandeurId: 7, structure: null }, setting: { validation: false } }),
        "u1",
        "s1",
      ),
    ).toBe(false);
  });
});

// ─── assertSlotCapacity — anti-surbooking ────────────────────────────────────

type CapacitySlot = {
  capacity: number | null;
  jauge: boolean;
  service: { capacity: number; gaugeAccompagnants: boolean };
};

function capacityTx(opts: {
  slot: CapacitySlot | null;
  count?: number;
  sums?: { enfants: number | null; accompagnants: number | null };
}) {
  const findFirst = vi.fn(async () => opts.slot);
  const count = vi.fn(async () => opts.count ?? 0);
  const aggregate = vi.fn(async () => ({
    _sum: opts.sums ?? { enfants: null, accompagnants: null },
  }));
  return {
    tx: fakeTx({ slot: { findFirst }, booking: { count, aggregate } }),
    findFirst,
    count,
    aggregate,
  };
}

const capacityBase = {
  serviceId: "s1",
  slotId: "sl1",
  bookingType: "recurring" as const,
  periodId: 4,
  enfants: 1,
  accompagnants: 0,
};

describe("assertSlotCapacity", () => {
  it("créneau hors du service annoncé → « Créneau introuvable. » (anti-IDOR)", async () => {
    const { tx, findFirst } = capacityTx({ slot: null });
    await expect(assertSlotCapacity(tx, capacityBase)).rejects.toThrow("Créneau introuvable.");
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "sl1", serviceId: "s1" } }),
    );
  });

  it("hors jauge : 1 par réservation — dernière place acceptée, au-delà refusé", async () => {
    const slot: CapacitySlot = {
      capacity: 3,
      jauge: false,
      service: { capacity: 99, gaugeAccompagnants: false },
    };
    const ok = capacityTx({ slot, count: 2 });
    await expect(assertSlotCapacity(ok.tx, capacityBase)).resolves.toBeUndefined();
    const full = capacityTx({ slot, count: 3 });
    await expect(assertSlotCapacity(full.tx, capacityBase)).rejects.toThrow(
      "Ce créneau est complet.",
    );
  });

  it("capacité du créneau absente → repli sur la capacité du service", async () => {
    const slot: CapacitySlot = {
      capacity: null,
      jauge: false,
      service: { capacity: 1, gaugeAccompagnants: false },
    };
    const full = capacityTx({ slot, count: 1 });
    await expect(assertSlotCapacity(full.tx, capacityBase)).rejects.toThrow(
      "Ce créneau est complet.",
    );
  });

  it("jauge sans accompagnants : seuls les enfants consomment des places", async () => {
    const slot: CapacitySlot = {
      capacity: 6,
      jauge: true,
      service: { capacity: 99, gaugeAccompagnants: false },
    };
    // Occupé : 4 enfants (les 5 accompagnants ne comptent pas) ; ma résa : 2 enfants
    // (9 accompagnants ignorés) → 4 + 2 = 6 ≤ 6 : accepté.
    const { tx } = capacityTx({ slot, sums: { enfants: 4, accompagnants: 5 } });
    await expect(
      assertSlotCapacity(tx, { ...capacityBase, enfants: 2, accompagnants: 9 }),
    ).resolves.toBeUndefined();
  });

  it("jauge avec accompagnants : enfants + accompagnants consomment", async () => {
    const slot: CapacitySlot = {
      capacity: 5,
      jauge: true,
      service: { capacity: 99, gaugeAccompagnants: true },
    };
    // Occupé : 2 + 2 = 4 ; ma résa : 1 + 1 = 2 → 6 > 5 : refus.
    const { tx } = capacityTx({ slot, sums: { enfants: 2, accompagnants: 2 } });
    await expect(
      assertSlotCapacity(tx, { ...capacityBase, enfants: 1, accompagnants: 1 }),
    ).rejects.toThrow("Ce créneau est complet.");
  });

  it("jauge sur créneau vide : sommes null comptées 0", async () => {
    const slot: CapacitySlot = {
      capacity: 1,
      jauge: true,
      service: { capacity: 99, gaugeAccompagnants: true },
    };
    const { tx } = capacityTx({ slot, sums: { enfants: null, accompagnants: null } });
    await expect(
      assertSlotCapacity(tx, { ...capacityBase, enfants: 1, accompagnants: 0 }),
    ).resolves.toBeUndefined();
  });

  it("récurrent : décompte scopé {slot, période} ; ponctuel : slot seul", async () => {
    const slot: CapacitySlot = {
      capacity: 10,
      jauge: false,
      service: { capacity: 99, gaugeAccompagnants: false },
    };
    const rec = capacityTx({ slot, count: 0 });
    await assertSlotCapacity(rec.tx, capacityBase);
    expect(rec.count).toHaveBeenCalledWith({
      where: { slotId: "sl1", periodId: 4, bookingType: "recurring" },
    });
    const uniq = capacityTx({ slot, count: 0 });
    await assertSlotCapacity(uniq.tx, { ...capacityBase, bookingType: "unique", periodId: null });
    expect(uniq.count).toHaveBeenCalledWith({
      where: { slotId: "sl1", bookingType: "unique" },
    });
  });

  it("excludeBookingId : la réservation déplacée ne se compte pas elle-même", async () => {
    const slot: CapacitySlot = {
      capacity: 1,
      jauge: false,
      service: { capacity: 99, gaugeAccompagnants: false },
    };
    const { tx, count } = capacityTx({ slot, count: 0 });
    await assertSlotCapacity(tx, { ...capacityBase, excludeBookingId: 42 });
    expect(count).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: { not: 42 } }),
    });
  });
});

// ─── assertReservationLimits — quotas usager par période / par exercice ──────

function limitsTx(opts: {
  exercice?: { id: number; maxReservations: number; maxReservationsPeriod: number } | null;
  counts?: number[];
}) {
  const findUnique = vi.fn(async () =>
    opts.exercice === undefined ? null : { exercice: opts.exercice },
  );
  const findMany = vi.fn(async () => [{ id: 4 }, { id: 5 }]);
  const count = vi.fn();
  for (const c of opts.counts ?? []) count.mockResolvedValueOnce(c);
  return {
    tx: fakeTx({ period: { findUnique, findMany }, booking: { count } }),
    findUnique,
    count,
  };
}

const limitsBase = {
  serviceId: "s1",
  userId: "u1",
  periodId: 4,
};

describe("assertReservationLimits", () => {
  it("sans période (periodId 0) : aucune limite, aucune requête", async () => {
    const { tx, findUnique } = limitsTx({});
    await expect(
      assertReservationLimits(tx, { ...limitsBase, periodId: 0 }),
    ).resolves.toBeUndefined();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("période sans exercice (legacy) : aucune limite", async () => {
    const { tx, count } = limitsTx({ exercice: null });
    await expect(assertReservationLimits(tx, limitsBase)).resolves.toBeUndefined();
    expect(count).not.toHaveBeenCalled();
  });

  it("limite PAR PÉRIODE atteinte → refus", async () => {
    const { tx } = limitsTx({
      exercice: { id: 1, maxReservations: 10, maxReservationsPeriod: 2 },
      counts: [2],
    });
    await expect(assertReservationLimits(tx, limitsBase)).rejects.toThrow(
      "Limite de réservations atteinte pour cette période.",
    );
  });

  it("limite ANNUELLE (exercice) atteinte → refus", async () => {
    const { tx } = limitsTx({
      exercice: { id: 1, maxReservations: 3, maxReservationsPeriod: 2 },
      counts: [1, 3],
    });
    await expect(assertReservationLimits(tx, limitsBase)).rejects.toThrow(
      "Limite annuelle de réservations atteinte.",
    );
  });

  it("sous les deux limites → autorisé", async () => {
    const { tx } = limitsTx({
      exercice: { id: 1, maxReservations: 3, maxReservationsPeriod: 2 },
      counts: [1, 2],
    });
    await expect(assertReservationLimits(tx, limitsBase)).resolves.toBeUndefined();
  });

  it("compte les DEUX natures ensemble, miroirs exclus", async () => {
    // Le défaut corrigé : comptées séparément, « 1 par an » en laissait passer deux —
    // une récurrente ET une ponctuelle, sur deux périodes différentes. Le réglage
    // annonce un nombre de RÉSERVATIONS, pas un nombre par nature.
    const { tx, count } = limitsTx({
      exercice: { id: 1, maxReservations: 10, maxReservationsPeriod: 10 },
      counts: [0, 0],
    });
    await assertReservationLimits(tx, limitsBase);

    // Par période : récurrentes rattachées à la période + ponctuelles dont le CRÉNEAU
    // la porte (elles stockent periodId à null).
    expect(count).toHaveBeenNthCalledWith(1, {
      where: expect.objectContaining({
        // Une série compte pour UNE réservation, pas pour ses quarante séances.
        parentBookingId: null,
        OR: [
          { bookingType: "recurring", periodId: { in: [4] } },
          { bookingType: "unique", slot: { periodId: { in: [4] } } },
        ],
      }),
    });
    // Par exercice : TOUTES ses périodes, mêmes deux natures.
    expect(count).toHaveBeenNthCalledWith(2, {
      where: expect.objectContaining({
        OR: [
          { bookingType: "recurring", periodId: { in: [4, 5] } },
          { bookingType: "unique", slot: { periodId: { in: [4, 5] } } },
        ],
      }),
    });
  });

  it("excludeBookingId : le déplacement intra-exercice ne se compte pas lui-même", async () => {
    const { tx, count } = limitsTx({
      exercice: { id: 1, maxReservations: 10, maxReservationsPeriod: 10 },
      counts: [0, 0],
    });
    await assertReservationLimits(tx, { ...limitsBase, excludeBookingId: 42 });
    expect(count).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: { not: 42 } }),
    });
  });
});

// ─── assertBookingUnlocked — validation bloquante ────────────────────────────

function lockTx(opts: { validationBloquante: boolean; setting?: { validation?: boolean } | null }) {
  return fakeTx({
    service: {
      findUnique: vi.fn(async () => ({ validationBloquante: opts.validationBloquante })),
    },
    user: {
      findUnique: vi.fn(async () => ({ demandeurId: 3, structure: null })),
    },
    serviceDemandeurSettings: { findFirst: vi.fn(async () => opts.setting ?? null) },
  });
}

describe("assertBookingUnlocked (validation bloquante)", () => {
  it("réservation non validée → jamais verrouillée", async () => {
    const tx = fakeTx({}); // aucune requête ne doit partir
    await expect(
      assertBookingUnlocked(tx, "u1", { serviceId: "s1", validated: false }),
    ).resolves.toBeUndefined();
  });
  it("service sans validationBloquante → déverrouillée", async () => {
    const tx = lockTx({ validationBloquante: false });
    await expect(
      assertBookingUnlocked(tx, "u1", { serviceId: "s1", validated: true }),
    ).resolves.toBeUndefined();
  });
  it("validée + bloquante + demandeur en mode validation → verrouillée", async () => {
    const tx = lockTx({ validationBloquante: true, setting: { validation: true } });
    await expect(
      assertBookingUnlocked(tx, "u1", { serviceId: "s1", validated: true }),
    ).rejects.toThrow("Réservation validée — modification impossible.");
  });
  it("validée + bloquante mais demandeur HORS mode validation → déverrouillée", async () => {
    const tx = lockTx({ validationBloquante: true, setting: { validation: false } });
    await expect(
      assertBookingUnlocked(tx, "u1", { serviceId: "s1", validated: true }),
    ).resolves.toBeUndefined();
  });
});

// ─── assertNotSchoolHolidayForUser — blocage vacances scolaires ──────────────

function holidayTx(opts: { demandeurOpen?: boolean | null; structureOpen?: boolean | null }) {
  return fakeTx({
    user: {
      findUnique: vi.fn(async () => ({
        demandeur: opts.demandeurOpen == null ? null : { openOnSchoolHolidays: opts.demandeurOpen },
        structure:
          opts.structureOpen == null
            ? null
            : { demandeur: { openOnSchoolHolidays: opts.structureOpen } },
      })),
    },
  });
}

const inHolidays = new Date("2026-07-15T00:00:00Z"); // dans ]2026-07-03, 2026-08-31]
const outOfHolidays = new Date("2026-09-15T00:00:00Z");

describe("assertNotSchoolHolidayForUser", () => {
  it("service ET demandeur ouverts pendant les vacances → aucune restriction", async () => {
    const tx = holidayTx({ demandeurOpen: true });
    await expect(
      assertNotSchoolHolidayForUser(tx, "u1", inHolidays, true),
    ).resolves.toBeUndefined();
  });
  it("service fermé : date en vacances → refus", async () => {
    const tx = holidayTx({ demandeurOpen: true });
    await expect(assertNotSchoolHolidayForUser(tx, "u1", inHolidays, false)).rejects.toThrow(
      "Ce créneau tombe en vacances scolaires.",
    );
  });
  it("service fermé : date hors vacances → autorisé", async () => {
    const tx = holidayTx({ demandeurOpen: true });
    await expect(
      assertNotSchoolHolidayForUser(tx, "u1", outOfHolidays, false),
    ).resolves.toBeUndefined();
  });
  it("service ouvert mais demandeur (via structure) fermé → refus en vacances", async () => {
    const tx = holidayTx({ structureOpen: false });
    await expect(assertNotSchoolHolidayForUser(tx, "u1", inHolidays, true)).rejects.toThrow(
      "Ce créneau tombe en vacances scolaires.",
    );
  });
});

describe("limitesEpuiseesPourListeAttente (liste d'attente)", () => {
  const exercice = (max: number, maxPeriod: number, periods: number[]) => ({
    maxReservations: max,
    maxReservationsPeriod: maxPeriod,
    periods: periods.map((id) => ({ id })),
  });
  const tx = (exo: unknown, count: (ids: number[]) => number) =>
    fakeTx({
      exercice: { findFirst: vi.fn(async () => exo) },
      booking: {
        count: vi.fn(async (args: { where: { OR: { periodId: { in: number[] } }[] } }) =>
          count(args.where.OR[0].periodId.in),
        ),
      },
    });

  it("false sans exercice visible ou sans période", async () => {
    expect(
      await limitesEpuiseesPourListeAttente(
        tx(null, () => 99),
        "svc",
        "u1",
      ),
    ).toBe(false);
    expect(
      await limitesEpuiseesPourListeAttente(
        tx(exercice(1, 1, []), () => 99),
        "svc",
        "u1",
      ),
    ).toBe(false);
  });

  it("true au maximum annuel (décompte sur toutes les périodes)", async () => {
    expect(
      await limitesEpuiseesPourListeAttente(
        tx(exercice(2, 5, [10, 11]), () => 2),
        "svc",
        "u1",
      ),
    ).toBe(true);
  });

  it("true au maximum PAR PÉRIODE sur chaque période (période unique : dès 1 réservation)", async () => {
    // Une seule période, max 1 par période, 1 réservation → plus aucune place possible.
    expect(
      await limitesEpuiseesPourListeAttente(
        tx(exercice(3, 1, [10]), () => 1),
        "svc",
        "u1",
      ),
    ).toBe(true);
    // Deux périodes, max 1 par période : pleine sur 10, libre sur 11 → une place reste possible.
    const parPeriode = (ids: number[]) =>
      ids.length === 1 && ids[0] === 10 ? 1 : ids.length === 1 ? 0 : 1;
    expect(
      await limitesEpuiseesPourListeAttente(tx(exercice(3, 1, [10, 11]), parPeriode), "svc", "u1"),
    ).toBe(false);
  });

  it("false sous les maximums", async () => {
    expect(
      await limitesEpuiseesPourListeAttente(
        tx(exercice(2, 2, [10]), () => 1),
        "svc",
        "u1",
      ),
    ).toBe(false);
  });
});
