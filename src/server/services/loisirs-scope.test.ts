import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db";
import { listDatedSessions, listInscrits } from "./editions";
import { loisirsDemandeurIds, loisirsUserWhere } from "./loisirs-scope";

/**
 * Périmètre « accueils de loisirs » (rôle direction_loisirs, 2026-11-18). Le filtrage
 * est porté par les REQUÊTES : ces tests fixent la forme du `where`, seule barrière
 * entre la Direction et les réservations des autres catégories.
 */

vi.mock("@/server/db", () => ({
  prisma: {
    serviceDemandeurSettings: { findMany: vi.fn() },
    booking: { findMany: vi.fn() },
  },
}));

const settings = vi.mocked(prisma.serviceDemandeurSettings.findMany);
const bookings = vi.mocked(prisma.booking.findMany);

beforeEach(() => {
  settings.mockReset();
  bookings.mockReset();
  bookings.mockResolvedValue([]);
});

describe("loisirsDemandeurIds", () => {
  it("ne retient que les catégories marquées ET acceptées par le service", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: forme réduite du select { demandeurId }
    settings.mockResolvedValue([{ demandeurId: 3 }, { demandeurId: 4 }] as any);
    expect(await loisirsDemandeurIds("svc_001")).toEqual([3, 4]);
    expect(settings).toHaveBeenCalledWith({
      where: { serviceId: "svc_001", demandeur: { accueilLoisirs: true } },
      select: { demandeurId: true },
    });
  });
  it("service sans accueil de loisirs → liste vide", async () => {
    settings.mockResolvedValue([]);
    expect(await loisirsDemandeurIds("svc_002")).toEqual([]);
  });
});

describe("loisirsUserWhere", () => {
  it("vise le demandeur EFFECTIF : le sien, sinon celui de sa structure", () => {
    expect(loisirsUserWhere([3, 4])).toEqual({
      OR: [
        { demandeurId: { in: [3, 4] } },
        { demandeurId: null, structure: { demandeurId: { in: [3, 4] } } },
      ],
    });
  });
  it("un usager rattaché en propre à une AUTRE catégorie n'est pas rattrapé par sa structure", () => {
    // La seconde branche exige `demandeurId: null` : sans elle, un usager « école »
    // dont la structure relève d'un accueil de loisirs serait montré à tort.
    const [, viaStructure] = loisirsUserWhere([3]).OR;
    expect(viaStructure).toMatchObject({ demandeurId: null });
  });
});

describe("listInscrits (édition des accueils de loisirs)", () => {
  it("sans périmètre : tous les usagers non anonymisés", async () => {
    await listInscrits("svc_001");
    expect(bookings.mock.calls[0][0]?.where).toEqual({
      serviceId: "svc_001",
      user: { anonymizedAt: null },
    });
  });
  it("avec périmètre : le filtre de catégorie s'ajoute au where", async () => {
    await listInscrits("svc_001", [10, 11], false, [3, 4]);
    expect(bookings.mock.calls[0][0]?.where).toEqual({
      serviceId: "svc_001",
      slot: { periodId: { in: [10, 11] } },
      user: { anonymizedAt: null, ...loisirsUserWhere([3, 4]) },
    });
  });
  it("périmètre vide : aucune catégorie → filtre conservé (liste vide, pas « tout »)", async () => {
    await listInscrits("svc_001", undefined, false, []);
    expect(bookings.mock.calls[0][0]?.where).toMatchObject({
      user: { OR: [{ demandeurId: { in: [] } }, expect.anything()] },
    });
  });
});

describe("listDatedSessions (impression de l'agenda)", () => {
  it("sans périmètre : aucune restriction de catégorie", async () => {
    await listDatedSessions("svc_001", "2026-11-16", "2026-11-22");
    expect(bookings.mock.calls[0][0]?.where).not.toHaveProperty("user");
  });
  it("avec périmètre : seules les réservations des accueils de loisirs", async () => {
    await listDatedSessions("svc_001", "2026-11-16", "2026-11-22", undefined, [3, 4]);
    expect(bookings.mock.calls[0][0]?.where).toMatchObject({
      serviceId: "svc_001",
      user: loisirsUserWhere([3, 4]),
    });
  });
});
