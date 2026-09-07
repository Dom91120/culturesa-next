import { describe, expect, it } from "vitest";
import { type PrunableSession, sessionsToPrune } from "./session-prune";

const at = (h: number) => new Date(Date.UTC(2026, 8, 7, h));
const s = (id: string, h: number, ua = "Chrome", ip = "10.0.0.1"): PrunableSession => ({
  id,
  createdAt: at(h),
  userAgent: ua,
  ipAddress: ip,
});

describe("sessionsToPrune", () => {
  it("ferme les autres sessions du même navigateur (même user-agent ET même IP)", () => {
    const keep = s("new", 17);
    const ids = sessionsToPrune(
      [s("a", 10), s("b", 12), s("c", 14, "Chrome", "10.0.0.2"), keep],
      keep,
    );
    expect(ids.sort()).toEqual(["a", "b"]);
  });

  it("ne touche pas aux autres appareils tant que le plafond n'est pas atteint", () => {
    const keep = s("new", 17, "Safari", "10.0.0.9");
    expect(sessionsToPrune([s("a", 10), s("b", 12, "Firefox"), keep], keep)).toEqual([]);
  });

  it("plafond : au-delà de max sessions, les plus anciennes sont fermées", () => {
    const keep = s("new", 17, "Safari", "10.0.0.9");
    const others = [s("a", 9, "UA-a"), s("b", 10, "UA-b"), s("c", 11, "UA-c"), s("d", 12, "UA-d")];
    // max 3 : la nouvelle + les 2 plus récentes (d, c) restent ; a et b partent.
    expect(sessionsToPrune([...others, keep], keep, 3).sort()).toEqual(["a", "b"]);
  });

  it("jamais la session conservée ; user-agent / IP absents comparés comme vides", () => {
    const keep = { id: "new", createdAt: at(17), userAgent: null, ipAddress: null };
    expect(sessionsToPrune([keep, { ...keep, id: "old", createdAt: at(1) }], keep)).toEqual([
      "old",
    ]);
    expect(sessionsToPrune([keep], keep)).toEqual([]);
  });
});
