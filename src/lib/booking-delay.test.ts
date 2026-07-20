import { describe, expect, it } from "vitest";
import { earliestBookableISO, todayParisISO } from "./booking-delay";

// « Maintenant » figé : mercredi 15 juillet 2026, 10 h UTC (12 h à Paris, UTC+2 en été).
const NOW = new Date("2026-07-15T10:00:00Z");
const WEEKDAYS = ["lun", "mar", "mer", "jeu", "ven"];

describe("todayParisISO — « aujourd'hui » = date calendaire à PARIS", () => {
  it("journée en cours", () => {
    expect(todayParisISO(NOW)).toBe("2026-07-15");
  });
  it("22h30 UTC en été (UTC+2) → déjà le lendemain à Paris", () => {
    expect(todayParisISO(new Date("2026-07-15T22:30:00Z"))).toBe("2026-07-16");
  });
  it("23h30 UTC en hiver (UTC+1) → déjà le lendemain à Paris", () => {
    expect(todayParisISO(new Date("2026-01-15T23:30:00Z"))).toBe("2026-01-16");
  });
});

describe("earliestBookableISO — encodage legacy de exercice.bookingDelay", () => {
  it("0 → aujourd'hui", () => {
    expect(earliestBookableISO(0, WEEKDAYS, NOW)).toBe("2026-07-15");
  });
  it("0 < delay < 1000 (minutes legacy, ignoré) → aujourd'hui", () => {
    expect(earliestBookableISO(500, WEEKDAYS, NOW)).toBe("2026-07-15");
  });
  it(">= 1000 → aujourd'hui + (delay − 1000) jours CALENDAIRES", () => {
    expect(earliestBookableISO(1000, WEEKDAYS, NOW)).toBe("2026-07-15");
    expect(earliestBookableISO(1003, WEEKDAYS, NOW)).toBe("2026-07-18");
  });
  it("négatif → jours OUVRÉS strictement après aujourd'hui (jours actifs du service)", () => {
    // Mer 15/07 ; −2 jours ouvrés lun-ven : jeu 16 et ven 17 écoulés → sam 18.
    expect(earliestBookableISO(-2, WEEKDAYS, NOW)).toBe("2026-07-18");
  });
  it("négatif avec service ouvert le seul samedi : le décompte saute au samedi suivant", () => {
    // Mer 15/07 ; −1 jour ouvré « sam » : sam 18 écoulé → dim 19.
    expect(earliestBookableISO(-1, ["sam"], NOW)).toBe("2026-07-19");
  });
});
