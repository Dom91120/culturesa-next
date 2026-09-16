import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";

// Session simulée (guards) : l'acteur d'une suppression est lu depuis la session courante.
const getSession = vi.fn();
vi.mock("@/server/guards", () => ({ getSession: () => getSession() }));

import { markWaitlistBookingsDeleted, requeueRefusedAutoBookings } from "./waiting-list-close";

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

// ── Retour en file après refus d'une inscription automatique (Dom 2026-09-16) ──
type LogRow = {
  id: number;
  serviceId: string;
  userId: string | null;
  disponibilites: string;
  periodIds: string;
  autoInscription: boolean;
  inscritAt: Date;
};
function requeueTx(opts: { logs: LogRow[]; live?: boolean }) {
  const create = vi.fn(async (_args: unknown) => ({ id: 99 }));
  const del = vi.fn(async (_args: unknown) => ({}));
  const tx = {
    waitingListLog: { findMany: vi.fn(async (_args: unknown) => opts.logs), delete: del },
    waitingListEntry: {
      findUnique: vi.fn(async () => (opts.live ? { id: 5 } : null)),
      create,
    },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, create, del, tx0: tx };
}
const inscritAt = new Date("2026-09-10T08:00:00.000Z");
const log = (over: Partial<LogRow> = {}): LogRow => ({
  id: 3,
  serviceId: "svc_001",
  userId: "u1",
  disponibilites: "lun-pm,mar-pm",
  periodIds: "",
  autoInscription: true,
  inscritAt,
  ...over,
});

describe("requeueRefusedAutoBookings", () => {
  it("recrée l'entrée à la date d'inscription d'origine et supprime la ligne d'historique", async () => {
    const { tx, create, del, tx0 } = requeueTx({ logs: [log()] });
    const back = await requeueRefusedAutoBookings(tx, { id: 42 });
    expect(back).toEqual([{ serviceId: "svc_001", userId: "u1", inscritAt }]);
    // Ne cible que les placements AUTOMATIQUES liés à la réservation refusée.
    expect((tx0.waitingListLog.findMany.mock.calls[0][0] as { where: unknown }).where).toEqual({
      booking: { id: 42 },
      issue: "AUTO_BOOKED",
      userId: { not: null },
    });
    const data = (create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data).toEqual({
      serviceId: "svc_001",
      userId: "u1",
      disponibilites: "lun-pm,mar-pm",
      periodIds: "",
      autoInscription: true,
      createdAt: inscritAt,
    });
    expect(del).toHaveBeenCalledWith({ where: { id: 3 } });
  });

  it("entrée vivante déjà présente : ni création ni suppression", async () => {
    const { tx, create, del } = requeueTx({ logs: [log()], live: true });
    expect(await requeueRefusedAutoBookings(tx, { id: 42 })).toEqual([]);
    expect(create).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("aucun placement automatique lié : rien à faire", async () => {
    const { tx, create } = requeueTx({ logs: [] });
    expect(await requeueRefusedAutoBookings(tx, { id: 42 })).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });
});
