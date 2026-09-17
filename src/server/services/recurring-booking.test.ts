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
  relocateBookingInTx,
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
  it("période annoncée `null` (absente côté client) → « Période requise », sans sentinelle 0", async () => {
    const { tx } = targetTx(goodSlot);
    await expect(
      resolveRecurringTarget(tx, { serviceId: "s1", slotId: "sl1", periodId: null }),
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
    // Clôture de la liste d'attente (waiting-list-close) : aucun inscrit.
    const waitingListEntry = { findMany: vi.fn(async () => []) };
    return { tx: fakeTx({ booking: { create }, user: { findUnique }, waitingListEntry }), create };
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

// ─── relocateBookingInTx — déplacement gestionnaire (glisser-déposer + échange) ──

describe("relocateBookingInTx", () => {
  const booking = { id: 77, enfants: 3, accompagnants: 1 };
  const base = {
    serviceId: "s1",
    booking,
    targetSlotId: "sl2",
    excludeBookingIds: [77],
    now: new Date("2026-09-17T10:00:00Z"),
    cutoffISO: "2026-09-17",
  };

  /**
   * Client factice : `slot.findFirst` sert la résolution de la cible (récurrent : select
   * complet ; ponctuel : slotType seul) PUIS le créneau relu par assertSlotCapacity
   * (capacité/jauge). `count` = occupation hors jauge.
   */
  function relocateTx(opts: {
    target: Partial<FoundSlot> | null;
    capacity?: number;
    occupied?: number;
  }) {
    const capacitySlot =
      opts.target === null
        ? null
        : {
            capacity: opts.capacity ?? 10,
            jauge: false,
            service: { capacity: 99, gaugeAccompagnants: false },
          };
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(opts.target === null ? null : { ...goodSlot, ...opts.target })
      .mockResolvedValueOnce(capacitySlot);
    const count = vi.fn(async () => opts.occupied ?? 0);
    // Ligne renvoyée par l'update (Booking) : la réservation + les champs écrits.
    const update = vi.fn(
      async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => ({
        ...booking,
        bookingType: data.periodId == null ? "unique" : "recurring",
        ...data,
        id: where.id,
      }),
    );
    return {
      tx: fakeTx({ slot: { findFirst }, booking: { count, update } }),
      findFirst,
      count,
      update,
    };
  }

  it("cible RÉCURRENTE : période et parité SUIVENT le créneau, occurrences régénérées", async () => {
    const { tx, findFirst, count, update } = relocateTx({ target: { periodId: 59, weeks: "A" } });
    const updated = await relocateBookingInTx(tx, { ...base, wantType: "recurring" });
    // Résolution bornée au service (anti-IDOR), sans période annoncée (elle suit la cible).
    expect(findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { id: "sl2", serviceId: "s1" } }),
    );
    // Jauge décomptée sur {créneau cible, période cible}, la réservation déplacée exclue.
    expect(count).toHaveBeenCalledWith({
      where: { slotId: "sl2", periodId: 59, bookingType: "recurring", id: { notIn: [77] } },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 77 },
      data: { slotId: "sl2", periodId: 59, week: "A", autoValidateFrom: base.now },
    });
    // La ligne mise à jour EST le ParentForSync ; gestionnaire → cutoff = aujourd'hui.
    expect(syncRecurringChildren).toHaveBeenCalledWith(tx, updated, { cutoffISO: "2026-09-17" });
    expect(updated).toEqual(expect.objectContaining({ id: 77, slotId: "sl2", periodId: 59 }));
  });

  it("cible PONCTUELLE : aucune période (NULL), parité vide, pas de régénération", async () => {
    const { tx, count, update } = relocateTx({ target: { slotType: "unique" } });
    await relocateBookingInTx(tx, { ...base, wantType: "unique" });
    expect(count).toHaveBeenCalledWith({
      where: { slotId: "sl2", bookingType: "unique", id: { notIn: [77] } },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 77 },
      data: { slotId: "sl2", periodId: null, week: "", autoValidateFrom: base.now },
    });
    expect(syncRecurringChildren).not.toHaveBeenCalled();
  });

  it("jauge dépassée sur le créneau d'arrivée → « Ce créneau est complet. », rien n'est écrit", async () => {
    const { tx, update } = relocateTx({ target: { slotType: "unique" }, capacity: 2, occupied: 2 });
    await expect(relocateBookingInTx(tx, { ...base, wantType: "unique" })).rejects.toThrow(
      "Ce créneau est complet.",
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("créneau d'un autre service (ou absent) → refus, rien n'est écrit", async () => {
    for (const wantType of ["recurring", "unique"] as const) {
      const { tx, update } = relocateTx({ target: null });
      await expect(relocateBookingInTx(tx, { ...base, wantType })).rejects.toThrow(
        "Ce créneau n'est pas disponible.",
      );
      expect(update).not.toHaveBeenCalled();
    }
  });

  it("type incompatible (récurrente déposée sur un ponctuel, et l'inverse) → refus", async () => {
    const surPonctuel = relocateTx({ target: { slotType: "unique" } });
    await expect(
      relocateBookingInTx(surPonctuel.tx, { ...base, wantType: "recurring" }),
    ).rejects.toThrow("Ce créneau n'est pas disponible.");
    const surRecurrent = relocateTx({ target: { slotType: "recurring" } });
    await expect(
      relocateBookingInTx(surRecurrent.tx, { ...base, wantType: "unique" }),
    ).rejects.toThrow("Ce créneau n'est pas disponible.");
  });

  it("échange : les DEUX réservations sont exclues du décompte du créneau d'arrivée", async () => {
    const { tx, count } = relocateTx({ target: { slotType: "unique" } });
    await relocateBookingInTx(tx, { ...base, wantType: "unique", excludeBookingIds: [77, 78] });
    expect(count).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: { notIn: [77, 78] } }),
    });
  });
});
