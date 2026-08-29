import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";

// Mêmes neutralisations que bookings.test.ts : le module importe (via bookings)
// `@/server/db` et `@/server/guards` ; syncRecurringChildren est espionné pour
// vérifier le contrat « la ligne créée EST le ParentForSync ».
vi.mock("@/server/db", () => ({ prisma: {} }));
vi.mock("@/server/guards", () => ({ getSession: vi.fn(async () => null) }));
vi.mock("@/server/services/recurring-children", () => ({
  syncRecurringChildren: vi.fn(async () => ({ created: 0, updated: 0, deleted: 0 })),
}));

import { BookingError } from "./bookings";
import {
  insertRecurringBookingInTx,
  type RecurringTarget,
  resolveRecurringTarget,
  slotWeekOf,
} from "./recurring-booking";
import { syncRecurringChildren } from "./recurring-children";

function fakeTx(models: Record<string, unknown>): Prisma.TransactionClient {
  return models as unknown as Prisma.TransactionClient;
}

type FoundSlot = {
  slotType: string;
  periodId: number | null;
  weeks: string | null;
  startTime: string;
  endTime: string;
  slotDay: string | null;
  service: { label: string };
  demandeurs: { demandeurId: number }[];
};

const goodSlot: FoundSlot = {
  slotType: "recurring",
  periodId: 59,
  weeks: "B",
  startTime: "09:00",
  endTime: "10:00",
  slotDay: "mar",
  service: { label: "Médiathèque" },
  demandeurs: [{ demandeurId: 3 }],
};

function targetTx(slot: FoundSlot | null) {
  const findFirst = vi.fn(async () => slot);
  return { tx: fakeTx({ slot: { findFirst } }), findFirst };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("slotWeekOf — parité dérivée du créneau", () => {
  it("A/B conservés, tout le reste → toutes semaines", () => {
    expect(slotWeekOf("A")).toBe("A");
    expect(slotWeekOf("B")).toBe("B");
    expect(slotWeekOf("")).toBe("");
    expect(slotWeekOf(null)).toBe("");
    expect(slotWeekOf("AB")).toBe("");
  });
});

describe("resolveRecurringTarget", () => {
  it("créneau absent ou d'un autre service → refus (anti-IDOR, scope {id, serviceId})", async () => {
    const { tx, findFirst } = targetTx(null);
    await expect(
      resolveRecurringTarget(tx, { serviceId: "s1", slotId: "sl1", periodId: 59 }),
    ).rejects.toThrow("Ce créneau n'est pas disponible.");
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "sl1", serviceId: "s1" } }),
    );
  });
  it("créneau ponctuel → refus (une récurrente ne se pose pas sur un ponctuel)", async () => {
    const { tx } = targetTx({ ...goodSlot, slotType: "unique" });
    await expect(
      resolveRecurringTarget(tx, { serviceId: "s1", slotId: "sl1", periodId: 59 }),
    ).rejects.toThrow("Ce créneau n'est pas disponible.");
  });
  it("période annoncée absente/invalide (≤ 0) → « Période requise »", async () => {
    const { tx } = targetTx(goodSlot);
    await expect(
      resolveRecurringTarget(tx, { serviceId: "s1", slotId: "sl1", periodId: 0 }),
    ).rejects.toThrow("Période requise pour une réservation récurrente.");
  });
  it("créneau récurrent SANS période (donnée incomplète) → « Période requise »", async () => {
    const { tx } = targetTx({ ...goodSlot, periodId: null });
    await expect(resolveRecurringTarget(tx, { serviceId: "s1", slotId: "sl1" })).rejects.toThrow(
      "Période requise pour une réservation récurrente.",
    );
  });
  it("période annoncée ≠ période du créneau → refus (anti-injection periodId)", async () => {
    const { tx } = targetTx(goodSlot);
    await expect(
      resolveRecurringTarget(tx, { serviceId: "s1", slotId: "sl1", periodId: 999 }),
    ).rejects.toThrow(BookingError);
  });
  it("période annoncée conforme → cible résolue, parité SUIVANT le créneau", async () => {
    const { tx } = targetTx(goodSlot);
    const t = await resolveRecurringTarget(tx, { serviceId: "s1", slotId: "sl1", periodId: 59 });
    expect(t).toEqual({
      slotId: "sl1",
      serviceId: "s1",
      periodId: 59,
      week: "B",
      demandeurIds: [3],
      serviceLabel: "Médiathèque",
      startTime: "09:00",
      endTime: "10:00",
      slotDay: "mar",
    });
  });
  it("sans période annoncée (déplacement admin) : la période SUIT le créneau", async () => {
    const { tx } = targetTx({ ...goodSlot, weeks: "" });
    const t = await resolveRecurringTarget(tx, { serviceId: "s1", slotId: "sl1" });
    expect(t.periodId).toBe(59);
    expect(t.week).toBe("");
  });
});

