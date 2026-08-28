import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db";
import { resolveStructureLibre } from "./structures";

// La structure saisie librement (catégorie « Autres ») est la SEULE écriture de
// référentiel déclenchée par un formulaire ; elle mérite d'être tenue de près.
vi.mock("@/server/db", () => ({
  prisma: { structure: { findFirst: vi.fn(), create: vi.fn() } },
}));

const findFirst = vi.mocked(prisma.structure.findFirst);
const create = vi.mocked(prisma.structure.create);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveStructureLibre — libellé saisi → structure", () => {
  it("réutilise la structure existante, sans rien créer", async () => {
    findFirst.mockResolvedValue({ id: 27 } as never);

    expect(await resolveStructureLibre(6, "Crèche des Lilas")).toBe(27);
    expect(create).not.toHaveBeenCalled();
  });

  it("rapproche SANS tenir compte de la casse", async () => {
    // Le point qui compte : deux lignes jumelles fausseraient les statistiques par
    // structure autant que les feuilles de pointage. On vérifie donc la requête
    // elle-même — un `equals` strict passerait le test précédent sans protéger.
    findFirst.mockResolvedValue({ id: 27 } as never);

    await resolveStructureLibre(6, "crèche DES lilas");

    expect(findFirst).toHaveBeenCalledWith({
      where: { demandeurId: 6, label: { equals: "crèche DES lilas", mode: "insensitive" } },
      select: { id: true },
    });
  });

  it("crée la structure sous SA catégorie quand aucune ne correspond", async () => {
    findFirst.mockResolvedValue(null as never);
    create.mockResolvedValue({ id: 31 } as never);

    expect(await resolveStructureLibre(6, "Crèche des Lilas")).toBe(31);
    expect(create).toHaveBeenCalledWith({
      data: { demandeurId: 6, label: "Crèche des Lilas" },
      select: { id: true },
    });
  });
});
