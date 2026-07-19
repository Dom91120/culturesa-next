import { describe, expect, it } from "vitest";
import { gaugeColor, gaugeUnits } from "./gauge";

describe("gaugeUnits — places consommées dans la jauge", () => {
  it("compte toujours les enfants", () => {
    expect(gaugeUnits(3, 0, false)).toBe(3);
  });
  it("ignore les accompagnants si le service ne les compte pas", () => {
    expect(gaugeUnits(3, 2, false)).toBe(3);
  });
  it("ajoute les accompagnants si gaugeAccompagnants est actif", () => {
    expect(gaugeUnits(3, 2, true)).toBe(5);
  });
});

describe("gaugeColor — seuils UNIQUES : vert < 70 %, orange >= 70 %, rouge à 100 %", () => {
  it("sous 70 % → accent (vert)", () => {
    expect(gaugeColor(0)).toBe("var(--accent)");
    expect(gaugeColor(69.9)).toBe("var(--accent)");
  });
  it("de 70 % à 99,9 % → orange", () => {
    expect(gaugeColor(70)).toBe("#e8a45a");
    expect(gaugeColor(99.9)).toBe("#e8a45a");
  });
  it("à 100 % et au-delà → danger (rouge)", () => {
    expect(gaugeColor(100)).toBe("var(--danger)");
    expect(gaugeColor(120)).toBe("var(--danger)");
  });
});
