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

  it("un récurrent compte UN créneau quel que soit son nombre d'occurrences", () => {
    const slots = [
      slot("m1", "2026-09-01"), // R1, réservé
      slot("m2", "2026-09-08"), // R1
      slot("m3", "2026-10-06"), // R1
      slot("n1", "2026-09-03", "R2"), // R2, jamais réservé, dernière occurrence passée
      slot("n2", "2026-09-10", "R2"),
      slot("p1", "2026-10-06", null), // ponctuel réservé
      slot("p2", "2026-10-20", null), // ponctuel libre à venir
    ];
    const s = computeSlotStats(slots, booked("m1", "p1"), all);
    expect(s.creneaux).toBe(4); // R1, R2, p1, p2
    expect(s.creneauxReserves).toBe(2); // R1, p1
    expect(s.creneauxLibres).toBe(2); // R2, p2
    expect(s.creneauxLibresPasses).toBe(1); // R2 (p2 est à venir)
    expect(s.tauxOccupation).toBe(50);
    expect(s.byMonth).toEqual([
      { label: "9", creneaux: 2, reserves: 1, seances: 1 }, // R1, R2
      { label: "10", creneaux: 3, reserves: 1, seances: 1 }, // R1, p1, p2 — seul p1 réservé
    ]);
  });

  it("un récurrent réservé sur UNE seule occurrence est réservé (jamais « libre passé »)", () => {
    const slots = [slot("m1", "2026-09-01"), slot("m2", "2026-09-08")];
    const s = computeSlotStats(slots, booked("m2"), all);
    expect(s).toMatchObject({ creneauxReserves: 1, creneauxLibres: 0, creneauxLibresPasses: 0 });
  });

  it("un récurrent libre dont la dernière occurrence est aujourd'hui n'est pas « passé »", () => {
    const slots = [slot("m1", "2026-09-05"), slot("m2", TODAY)];
    const s = computeSlotStats(slots, new Map(), all);
    expect(s.creneauxLibres).toBe(1);
    expect(s.creneauxLibresPasses).toBe(0);
  });

  it("filtre de type sur le créneau (miroir = récurrent, autonome = ponctuel)", () => {
    const slots = [
      slot("m1", "2026-09-01"),
      slot("m2", "2026-09-08"),
      slot("p1", "2026-09-02", null),
    ];
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

  it("plage de dates : un récurrent compte s'il a au moins une occurrence dedans", () => {
    const slots = [
      slot("a", "2026-08-31"), // R1 hors plage
      slot("b", "2026-09-01"), // R1 dans la plage
      slot("c", "2026-10-15", "R2"), // R2 hors plage → R2 absent
      slot("p", "2026-09-30", null),
    ];
    const s = computeSlotStats(slots, new Map(), {
      ...all,
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
    });
    expect(s.creneaux).toBe(2); // R1, p
    expect(s.byMonth).toEqual([{ label: "9", creneaux: 2, reserves: 0, seances: 0 }]);
  });

  it("jauge : 3 séances sur une occurrence = 1 créneau réservé, 3 séances dans le mois", () => {
    const s = computeSlotStats([slot("m1", "2026-09-01")], new Map([["m1", 3]]), all);
    expect(s.creneauxReserves).toBe(1);
    expect(s.tauxOccupation).toBe(100);
    expect(s.byMonth).toEqual([{ label: "9", creneaux: 1, reserves: 1, seances: 3 }]);
  });
});
