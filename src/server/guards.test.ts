import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db";
import {
  requireBookingUser,
  requireRole,
  requireServiceAccess,
  requireServiceManager,
  requireServiceView,
  serviceAccessLevel,
} from "./guards";

/**
 * Niveaux de rattachement (ManagerLevel, 2026-09-16) : la garde d'écriture
 * `requireServiceManager` doit REFUSER un rattachement en consultation, la garde de
 * lecture `requireServiceAccess` doit l'accepter en le signalant. Le reste des gardes
 * (rôles, 2FA, politique de session) est couvert ailleurs — ici la session est saine.
 */

vi.mock("@/server/db", () => ({
  prisma: {
    serviceManager: { findUnique: vi.fn() },
    serviceDemandeurSettings: { findMany: vi.fn() },
    session: { deleteMany: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
// `redirect` de Next lève : on reproduit ce comportement pour observer le refus.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));

const sessionState: { role: string } = { role: "gestionnaire" };
vi.mock("@/server/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => ({
        user: {
          id: "u1",
          email: "g@exemple.test",
          role: sessionState.role,
          twoFactorEnabled: true,
        },
        session: { id: "s1", updatedAt: new Date(), createdAt: new Date() },
      })),
    },
  },
}));

const findUnique = vi.mocked(prisma.serviceManager.findUnique);
const link = (level: "gestion" | "consultation" | null) =>
  // biome-ignore lint/suspicious/noExplicitAny: forme réduite du select { level }
  findUnique.mockResolvedValue((level ? { level } : null) as any);

// Catégories « accueil de loisirs » acceptées par le service (matrice demandeurs).
const loisirsRows = vi.mocked(prisma.serviceDemandeurSettings.findMany);
const loisirs = (ids: number[]) =>
  // biome-ignore lint/suspicious/noExplicitAny: forme réduite du select { demandeurId }
  loisirsRows.mockResolvedValue(ids.map((demandeurId) => ({ demandeurId })) as any);

beforeEach(() => {
  findUnique.mockReset();
  loisirsRows.mockReset();
  sessionState.role = "gestionnaire";
});

describe("serviceAccessLevel", () => {
  it("administrateur → gestion partout, sans lire le pivot", async () => {
    expect(await serviceAccessLevel("u1", "administrateur", "svc_001")).toBe("gestion");
    expect(findUnique).not.toHaveBeenCalled();
  });
  it("utilisateur → aucun accès, sans lire le pivot", async () => {
    expect(await serviceAccessLevel("u1", "utilisateur", "svc_001")).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });
  it("gestionnaire → niveau du rattachement, null sans ligne", async () => {
    link("consultation");
    expect(await serviceAccessLevel("u1", "gestionnaire", "svc_001")).toBe("consultation");
    link(null);
    expect(await serviceAccessLevel("u1", "gestionnaire", "svc_001")).toBeNull();
  });
});

describe("requireServiceManager (écriture)", () => {
  it("accepte le niveau gestion", async () => {
    link("gestion");
    await expect(requireServiceManager("svc_001")).resolves.toBeTruthy();
  });
  it("refuse le niveau consultation", async () => {
    link("consultation");
    await expect(requireServiceManager("svc_001")).rejects.toThrow("REDIRECT:/configuration");
  });
  it("refuse l'absence de rattachement", async () => {
    link(null);
    await expect(requireServiceManager("svc_001")).rejects.toThrow("REDIRECT:/configuration");
  });
});

describe("requireServiceAccess (lecture)", () => {
  it("gestion → readOnly faux", async () => {
    link("gestion");
    const r = await requireServiceAccess("svc_001");
    expect(r.level).toBe("gestion");
    expect(r.readOnly).toBe(false);
  });
  it("consultation → accepté, readOnly vrai", async () => {
    link("consultation");
    const r = await requireServiceAccess("svc_001");
    expect(r.level).toBe("consultation");
    expect(r.readOnly).toBe(true);
  });
  it("aucun rattachement → refus", async () => {
    link(null);
    await expect(requireServiceAccess("svc_001")).rejects.toThrow("REDIRECT:/configuration");
  });
  it("administrateur → gestion sans lire le pivot", async () => {
    sessionState.role = "administrateur";
    const r = await requireServiceAccess("svc_001");
    expect(r.level).toBe("gestion");
    expect(findUnique).not.toHaveBeenCalled();
  });
});

