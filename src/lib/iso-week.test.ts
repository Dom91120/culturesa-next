import { describe, expect, it } from "vitest";
import { isoWeek, slotWeekTag } from "./iso-week";

describe("isoWeek (ISO 8601, = PHP date('W'))", () => {
  it("1er janvier tombant un lundi → semaine 1", () => {
    expect(isoWeek("2024-01-01")).toBe(1); // lundi
  });
  it("1er janvier tombant un jeudi → semaine 1", () => {
    expect(isoWeek("2026-01-01")).toBe(1); // jeudi
  });
  it("1er janvier tombant un dimanche → semaine 52 de l'année précédente", () => {
    expect(isoWeek("2023-01-01")).toBe(52);
  });
  it("1er janvier après une année à 53 semaines → semaine 53", () => {
    expect(isoWeek("2021-01-01")).toBe(53); // vendredi, 2020 = 53 semaines
  });
});

describe("slotWeekTag — CONVENTION UNIQUE : semaine ISO impaire = A, paire = B", () => {
  it("semaine impaire → A, semaine paire → B", () => {
    expect(slotWeekTag("2024-01-01")).toBe("A"); // semaine 1
    expect(slotWeekTag("2024-01-08")).toBe("B"); // semaine 2
  });
  it("le tag est constant du lundi au dimanche d'une même semaine", () => {
    // Semaine 29 de 2026 (impaire) : 13 → 19 juillet.
    const days = ["13", "14", "15", "16", "17", "18", "19"];
    for (const d of days) {
      expect(slotWeekTag(`2026-07-${d}`)).toBe("A");
    }
  });
  it("le tag alterne d'une semaine à l'autre", () => {
    expect(slotWeekTag("2026-07-19")).toBe("A"); // dimanche semaine 29
    expect(slotWeekTag("2026-07-20")).toBe("B"); // lundi semaine 30
  });
});
