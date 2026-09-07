import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";

// Session simulée (guards) : l'acteur d'une suppression est lu depuis la session courante.
const getSession = vi.fn();
vi.mock("@/server/guards", () => ({ getSession: () => getSession() }));

import { markWaitlistBookingsDeleted } from "./waiting-list-close";

function fakeTx(opts: { linked: number[]; user?: { nom: string; prenom: string; role: string } }) {
  const updateMany = vi.fn(async (_args: unknown) => ({ count: opts.linked.length }));
  const tx = {
    waitingListLog: {
      findMany: vi.fn(async (_args: unknown) => opts.linked.map((id) => ({ id }))),
      updateMany,
    },
    user: { findUnique: vi.fn(async () => opts.user ?? null) },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, updateMany, user: tx.user.findUnique };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: "m1" } });
});

describe("markWaitlistBookingsDeleted", () => {
  it("gestionnaire : date, mode et « NOM Prénom » de la session sur les lignes liées", async () => {
    const { tx, updateMany } = fakeTx({
      linked: [7, 9],
      user: { nom: "DUPONT", prenom: "Marie", role: "gestionnaire" },
    });
    const n = await markWaitlistBookingsDeleted(tx, { id: 42 }, "gestionnaire");
    expect(n).toBe(2);
    const call = updateMany.mock.calls[0][0] as unknown as {
      where: unknown;
      data: Record<string, unknown>;
    };
    expect(call.where).toEqual({ id: { in: [7, 9] } });
    expect(call.data.reservationSupprimeeMode).toBe("gestionnaire");
    expect(call.data.reservationSupprimeePar).toBe("DUPONT Marie");
    expect(call.data.reservationSupprimeeAt).toBeInstanceOf(Date);
  });

  it("usager : pas d'acteur, session non consultée", async () => {
    const { tx, updateMany, user } = fakeTx({ linked: [7] });
    await markWaitlistBookingsDeleted(tx, { id: 42 }, "usager");
    expect(getSession).not.toHaveBeenCalled();
    expect(user).not.toHaveBeenCalled();
    const call = updateMany.mock.calls[0][0] as unknown as { data: Record<string, unknown> };
    expect(call.data.reservationSupprimeePar).toBe("");
    expect(call.data.reservationSupprimeeMode).toBe("usager");
  });

  it("acteur vide si la session est celle d'un usager ou absente (tâche planifiée)", async () => {
    const a = fakeTx({ linked: [1], user: { nom: "X", prenom: "Y", role: "utilisateur" } });
    await markWaitlistBookingsDeleted(a.tx, { id: 1 }, "creneau");
    expect(
      (a.updateMany.mock.calls[0][0] as unknown as { data: { reservationSupprimeePar: string } })
        .data.reservationSupprimeePar,
    ).toBe("");
    getSession.mockRejectedValue(new Error("headers() hors requête"));
    const b = fakeTx({ linked: [1], user: { nom: "X", prenom: "Y", role: "admin" } });
    await markWaitlistBookingsDeleted(b.tx, { id: 1 }, "periode");
    expect(
      (b.updateMany.mock.calls[0][0] as unknown as { data: { reservationSupprimeePar: string } })
        .data.reservationSupprimeePar,
    ).toBe("");
  });

  it("aucune ligne liée (ou déjà tracée) : rien à faire", async () => {
    const { tx, updateMany } = fakeTx({ linked: [] });
    expect(await markWaitlistBookingsDeleted(tx, { id: 1 }, "refus")).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
    const where = (tx.waitingListLog.findMany as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(where).toEqual({
      where: { booking: { id: 1 }, reservationSupprimeeAt: null },
      select: { id: true },
    });
  });
});