/**
 * Direction des accueils de loisirs (rôle `direction_loisirs`, 2026-11-18) : lecture
 * seule, sans rattachement nominatif. Elle n'entre QUE par `requireServiceView`, sur les
 * services acceptant une catégorie « accueil de loisirs », avec son périmètre.
 */
describe("direction des accueils de loisirs", () => {
  beforeEach(() => {
    sessionState.role = "direction_loisirs";
  });

  it("requireServiceView l'admet avec son périmètre, en lecture seule", async () => {
    loisirs([3, 4]);
    const r = await requireServiceView("svc_001");
    expect(r.readOnly).toBe(true);
    expect(r.loisirsScope).toEqual([3, 4]);
    // Le critère est bien « catégorie marquée accueil de loisirs, acceptée par CE service ».
    expect(loisirsRows).toHaveBeenCalledWith({
      where: { serviceId: "svc_001", demandeur: { accueilLoisirs: true } },
      select: { demandeurId: true },
    });
    // Aucun rattachement nominatif n'est consulté.
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("requireServiceView la refuse sur un service sans accueil de loisirs", async () => {
    loisirs([]);
    await expect(requireServiceView("svc_001")).rejects.toThrow("REDIRECT:/");
  });

  it("requireServiceAccess la refuse (pages hors périmètre : stats, autres éditions)", async () => {
    loisirs([3]);
    await expect(requireServiceAccess("svc_001")).rejects.toThrow("REDIRECT:/");
  });

  it("requireServiceManager la refuse (toute écriture)", async () => {
    loisirs([3]);
    await expect(requireServiceManager("svc_001")).rejects.toThrow("REDIRECT:/");
  });

  it("un rattachement ServiceManager résiduel ne lui ouvre rien", async () => {
    // Compte passé de gestionnaire à direction : même si une ligne de pivot traînait,
    // le niveau effectif reste nul — son accès ne vient que du périmètre loisirs.
    link("gestion");
    expect(await serviceAccessLevel("u1", "direction_loisirs", "svc_001")).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("requireRole : au-dessus d'utilisateur, en dessous de gestionnaire", async () => {
    await expect(requireRole("direction_loisirs")).resolves.toBeTruthy();
    await expect(requireRole("gestionnaire")).rejects.toThrow("REDIRECT:/");
    await expect(requireRole("administrateur")).rejects.toThrow("REDIRECT:/");
  });

  it("requireBookingUser lui interdit de réserver côté usager", async () => {
    await expect(requireBookingUser()).rejects.toThrow("REDIRECT:/");
  });
});

describe("requireServiceView (autres rôles)", () => {
  it("gestionnaire en gestion → aucun périmètre restreint", async () => {
    link("gestion");
    const r = await requireServiceView("svc_001");
    expect(r.readOnly).toBe(false);
    expect(r.loisirsScope).toBeNull();
    expect(loisirsRows).not.toHaveBeenCalled();
  });
  it("gestionnaire en consultation → lecture seule, sans périmètre restreint", async () => {
    link("consultation");
    const r = await requireServiceView("svc_001");
    expect(r.readOnly).toBe(true);
    expect(r.loisirsScope).toBeNull();
  });
  it("gestionnaire non rattaché → refus", async () => {
    link(null);
    await expect(requireServiceView("svc_001")).rejects.toThrow("REDIRECT:/configuration");
  });
  it("utilisateur → refus", async () => {
    sessionState.role = "utilisateur";
    await expect(requireServiceView("svc_001")).rejects.toThrow("REDIRECT:/");
  });
  it("requireBookingUser laisse réserver les autres rôles", async () => {
    for (const role of ["utilisateur", "gestionnaire", "administrateur"]) {
      sessionState.role = role;
      await expect(requireBookingUser()).resolves.toBeTruthy();
    }
  });
});
