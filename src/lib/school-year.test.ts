import { describe, expect, it } from "vitest";
import { schoolYearLabel } from "./school-year";

describe("schoolYearLabel — année scolaire Y-Y+1, bascule au 1er août", () => {
  it("juillet appartient encore à l'année scolaire précédente", () => {
    expect(schoolYearLabel("2026-07-31")).toBe("2025-2026");
  });
  it("août ouvre la nouvelle année scolaire", () => {
    expect(schoolYearLabel("2026-08-01")).toBe("2026-2027");
  });
  it("accepte une Date (interprétée en UTC, comme les colonnes @db.Date)", () => {
    expect(schoolYearLabel(new Date("2026-07-31T00:00:00Z"))).toBe("2025-2026");
    expect(schoolYearLabel(new Date("2026-08-01T00:00:00Z"))).toBe("2026-2027");
  });
});
