import { describe, expect, it } from "vitest";
import {
  dayKeyFromYmd,
  isBookingLockedByPointage,
  type LayoutItem,
  layoutOverlaps,
  parseWeeks,
  toMinutes,
} from "./agenda-core";

describe("parseWeeks — semaines où un créneau « tourne »", () => {
  it("null ou vide → toutes les semaines", () => {
    expect(parseWeeks(null)).toEqual(["A", "B"]);
    expect(parseWeeks("")).toEqual(["A", "B"]);
  });
  it("parité unique, casse tolérée", () => {
    expect(parseWeeks("A")).toEqual(["A"]);
    expect(parseWeeks("b")).toEqual(["B"]);
  });
  it("« A,B » (jamais persisté, legacy) → toutes", () => {
    expect(parseWeeks("A,B").sort()).toEqual(["A", "B"]);
  });
  it("valeur sale inconnue → repli toutes semaines (jamais zéro occurrence)", () => {
    expect(parseWeeks("X")).toEqual(["A", "B"]);
  });
});

describe("toMinutes", () => {
  it("HH:MM → minutes depuis minuit", () => {
    expect(toMinutes("09:30", 0)).toBe(570);
    expect(toMinutes("00:00", 99)).toBe(0);
  });
  it("chaîne invalide → repli fourni (créneau « journée entière »)", () => {
    expect(toMinutes("", 480)).toBe(480);
    expect(toMinutes("abc", 480)).toBe(480);
  });
});

describe("dayKeyFromYmd", () => {
  it("dérive la clé de jour d'une date ISO", () => {
    expect(dayKeyFromYmd("2026-07-13")).toBe("lun");
    expect(dayKeyFromYmd("2026-07-19")).toBe("dim");
  });
});

describe("isBookingLockedByPointage — prédicat de verrou partagé serveur/client", () => {
  const base = { pointage: null, parentBookingId: null, bookingType: "unique" };
  it("un miroir (enfant) est toujours verrouillé", () => {
    expect(isBookingLockedByPointage({ ...base, parentBookingId: 12 }, false)).toBe(true);
  });
  it("une réservation pointée est verrouillée", () => {
    expect(isBookingLockedByPointage({ ...base, pointage: "present" }, false)).toBe(true);
  });
  it("un parent récurrent à miroir pointé est verrouillé", () => {
    expect(isBookingLockedByPointage({ ...base, bookingType: "recurring" }, true)).toBe(true);
  });
  it("sinon : libre", () => {
    expect(isBookingLockedByPointage(base, false)).toBe(false);
  });
});

describe("layoutOverlaps — juxtaposition des créneaux qui se chevauchent", () => {
  const item = (startMin: number, endMin: number): LayoutItem => ({
    startMin,
    endMin,
    col: 0,
    colCount: 1,
  });
  it("deux créneaux qui se chevauchent → 2 colonnes distinctes", () => {
    const a = item(0, 60);
    const b = item(30, 90);
    layoutOverlaps([a, b]);
    expect([a.col, b.col].sort()).toEqual([0, 1]);
    expect(a.colCount).toBe(2);
    expect(b.colCount).toBe(2);
  });
  it("des créneaux bout à bout (fin = début) ne se chevauchent pas", () => {
    const a = item(0, 60);
    const b = item(60, 120);
    layoutOverlaps([a, b]);
    expect(a.col).toBe(0);
    expect(b.col).toBe(0);
    expect(a.colCount).toBe(1);
    expect(b.colCount).toBe(1);
  });
  it("un créneau disjoint repart en colonne 0 (nouveau cluster)", () => {
    const a = item(0, 60);
    const b = item(30, 90);
    const c = item(120, 180);
    layoutOverlaps([a, b, c]);
    expect(c.col).toBe(0);
    expect(c.colCount).toBe(1);
  });
});
