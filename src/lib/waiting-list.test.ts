import { describe, expect, it } from "vitest";
import {
  dispoLabel,
  dispoLabels,
  parseDispos,
  parsePeriodIds,
  periodAccepted,
  serializeDispos,
  serializePeriodIds,
  slotHalfDays,
  slotMatchesDispos,
  waitlistDeadline,
  waitlistExpired,
} from "./waiting-list";

describe("parseDispos / serializeDispos", () => {
  it("ignore les clés inconnues et trie jours puis matin/après-midi", () => {
    const set = parseDispos("jeu-pm, lun-am ,xxx,lun-pm,dim-am,bidon-am");
    expect([...set]).toHaveLength(4);
    expect(serializeDispos(set)).toBe("lun-am,lun-pm,jeu-pm,dim-am");
  });
  it("vide → vide", () => {
    expect(serializeDispos(parseDispos(""))).toBe("");
    expect(serializeDispos(parseDispos(null))).toBe("");
  });
});

describe("slotHalfDays", () => {
  it("début avant midi = matin, sinon après-midi", () => {
    expect(slotHalfDays({ startTime: "09:00", endTime: "10:30" })).toEqual(["am"]);
    expect(slotHalfDays({ startTime: "11:30", endTime: "13:00" })).toEqual(["am"]);
    expect(slotHalfDays({ startTime: "12:00", endTime: "13:00" })).toEqual(["pm"]);
    expect(slotHalfDays({ startTime: "14:00:00", endTime: "15:00:00" })).toEqual(["pm"]);
  });
  it("journée entière (horaires vides) = les deux", () => {
    expect(slotHalfDays({ startTime: "", endTime: "" })).toEqual(["am", "pm"]);
  });
});

describe("slotMatchesDispos", () => {
  const dispos = parseDispos("lun-am,jeu-pm");
  it("correspond sur le jour ET la demi-journée", () => {
    expect(slotMatchesDispos({ dayKey: "lun", startTime: "09:00", endTime: "10:00" }, dispos)).toBe(
      true,
    );
    expect(slotMatchesDispos({ dayKey: "lun", startTime: "14:00", endTime: "15:00" }, dispos)).toBe(
      false,
    );
    expect(slotMatchesDispos({ dayKey: "jeu", startTime: "14:00", endTime: "15:00" }, dispos)).toBe(
      true,
    );
    expect(slotMatchesDispos({ dayKey: "mar", startTime: "09:00", endTime: "10:00" }, dispos)).toBe(
      false,
    );
  });
  it("journée entière : correspond si une des deux demi-journées est déclarée", () => {
    expect(slotMatchesDispos({ dayKey: "jeu", startTime: "", endTime: "" }, dispos)).toBe(true);
    expect(slotMatchesDispos({ dayKey: "mar", startTime: "", endTime: "" }, dispos)).toBe(false);
  });
});

describe("libellés", () => {
  it("« Lundi matin », « Jeudi après-midi »", () => {
    expect(dispoLabel("lun-am")).toBe("Lundi matin");
    expect(dispoLabels("jeu-pm,lun-am")).toEqual(["Lundi matin", "Jeudi après-midi"]);
  });
});

describe("périodes acceptées", () => {
  it("parsePeriodIds : entiers positifs, dédoublonnés, triés ; vide → []", () => {
    expect(parsePeriodIds(" 13, 12,12,x,-1,0 ")).toEqual([12, 13]);
    expect(parsePeriodIds("")).toEqual([]);
    expect(parsePeriodIds(null)).toEqual([]);
    expect(serializePeriodIds([13, 12, 13])).toBe("12,13");
  });
  it("periodAccepted : aucune restriction = tout accepté, sinon appartenance", () => {
    expect(periodAccepted(12, new Set())).toBe(true);
    expect(periodAccepted(12, new Set([12, 13]))).toBe(true);
    expect(periodAccepted(14, new Set([12, 13]))).toBe(false);
  });
});

describe("waitlistDeadline / waitlistExpired", () => {
  const periods = [
    { id: 1, dateEnd: "2026-12-18" },
    { id: 2, dateEnd: "2027-03-26" },
    { id: 3, dateEnd: "2027-07-02" },
  ];

  it("échéance = fin de la dernière période souhaitée ; toutes si aucune restriction", () => {
    expect(waitlistDeadline([1], periods)).toBe("2026-12-18");
    expect(waitlistDeadline([1, 2], periods)).toBe("2027-03-26");
    expect(waitlistDeadline([], periods)).toBe("2027-07-02");
  });

  it("pas d'échéance connue : aucune période correspondante, ou une période sans date de fin", () => {
    expect(waitlistDeadline([9], periods)).toBeNull();
    expect(waitlistDeadline([], [])).toBeNull();
    expect(waitlistDeadline([1, 2], [...periods, { id: 2, dateEnd: null }])).toBeNull();
  });

  it("échue : échéance dépassée (strictement), ou périodes souhaitées absentes de l'exercice visible", () => {
    expect(waitlistExpired([1], periods, "2026-12-18")).toBe(false);
    expect(waitlistExpired([1], periods, "2026-12-19")).toBe(true);
    expect(waitlistExpired([1, 2], periods, "2026-12-19")).toBe(false);
    expect(waitlistExpired([], periods, "2027-07-03")).toBe(true);
    // Bascule d'exercice : les ids souhaités n'existent plus → échue.
    expect(waitlistExpired([9], periods, "2026-01-01")).toBe(true);
    // Rien à comparer (pas d'exercice visible, période sans fin) : jamais échue.
    expect(waitlistExpired([1], [], "2030-01-01")).toBe(false);
    expect(waitlistExpired([1], [{ id: 1, dateEnd: null }], "2030-01-01")).toBe(false);
  });
});
