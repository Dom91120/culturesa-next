import { describe, expect, it } from "vitest";
import { isInSchoolHolidayRange } from "./school-holidays";

// Convention data.education.gouv.fr : dateStart = soir du DERNIER jour d'école
// (donc encore un jour d'école), dateEnd = soir du dernier jour de vacances
// (inclus). Intervalle de vacances = ] dateStart, dateEnd ].
const ranges = [{ dateStart: "2026-07-04", dateEnd: "2026-08-31" }];

describe("isInSchoolHolidayRange — intervalle ] dateStart, dateEnd ]", () => {
  it("dateStart (dernier jour d'école) n'est PAS en vacances", () => {
    expect(isInSchoolHolidayRange("2026-07-04", ranges)).toBe(false);
  });
  it("dateStart + 1 (premier jour de vacances) est en vacances", () => {
    expect(isInSchoolHolidayRange("2026-07-05", ranges)).toBe(true);
  });
  it("dateEnd (dernier jour de vacances) est en vacances", () => {
    expect(isInSchoolHolidayRange("2026-08-31", ranges)).toBe(true);
  });
  it("dateEnd + 1 (jour de reprise) n'est PAS en vacances", () => {
    expect(isInSchoolHolidayRange("2026-09-01", ranges)).toBe(false);
  });
  it("aucune plage → jamais en vacances", () => {
    expect(isInSchoolHolidayRange("2026-07-15", [])).toBe(false);
  });
});
