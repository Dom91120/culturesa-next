import { describe, expect, it } from "vitest";
import { dayLabel, TIME_FMT, todayYesterdayKeys } from "./journal-days";

// Toutes les attentes sont en heure de PARIS, quel que soit le fuseau du processus de
// test — c'est précisément ce que ces helpers garantissent.

describe("todayYesterdayKeys", () => {
  it("découpe les jours en heure de Paris : 23:30 UTC le 16 = déjà le 17 à Paris (été)", () => {
    expect(todayYesterdayKeys("2026-09-16T23:30:00.000Z")).toEqual({
      todayYmd: "2026-09-17",
      yesterdayYmd: "2026-09-16",
    });
  });
  it("hiver : 23:30 UTC le 15 janvier = le 16 à Paris (+1 h)", () => {
    expect(todayYesterdayKeys("2026-01-15T23:30:00.000Z").todayYmd).toBe("2026-01-16");
  });
});

describe("dayLabel", () => {
  const { todayYmd, yesterdayYmd } = todayYesterdayKeys("2026-09-17T17:10:00.000Z");
  it("aujourd'hui / hier, jour et mois en lettres, initiale en capitale", () => {
    expect(dayLabel("2026-09-17T16:02:00.000Z", todayYmd, yesterdayYmd)).toBe(
      "Aujourd'hui · Jeudi 17 septembre",
    );
    expect(dayLabel("2026-09-16T16:02:00.000Z", todayYmd, yesterdayYmd)).toBe(
      "Hier · Mercredi 16 septembre",
    );
  });
  it("un instant à 22:30 UTC la veille est classé au jour PARIS (00:30 le 17), donc « Aujourd'hui »", () => {
    expect(dayLabel("2026-09-16T22:30:00.000Z", todayYmd, yesterdayYmd)).toBe(
      "Aujourd'hui · Jeudi 17 septembre",
    );
  });
  it("autre jour de la même année : sans année ; année différente : année ajoutée", () => {
    expect(dayLabel("2026-09-01T10:00:00.000Z", todayYmd, yesterdayYmd)).toBe("Mardi 1 septembre");
    expect(dayLabel("2025-12-30T10:00:00.000Z", todayYmd, yesterdayYmd)).toBe(
      "Mardi 30 décembre 2025",
    );
    // 31/12 à 23:30 UTC = 1er janvier 00:30 à PARIS : l'année est celle d'aujourd'hui, donc omise.
    expect(dayLabel("2025-12-31T23:30:00.000Z", todayYmd, yesterdayYmd)).toBe("Jeudi 1 janvier");
  });
});

describe("TIME_FMT", () => {
  it("heure de Paris : 16:02 UTC en septembre → 18:02", () => {
    expect(TIME_FMT.format(new Date("2026-09-16T16:02:00.000Z"))).toBe("18:02");
  });
});
