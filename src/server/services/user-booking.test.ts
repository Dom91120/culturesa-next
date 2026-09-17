import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";

// Mêmes neutralisations que recurring-booking.test.ts : `bookings` importe le client
// Prisma et les guards. Les GARDES du cœur (accès, période, jauge, limites, thème,
// mode validation) sont espionnées : l'essai à blanc doit TOUTES les appeler, puis
// s'arrêter avant l'insertion partagée.
vi.mock("@/server/db", () => ({ prisma: {} }));
vi.mock("@/server/guards", () => ({ getSession: vi.fn(async () => null) }));
vi.mock("@/server/services/bookings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./bookings")>();
  return {
    ...actual,
    userCanAccessService: vi.fn(async () => true),
    assertPeriodOpenForUser: vi.fn(async () => {}),
    effectiveDemandeurId: vi.fn(async () => 3),
    assertSlotCapacity: vi.fn(async () => {}),
    assertReservationLimits: vi.fn(async () => {}),
    assertThemeIfRequired: vi.fn(async () => {}),
    isValidationMode: vi.fn(async () => false),
    createUniqueBookingInTx: vi.fn(async () => ({ id: 99 })),
  };
});
vi.mock("@/server/services/recurring-booking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./recurring-booking")>();
  return { ...actual, insertRecurringBookingInTx: vi.fn(actual.insertRecurringBookingInTx) };
});
vi.mock("@/server/services/recurring-children", () => ({
  syncRecurringChildren: vi.fn(async () => ({ created: 0, updated: 0, deleted: 0 })),
}));

import {
  assertSlotCapacity,
  assertThemeIfRequired,
  BookingError,
  createUniqueBookingInTx,
} from "./bookings";
import { insertRecurringBookingInTx } from "./recurring-booking";
import { reservePonctuelInTx, reserveRecurringInTx } from "./user-booking";

function fakeTx(models: Record<string, unknown>): Prisma.TransactionClient {
  return models as unknown as Prisma.TransactionClient;
}

const recurringSlot = {
  slotType: "recurring",
  periodId: 59,
  weeks: "",
  startTime: "09:00",
  endTime: "10:00",
  slotDay: "mar",
  service: { label: "Médiathèque" },
  demandeurs: [{ demandeurId: 3 }],
};

function recurringTx() {
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 1740,
    ...data,
  }));
  const tx = fakeTx({
    slot: { findFirst: vi.fn(async () => recurringSlot) },
    user: {
      findUnique: vi.fn(async () => ({
        enfants: 2,
        niveau: "CE1",
        structure: { label: "École" },
        demandeur: { label: "Scolaire" },
      })),
    },
    booking: { create },
    waitingListEntry: { findMany: vi.fn(async () => []) },
  });
  return { tx, create };
}

const args = { slotId: "sl1", periodId: 59, theme: "Contes", enfants: 2, accompagnants: 1 };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("reserveRecurringInTx — essai à blanc (dryRun)", () => {
  it("passe TOUTES les vérifications puis s'arrête AVANT toute écriture", async () => {
    const { tx, create } = recurringTx();
    const mail = await reserveRecurringInTx(tx, "u1", "s1", args, { dryRun: true });
    // Gardes bien exécutées (jauge et thème comprises).
    expect(assertSlotCapacity).toHaveBeenCalledTimes(1);
    expect(assertThemeIfRequired).toHaveBeenCalledWith(tx, "u1", "s1", "Contes");
    // Aucune écriture : ni booking.create, ni insertion partagée (snapshot, clôture de
    // file, matérialisation des enfants).
    expect(create).not.toHaveBeenCalled();
    expect(insertRecurringBookingInTx).not.toHaveBeenCalled();
    // Mêmes paramètres d'e-mail que le chemin réel.
    expect(mail).toEqual({
      userId: "u1",
      serviceId: "s1",
      serviceLabel: "Médiathèque",
      trigger: "confirm_create",
      slot: { startTime: "09:00", endTime: "10:00", slotDate: null, slotDay: "mar" },
      periodId: 59,
      enfants: 2,
      accompagnants: 1,
      theme: "Contes",
    });
  });

  it("un refus d'une garde remonte tel quel en essai à blanc", async () => {
    vi.mocked(assertSlotCapacity).mockRejectedValueOnce(new BookingError("Créneau complet."));
    const { tx, create } = recurringTx();
    await expect(reserveRecurringInTx(tx, "u1", "s1", args, { dryRun: true })).rejects.toThrow(
      "Créneau complet.",
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("chemin RÉEL inchangé : sans dryRun, l'insertion partagée crée la réservation", async () => {
    const { tx, create } = recurringTx();
    const mail = await reserveRecurringInTx(tx, "u1", "s1", args);
    expect(insertRecurringBookingInTx).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(mail.trigger).toBe("confirm_create");
  });
});

describe("reservePonctuelInTx — essai à blanc (dryRun)", () => {
  function ponctuelTx() {
    return fakeTx({
      slot: {
        findUnique: vi.fn(async () => ({
          serviceId: "s1",
          startTime: "14:00",
          endTime: "15:00",
          slotDate: new Date("2026-09-22T00:00:00Z"),
          slotDay: null,
          service: { label: "Médiathèque" },
        })),
      },
      user: { findUnique: vi.fn(async () => ({ enfants: 1 })) },
    });
  }

  it("délègue les vérifications au cœur ponctuel et renvoie null (pas de lecture e-mail)", async () => {
    const tx = ponctuelTx();
    const mail = await reservePonctuelInTx(
      tx,
      "u1",
      "s1",
      { slotId: "sl9", theme: "", enfants: 1, accompagnants: 1 },
      { dryRun: true },
    );
    expect(createUniqueBookingInTx).toHaveBeenCalledTimes(1);
    // L'option est PROPAGÉE : c'est le cœur ponctuel qui s'arrête avant toute écriture.
    expect(vi.mocked(createUniqueBookingInTx).mock.calls[0]?.[4]).toEqual({ dryRun: true });
    expect(mail).toBeNull();
  });

  it("chemin réel : renvoie les paramètres d'e-mail du créneau", async () => {
    const tx = ponctuelTx();
    const mail = await reservePonctuelInTx(tx, "u1", "s1", {
      slotId: "sl9",
      theme: "",
      enfants: 1,
      accompagnants: 1,
    });
    expect(mail?.slot.startTime).toBe("14:00");
    expect(mail?.trigger).toBe("confirm_create");
    expect(vi.mocked(createUniqueBookingInTx).mock.calls[0]?.[4]).toEqual({ dryRun: undefined });
  });
});
