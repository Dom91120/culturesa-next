import { describe, expect, it } from "vitest";
import { computeSlotStats, type SlotStatRow } from "./slot-stats";

const slot = (id: string, date: string, parentSlotId: string | null = "R1"): SlotStatRow => ({
  id,
  date,
  parentSlotId,
});

const TODAY = "2026-09-12";
const all = { type: "all" as const, dateFrom: null, dateTo: null, today: TODAY };
const booked = (...ids: string[]) => new Map(ids.map((id) => [id, 1]));

describe("computeSlotStats", () => {
  it("vide → zéro partout, taux nul", () => {
    expect(computeSlotStats([], new Map(), all)).toEqual({
      creneaux: 0,
      creneauxReserves: 0,
      creneauxLibres: 0,
      creneauxLibresPasses: 0,
      tauxOccupation: null,
      byMonth: [],
    });
  });

  it("compte l'offre, les réservés, les libres passés et le taux d'occupation", () => {
    const slots = [
      slot("m1", "2026-09-01"), // réservé, passé
      slot("m2", "2026-09-08"), // libre, passé
      slot("m3", "2026-09-15"), // libre, à venir
      slot("p1", "2026-10-06", null), // ponctuel réservé
    ];
    const s = computeSlotStats(slots, booked("m1", "p1"), all);
    expect(s.creneaux).toBe(4);
    expect(s.creneauxReserves).toBe(2);
    expect(s.creneauxLibres).toBe(2);
    expect(s.creneauxLibresPasses).toBe(1);
    expect(s.tauxOccupation).toBe(50);
    expect(s.byMonth).toEqual([
      { label: "9", creneaux: 3, reserves: 1, seances: 1 },
      { label: "10", creneaux: 1, reserves: 1, seances: 1 },
    ]);
  });

  it("un créneau libre le jour même n'est pas encore « passé »", () => {
    const s = computeSlotStats([slot("m1", TODAY)], new Map(), all);
    expect(s.creneauxLibres).toBe(1);
    expect(s.creneauxLibresPasses).toBe(0);
  });

  it("filtre de type sur le créneau (miroir = récurrent, autonome = ponctuel)", () => {
    const slots = [slot("m1", "2026-09-01"), slot("p1", "2026-09-02", null)];
    const b = booked("m1");
    expect(computeSlotStats(slots, b, { ...all, type: "rec" })).toMatchObject({
      creneaux: 1,
      creneauxReserves: 1,
      tauxOccupation: 100,
    });
    expect(computeSlotStats(slots, b, { ...all, type: "uniq" })).toMatchObject({
      creneaux: 1,
      creneauxReserves: 0,
      tauxOccupation: 0,
    });
  });

  it("plage de dates inclusive sur la date du créneau", () => {
    const slots = [
      slot("a", "2026-08-31"),
      slot("b", "2026-09-01"),
      slot("c", "2026-09-30"),
      slot("d", "2026-10-01"),
    ];
    const s = computeSlotStats(slots, new Map(), {
      ...all,
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
    });
    expect(s.creneaux).toBe(2);
    expect(s.byMonth).toEqual([{ label: "9", creneaux: 2, reserves: 0, seances: 0 }]);
  });

  it("un créneau à jauge portant 3 séances = 1 créneau réservé, 3 séances dans le mois", () => {
    const s = computeSlotStats([slot("m1", "2026-09-01")], new Map([["m1", 3]]), all);
    expect(s.creneauxReserves).toBe(1);
    expect(s.tauxOccupation).toBe(100);
    expect(s.byMonth).toEqual([{ label: "9", creneaux: 1, reserves: 1, seances: 3 }]);
  });
});
