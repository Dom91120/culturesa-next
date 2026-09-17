import { describe, expect, it } from "vitest";
import { addDaysUtc, mondayOfUtc, pad2, pad4, parseYmdUtc, ymdUtc } from "./date-utc";

describe("date-utc — helpers UTC des valeurs @db.Date", () => {
  it("pad2 / pad4", () => {
    expect(pad2(7)).toBe("07");
    expect(pad2(12)).toBe("12");
    expect(pad4(999)).toBe("0999");
    expect(pad4(2026)).toBe("2026");
  });

  it("ymdUtc ↔ parseYmdUtc : aller-retour exact à minuit UTC", () => {
    const d = parseYmdUtc("2026-09-17");
    expect(d.toISOString()).toBe("2026-09-17T00:00:00.000Z");
    expect(ymdUtc(d)).toBe("2026-09-17");
  });

  it("ymdUtc ignore le fuseau serveur : 23h59 UTC reste le même jour", () => {
    expect(ymdUtc(new Date("2026-09-17T23:59:59.000Z"))).toBe("2026-09-17");
  });

  it("addDaysUtc : décalage sans modifier l'entrée, franchit les mois et les années", () => {
    const d = parseYmdUtc("2026-12-30");
    const r = addDaysUtc(d, 3);
    expect(ymdUtc(r)).toBe("2027-01-02");
    expect(ymdUtc(d)).toBe("2026-12-30");
    expect(ymdUtc(addDaysUtc(d, -30))).toBe("2026-11-30");
  });

  it("mondayOfUtc : lundi de la semaine, lundi → lui-même, dimanche → lundi précédent", () => {
    // 2026-09-17 est un jeudi.
    expect(ymdUtc(mondayOfUtc(parseYmdUtc("2026-09-17")))).toBe("2026-09-14");
    expect(ymdUtc(mondayOfUtc(parseYmdUtc("2026-09-14")))).toBe("2026-09-14");
    expect(ymdUtc(mondayOfUtc(parseYmdUtc("2026-09-20")))).toBe("2026-09-14");
    // Franchit une année : 2027-01-01 est un vendredi → lundi 2026-12-28.
    expect(ymdUtc(mondayOfUtc(parseYmdUtc("2027-01-01")))).toBe("2026-12-28");
  });
});
