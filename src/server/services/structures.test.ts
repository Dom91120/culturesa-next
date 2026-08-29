import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db";
import { resolveStructureLibre, structureEnDoublon } from "./structures";

// La structure saisie librement (catégorie « Autres ») est la SEULE écriture de
// référentiel déclenchée par un formulaire ; elle mérite d'être tenue de près.
vi.mock("@/server/db", () => ({
  prisma: { structure: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() } },
}));

const findFirst = vi.mocked(prisma.structure.findFirst);
const findMany = vi.mocked(prisma.structure.findMany);
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

describe("structureEnDoublon — garde-fou du référentiel admin", () => {
  it("détecte le jumeau malgré la casse et les espaces irréguliers en base", async () => {
    // Deux « Gambetta » identiques à l'œil ont été créés en production (2026-08) :
    // le rapprochement doit rattraper les libellés déjà en base aux espaces doublés,
    // qu'un `equals insensitive` SQL ne verrait pas.
    findMany.mockResolvedValue([{ label: "Accueil de loisirs  élémentaire Gambetta" }] as never);

    expect(await structureEnDoublon(4, "accueil de loisirs élémentaire GAMBETTA")).toBe(true);
  });

  it("libellé réellement nouveau → pas de doublon", async () => {
    findMany.mockResolvedValue([{ label: "ADL Joliot-Curie" }] as never);

    expect(await structureEnDoublon(4, "ADL Marcel Doret")).toBe(false);
  });

  it("exclut la ligne éditée : se renommer soi-même (casse) reste permis", async () => {
    findMany.mockResolvedValue([] as never);

    expect(await structureEnDoublon(4, "ADL Gambetta", 12)).toBe(false);
    expect(findMany).toHaveBeenCalledWith({
      where: { demandeurId: 4, id: { not: 12 } },
      select: { label: true },
    });
  });
});
