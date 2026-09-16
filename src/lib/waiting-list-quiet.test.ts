import { describe, expect, it } from "vitest";
import { agendaIsQuiet, parseQuietMinutes } from "./waiting-list-quiet";

const now = new Date("2026-09-16T10:00:00.000Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

describe("parseQuietMinutes", () => {
  it("défaut 15 si absent, vide ou invalide", () => {
    expect(parseQuietMinutes(undefined)).toBe(15);
    expect(parseQuietMinutes("")).toBe(15);
    expect(parseQuietMinutes("abc")).toBe(15);
    expect(parseQuietMinutes("-1")).toBe(15);
    expect(parseQuietMinutes("1441")).toBe(15);
  });
  it("entier valide accepté, 0 compris", () => {
    expect(parseQuietMinutes("0")).toBe(0);
    expect(parseQuietMinutes("30")).toBe(30);
  });
});

describe("agendaIsQuiet", () => {
  it("activité récente → pas calme ; assez ancienne → calme (borne incluse)", () => {
    expect(agendaIsQuiet(minutesAgo(3), now, 15)).toBe(false);
    expect(agendaIsQuiet(minutesAgo(14.9), now, 15)).toBe(false);
    expect(agendaIsQuiet(minutesAgo(15), now, 15)).toBe(true);
    expect(agendaIsQuiet(minutesAgo(60), now, 15)).toBe(true);
  });
  it("aucune activité connue, ou délai 0 → toujours calme", () => {
    expect(agendaIsQuiet(null, now, 15)).toBe(true);
    expect(agendaIsQuiet(minutesAgo(1), now, 0)).toBe(true);
  });
});
