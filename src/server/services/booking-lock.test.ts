import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";

// Le module importe BookingError depuis bookings, qui instancie PrismaClient
// (`@/server/db`) et touche next/headers (`@/server/guards`) : neutralisés.
vi.mock("@/server/db", () => ({ prisma: {} }));
vi.mock("@/server/guards", () => ({ getSession: vi.fn(async () => null) }));

import {
  assertNotLockedByPointage,
  assertNotLockedByPointageInTx,
  bookingLocked,
  LOCK_CANDIDATE_SELECT,
  type LockCandidate,
  MESSAGE_VERROU_POINTAGE,
  parentLockedByPointage,
  pointageLockReason,
} from "./booking-lock";
import { BookingError } from "./bookings";

function fakeTx(models: Record<string, unknown>): Prisma.TransactionClient {
  return models as unknown as Prisma.TransactionClient;
}

/** Client factice : `pointedChildren` = nombre de miroirs pointés renvoyé par le count. */
function lockTx(opts: { pointedChildren?: number; found?: LockCandidate | null } = {}) {
  const count = vi.fn(async () => opts.pointedChildren ?? 0);
  const findFirst = vi.fn(async () => (opts.found === undefined ? null : opts.found));
  return { tx: fakeTx({ booking: { count, findFirst } }), count, findFirst };
}

const parentLibre: LockCandidate = {
  id: 10,
  bookingType: "recurring",
  parentBookingId: null,
  pointage: null,
};
const ponctuelle: LockCandidate = {
  id: 11,
  bookingType: "unique",
  parentBookingId: null,
  pointage: null,
};
const miroir: LockCandidate = {
  id: 12,
  bookingType: "unique",
  parentBookingId: 10,
  pointage: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parentLockedByPointage", () => {
  it("compte les enfants POINTÉS du parent (pointage non null)", async () => {
    const { tx, count } = lockTx({ pointedChildren: 1 });
    await expect(parentLockedByPointage(tx, 10)).resolves.toBe(true);
    expect(count).toHaveBeenCalledWith({
      where: { parentBookingId: 10, pointage: { not: null } },
    });
    const none = lockTx({ pointedChildren: 0 });
    await expect(parentLockedByPointage(none.tx, 10)).resolves.toBe(false);
  });
});

describe("pointageLockReason / bookingLocked", () => {
  it("MIROIR (enfant) : toujours verrouillé, sans requête", async () => {
    const { tx, count } = lockTx();
    await expect(pointageLockReason(tx, miroir)).resolves.toBe("miroir");
    await expect(bookingLocked(tx, miroir)).resolves.toBe(true);
    expect(count).not.toHaveBeenCalled();
  });

  it("réservation autonome POINTÉE : verrouillée (cause « pointage »)", async () => {
    const { tx, count } = lockTx();
    await expect(pointageLockReason(tx, { ...ponctuelle, pointage: "present" })).resolves.toBe(
      "pointage",
    );
    // Ponctuelle : pas d'enfants → pas de count.
    expect(count).not.toHaveBeenCalled();
  });

  it("PARENT récurrent dont un miroir est pointé : verrouillé (cause « seance »)", async () => {
    const { tx, count } = lockTx({ pointedChildren: 2 });
    await expect(pointageLockReason(tx, parentLibre)).resolves.toBe("seance");
    await expect(bookingLocked(tx, parentLibre)).resolves.toBe(true);
    expect(count).toHaveBeenCalledWith({
      where: { parentBookingId: 10, pointage: { not: null } },
    });
  });

  it("parent récurrent sans miroir pointé, ponctuelle non pointée : libres", async () => {
    const { tx } = lockTx({ pointedChildren: 0 });
    await expect(pointageLockReason(tx, parentLibre)).resolves.toBeNull();
    await expect(bookingLocked(tx, parentLibre)).resolves.toBe(false);
    await expect(bookingLocked(tx, ponctuelle)).resolves.toBe(false);
  });
});

describe("assertNotLockedByPointage — messages", () => {
  it("libre → ne lève pas", async () => {
    const { tx } = lockTx({ pointedChildren: 0 });
    await expect(assertNotLockedByPointage(tx, parentLibre)).resolves.toBeUndefined();
  });

  it("verrouillée → BookingError, message gestionnaire par défaut", async () => {
    const { tx } = lockTx();
    await expect(assertNotLockedByPointage(tx, miroir)).rejects.toThrow(BookingError);
    await expect(assertNotLockedByPointage(tx, miroir)).rejects.toThrow(MESSAGE_VERROU_POINTAGE);
  });

  it("messages surchargeables PAR CAUSE (formulations usager conservées)", async () => {
    const usager = {
      miroir: "Une séance (miroir) n'est pas modifiable.",
      pointage: "Réservation pointée, non modifiable.",
      seance: "Réservation pointée, non modifiable.",
    };
    await expect(assertNotLockedByPointage(lockTx().tx, miroir, usager)).rejects.toThrow(
      "Une séance (miroir) n'est pas modifiable.",
    );
    await expect(
      assertNotLockedByPointage(lockTx().tx, { ...ponctuelle, pointage: "absent" }, usager),
    ).rejects.toThrow("Réservation pointée, non modifiable.");
    await expect(
      assertNotLockedByPointage(lockTx({ pointedChildren: 1 }).tx, parentLibre, usager),
    ).rejects.toThrow("Réservation pointée, non modifiable.");
    // Cause non surchargée → repli sur le message par défaut.
    await expect(
      assertNotLockedByPointage(lockTx({ pointedChildren: 1 }).tx, parentLibre, {
        miroir: "x",
      }),
    ).rejects.toThrow(MESSAGE_VERROU_POINTAGE);
  });
});

describe("assertNotLockedByPointageInTx — relecture bornée au service (anti-TOCTOU / anti-IDOR)", () => {
  it("lit la réservation par {id, serviceId} avec le select du verrou", async () => {
    const { tx, findFirst } = lockTx({ found: ponctuelle });
    await expect(assertNotLockedByPointageInTx(tx, 11, "s1")).resolves.toBeUndefined();
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 11, serviceId: "s1" },
      select: LOCK_CANDIDATE_SELECT,
    });
  });

  it("réservation absente ou d'un autre service → « Réservation introuvable. »", async () => {
    const { tx } = lockTx({ found: null });
    await expect(assertNotLockedByPointageInTx(tx, 11, "s1")).rejects.toThrow(
      "Réservation introuvable.",
    );
  });

  it("pointage posé entre-temps (relecture) → refus", async () => {
    const { tx } = lockTx({ found: { ...ponctuelle, pointage: "present" } });
    await expect(assertNotLockedByPointageInTx(tx, 11, "s1")).rejects.toThrow(
      MESSAGE_VERROU_POINTAGE,
    );
  });
});