describe("insertRecurringBookingInTx", () => {
  const target: RecurringTarget = {
    slotId: "sl1",
    serviceId: "s1",
    periodId: 59,
    week: "B",
    demandeurIds: [],
    serviceLabel: "Médiathèque",
    startTime: "09:00",
    endTime: "10:00",
    slotDay: "mar",
  };
  const params = {
    userId: "u1",
    theme: "Contes",
    enfants: 2,
    accompagnants: 1,
    validated: true,
    trigger: "confirm_manager_create" as const,
  };

  function insertTx() {
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 1740,
      ...data,
    }));
    // Fiche usager lue par bookingUserSnapshot (snapshot structure/catégorie/niveau).
    const findUnique = vi.fn(async () => ({
      niveau: "CE1",
      structure: { label: "École Jean Jaurès" },
      demandeur: { label: "Scolaire" },
    }));
    return { tx: fakeTx({ booking: { create }, user: { findUnique } }), create };
  }

  it("crée la réservation depuis la CIBLE (période/parité du créneau, jamais du client)", async () => {
    const { tx, create } = insertTx();
    await insertRecurringBookingInTx(tx, target, params);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bookingType: "recurring",
        userId: "u1",
        serviceId: "s1",
        slotId: "sl1",
        periodId: 59,
        week: "B",
        enfants: 2,
        accompagnants: 1,
        themeLabel: "Contes",
        // Snapshot fiche usager posé à la création (bookingUserSnapshot).
        structureLabel: "École Jean Jaurès",
        demandeurLabel: "Scolaire",
        niveauLabel: "CE1",
        validated: true,
      }),
    });
  });

  it("matérialise les enfants à partir de la LIGNE CRÉÉE (pas d'un payload parallèle)", async () => {
    const { tx } = insertTx();
    await insertRecurringBookingInTx(tx, target, params);
    const [, parent, opts] = vi.mocked(syncRecurringChildren).mock.calls[0] ?? [];
    expect(parent).toEqual(expect.objectContaining({ id: 1740, week: "B", periodId: 59 }));
    // Usager : pas de cutoff → le délai de réservation s'applique dans la sync.
    expect(opts).toBeUndefined();
  });

  it("cutoffISO (gestionnaire, pas de délai) transmis à la sync", async () => {
    const { tx } = insertTx();
    await insertRecurringBookingInTx(tx, target, { ...params, cutoffISO: "2026-07-24" });
    const [, , opts] = vi.mocked(syncRecurringChildren).mock.calls[0] ?? [];
    expect(opts).toEqual({ cutoffISO: "2026-07-24" });
  });

  it("renvoie les paramètres d'e-mail du créneau résolu (récurrent : sans date)", async () => {
    const { tx } = insertTx();
    const mail = await insertRecurringBookingInTx(tx, target, params);
    expect(mail).toEqual({
      userId: "u1",
      serviceId: "s1",
      serviceLabel: "Médiathèque",
      trigger: "confirm_manager_create",
      slot: { startTime: "09:00", endTime: "10:00", slotDate: null, slotDay: "mar" },
      periodId: 59,
      enfants: 2,
      accompagnants: 1,
      theme: "Contes",
    });
  });
});
