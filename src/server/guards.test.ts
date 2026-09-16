import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db";
import { requireServiceAccess, requireServiceManager, serviceAccessLevel } from "./guards";

/**
 * Niveaux de rattachement (ManagerLevel, 2026-09-16) : la garde d'écriture
 * `requireServiceManager` doit REFUSER un rattachement en consultation, la garde de
 * lecture `requireServiceAccess` doit l'accepter en le signalant. Le reste des gardes
 * (rôles, 2FA, politique de session) est couvert ailleurs — ici la session est saine.
 */

vi.mock("@/server/db", () => ({
  prisma: {
    serviceManager: { findUnique: vi.fn() },
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

beforeEach(() => {
  findUnique.mockReset();
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
