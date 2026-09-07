import { describe, expect, it } from "vitest";
import { waitlistDeletionLabel } from "./slot-label";
import { daysBetween, demandByHalfDay, demandByPeriod } from "./waiting-list-editions";

const e = (dispos: string, auto = false, periodIds: number[] = []) => ({
  dispos,
  autoInscription: auto,
  periodIds,
});

describe("demandByHalfDay", () => {
  it("compte chaque inscrit une fois par demi-journée déclarée, auto à part", () => {
    const rows = demandByHalfDay(
      [e("lun-am,jeu-pm", true), e("lun-am"), e("lun-pm,lun-am", false)],
      ["lun", "mar", "jeu"],
    );
    expect(rows.map((r) => r.day)).toEqual(["lun", "mar", "jeu"]);
    expect(rows[0]).toEqual({
      day: "lun",
      label: "Lundi",
      am: { total: 3, auto: 1 },
      pm: { total: 1, auto: 0 },
    });
    expect(rows[1].am).toEqual({ total: 0, auto: 0 });
    expect(rows[2].pm).toEqual({ total: 1, auto: 1 });
  });

  it("ajoute un jour déclaré hors ouverture, dans l'ordre de la semaine ; clés inconnues ignorées", () => {
    const rows = demandByHalfDay([e("sam-am,xx-am")], ["lun"]);
    expect(rows.map((r) => r.day)).toEqual(["lun", "sam"]);
    expect(rows[1].am.total).toBe(1);
  });

  it("vide", () => {
    expect(demandByHalfDay([], [])).toEqual([]);
  });
});

describe("demandByPeriod", () => {
  it("sans restriction = toutes les périodes ; restriction = seulement celles-là", () => {
    const periods = [
      { id: 1, label: "P1" },
      { id: 2, label: "P2" },
    ];
    const rows = demandByPeriod(
      [e("lun-am", true), e("lun-am", false, [2]), e("lun-am", false, [9])],
      periods,
    );
    expect(rows).toEqual([
      { id: 1, label: "P1", total: 1, auto: 1 },
      { id: 2, label: "P2", total: 2, auto: 1 },
    ]);
  });
});

describe("daysBetween", () => {
  it("arrondi au jour, jamais négatif", () => {
    expect(daysBetween("2026-09-01T08:00:00.000Z", "2026-09-04T20:00:00.000Z")).toBe(4);
    expect(daysBetween("2026-09-01T08:00:00.000Z", "2026-09-01T09:00:00.000Z")).toBe(0);
    expect(daysBetween("2026-09-05T08:00:00.000Z", "2026-09-01T08:00:00.000Z")).toBe(0);
  });
});

describe("waitlistDeletionLabel", () => {
  it("mode + date + acteur (gestionnaire seulement) ; vide sans suppression", () => {
    expect(waitlistDeletionLabel("usager", "2026-09-12T10:00:00.000Z", "")).toBe(
      "annulée par l'usager le 12/09/2026",
    );
    expect(waitlistDeletionLabel("gestionnaire", "2026-09-12T10:00:00.000Z", "DUPONT Marie")).toBe(
      "supprimée par le service le 12/09/2026 (DUPONT Marie)",
    );
    expect(waitlistDeletionLabel("refus", "2026-09-12T10:00:00.000Z", "")).toBe(
      "refusée le 12/09/2026",
    );
    expect(waitlistDeletionLabel("periode", "2026-09-12T10:00:00.000Z", "X")).toBe(
      "retirée avec sa période le 12/09/2026 (X)",
    );
    expect(waitlistDeletionLabel("inconnu", "2026-09-12T10:00:00.000Z", "")).toBe(
      "supprimée le 12/09/2026",
    );
    expect(waitlistDeletionLabel("usager", null, "")).toBe("");
  });
});
