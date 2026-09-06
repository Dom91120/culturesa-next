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
