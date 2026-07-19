import { describe, expect, it } from "vitest";
import { mirrorDates } from "./mirror-dates";

// Janvier 2026 : le 1er est un jeudi → mardis = 6, 13, 20, 27.
// Semaines ISO : 6/01 = S2 (B), 13/01 = S3 (A), 20/01 = S4 (B), 27/01 = S5 (A).
const base = {
  startDate: "2026-01-01",
  endDate: "2026-01-31",
  slotDay: "mar" as const,
  activeDays: ["lun", "mar", "mer", "jeu", "ven"] as ("lun" | "mar" | "mer" | "jeu" | "ven")[],
  allowedWeeks: ["A", "B"],
  holidaySet: new Set<string>(),
  openOnHolidays: false,
};

describe("mirrorDates — source unique de matérialisation des occurrences", () => {
  it("retient tous les jours du slotDay sur la plage (bornes incluses)", () => {
    expect(mirrorDates(base)).toEqual(["2026-01-06", "2026-01-13", "2026-01-20", "2026-01-27"]);
  });

  it("une plage d'un seul jour correspondant au slotDay le retient", () => {
    expect(mirrorDates({ ...base, startDate: "2026-01-06", endDate: "2026-01-06" })).toEqual([
      "2026-01-06",
    ]);
  });

  it("slotDay hors des jours actifs du service → aucun miroir", () => {
    expect(mirrorDates({ ...base, activeDays: ["lun", "mer"] })).toEqual([]);
  });

  it("saute les jours fériés quand le service est fermé les fériés", () => {
    expect(mirrorDates({ ...base, holidaySet: new Set(["2026-01-06"]) })).toEqual([
      "2026-01-13",
      "2026-01-20",
      "2026-01-27",
    ]);
  });

  it("conserve les fériés quand openOnHolidays est actif", () => {
    expect(
      mirrorDates({ ...base, holidaySet: new Set(["2026-01-06"]), openOnHolidays: true }),
    ).toEqual(["2026-01-06", "2026-01-13", "2026-01-20", "2026-01-27"]);
  });

  it("filtre par parité A/B (convention semaine ISO impaire = A)", () => {
    expect(mirrorDates({ ...base, allowedWeeks: ["A"] })).toEqual(["2026-01-13", "2026-01-27"]);
    expect(mirrorDates({ ...base, allowedWeeks: ["B"] })).toEqual(["2026-01-06", "2026-01-20"]);
  });
});
