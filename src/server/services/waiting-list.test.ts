import { describe, expect, it, vi } from "vitest";

// Le module importe tout le graphe des réservations (Prisma, guards, e-mails) : neutralisé,
// on ne teste ici que la borne pure des essais à blanc.
vi.mock("@/server/db", () => ({ prisma: {} }));
vi.mock("@/server/guards", () => ({ getSession: vi.fn(async () => null) }));
vi.mock("@/server/config", () => ({
  getConfigMany: vi.fn(async () => ({})),
  setConfig: vi.fn(async () => {}),
  getAppUrl: vi.fn(async () => ""),
}));
vi.mock("@/server/mailer", () => ({
  sendMail: vi.fn(async () => {}),
  sendMailOrQueue: vi.fn(async () => {}),
}));

import { MAX_TESTED_CANDIDATES, nearestCandidates } from "./waiting-list";

const rec = (key: string) => ({ key, slotDate: null as Date | null });
const uniq = (key: string, ymd: string) => ({ key, slotDate: new Date(`${ymd}T00:00:00Z`) });

describe("nearestCandidates — borne des essais à blanc", () => {
  it("récurrents d'abord (ordre d'appariement conservé), puis ponctuels par date croissante", () => {
    const matching = [
      uniq("u-oct", "2026-10-05"),
      rec("r-lun"),
      uniq("u-sep", "2026-09-21"),
      rec("r-mar"),
    ];
    expect(nearestCandidates(matching).map((c) => c.key)).toEqual([
      "r-lun",
      "r-mar",
      "u-sep",
      "u-oct",
    ]);
  });

  it("tri stable : deux ponctuels le même jour gardent leur ordre (heure)", () => {
    const matching = [uniq("u-14h", "2026-09-21"), uniq("u-10h", "2026-09-21")];
    expect(nearestCandidates(matching).map((c) => c.key)).toEqual(["u-14h", "u-10h"]);
  });

  it("ne dépasse jamais la borne et garde les plus proches", () => {
    const many = Array.from({ length: 100 }, (_, i) =>
      uniq(`u${i}`, `2027-01-${String((i % 28) + 1).padStart(2, "0")}`),
    );
    const kept = nearestCandidates(many);
    expect(kept).toHaveLength(MAX_TESTED_CANDIDATES);
    // Les 40 retenus sont tous antérieurs ou égaux au premier écarté.
    const maxKept = Math.max(...kept.map((c) => c.slotDate?.getTime() ?? 0));
    const dropped = many.filter((c) => !kept.includes(c));
    for (const d of dropped) expect(d.slotDate?.getTime() ?? 0).toBeGreaterThanOrEqual(maxKept);
  });

  it("n'altère pas la liste d'origine", () => {
    const matching = [uniq("b", "2026-10-01"), uniq("a", "2026-09-01")];
    nearestCandidates(matching);
    expect(matching.map((c) => c.key)).toEqual(["b", "a"]);
  });
});
