import { describe, expect, it } from "vitest";
import {
  buildHiddenOccupancy,
  occupancyKey,
  remainingLabel,
  remainingPlaces,
} from "./hidden-occupancy";

/**
 * « N places restantes » de l'agenda de la Direction des accueils de loisirs
 * (2026-11-19) : le chiffre doit rester EXACT alors que les réservations des autres
 * catégories lui sont masquées.
 */

const slots = [
  // Occurrences (miroirs) du récurrent R1, deux lundis de suite.
  { id: "m1", slotDate: "2026-11-16", parentSlotId: "R1" },
  { id: "m2", slotDate: "2026-11-23", parentSlotId: "R1" },
  // Ponctuel autonome.
  { id: "U1", slotDate: "2026-11-17", parentSlotId: null },
  // Créneau sans date : aucune cellule affichable.
  { id: "X", slotDate: null, parentSlotId: null },
];

describe("buildHiddenOccupancy", () => {
  it("rattache une occurrence à la cellule de son créneau parent, à sa date", () => {
    const occ = buildHiddenOccupancy(
      [{ slotId: "m1", count: 2, enfants: 30, accompagnants: 4 }],
      slots,
      false,
    );
    expect(occ).toEqual({ [occupancyKey("R1", "2026-11-16")]: { n: 2, u: 30 } });
  });

  it("ne mélange pas deux semaines du même récurrent", () => {
    const occ = buildHiddenOccupancy(
      [
        { slotId: "m1", count: 1, enfants: 10, accompagnants: 0 },
        { slotId: "m2", count: 3, enfants: 25, accompagnants: 0 },
      ],
      slots,
      false,
    );
    expect(occ[occupancyKey("R1", "2026-11-16")]).toEqual({ n: 1, u: 10 });
    expect(occ[occupancyKey("R1", "2026-11-23")]).toEqual({ n: 3, u: 25 });
  });

  it("garde un ponctuel autonome sur sa propre cellule", () => {
    const occ = buildHiddenOccupancy(
      [{ slotId: "U1", count: 1, enfants: 8, accompagnants: 2 }],
      slots,
      false,
    );
    expect(occ).toEqual({ [occupancyKey("U1", "2026-11-17")]: { n: 1, u: 8 } });
  });

  it("compte les accompagnants dans la jauge seulement si le service le demande", () => {
    const rows = [{ slotId: "U1", count: 1, enfants: 8, accompagnants: 2 }];
    expect(Object.values(buildHiddenOccupancy(rows, slots, false))[0].u).toBe(8);
    expect(Object.values(buildHiddenOccupancy(rows, slots, true))[0].u).toBe(10);
  });

  it("ignore les créneaux inconnus ou sans date", () => {
    const occ = buildHiddenOccupancy(
      [
        { slotId: "X", count: 5, enfants: 50, accompagnants: 0 },
        { slotId: "inconnu", count: 5, enfants: 50, accompagnants: 0 },
      ],
      slots,
      false,
    );
    expect(occ).toEqual({});
  });
});

describe("remainingPlaces", () => {
  it("créneau sans jauge : une place par réservation, masquées comprises", () => {
    // Cas signalé par Dom : 1 réservation visible sur 12 — mais 4 autres sont masquées.
    expect(
      remainingPlaces({
        capacity: 12,
        jauge: false,
        visibleUsed: 1,
        visibleCount: 1,
        hidden: { n: 4, u: 80 },
      }),
    ).toBe(7);
  });

  it("créneau à jauge : en unités, masquées comprises", () => {
    expect(
      remainingPlaces({
        capacity: 60,
        jauge: true,
        visibleUsed: 12,
        visibleCount: 1,
        hidden: { n: 2, u: 40 },
      }),
    ).toBe(8);
  });

  it("aucune réservation masquée : capacité moins le visible", () => {
    expect(
      remainingPlaces({
        capacity: 12,
        jauge: false,
        visibleUsed: 1,
        visibleCount: 1,
        hidden: undefined,
      }),
    ).toBe(11);
  });

  it("créneau vide à l'écran mais complet en réalité → 0", () => {
    expect(
      remainingPlaces({
        capacity: 3,
        jauge: false,
        visibleUsed: 0,
        visibleCount: 0,
        hidden: { n: 3, u: 45 },
      }),
    ).toBe(0);
  });

  it("jamais négatif en cas de dépassement de capacité", () => {
    expect(
      remainingPlaces({
        capacity: 10,
        jauge: true,
        visibleUsed: 8,
        visibleCount: 1,
        hidden: { n: 1, u: 9 },
      }),
    ).toBe(0);
  });
});

describe("remainingLabel", () => {
  it("créneau à jauge : des places (une par enfant)", () => {
    expect(remainingLabel(1, true)).toBe("1 place restante");
    expect(remainingLabel(7, true)).toBe("7 places restantes");
  });
  it("créneau sans jauge : des groupes (une réservation entière)", () => {
    expect(remainingLabel(1, false)).toBe("1 groupe possible");
    expect(remainingLabel(10, false)).toBe("10 groupes possibles");
  });
  it("« Complet » à zéro, quelle que soit l'unité", () => {
    expect(remainingLabel(0, true)).toBe("Complet");
    expect(remainingLabel(0, false)).toBe("Complet");
  });
});
