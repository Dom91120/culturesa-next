import { describe, expect, it } from "vitest";
import { computeWaitlistStats, type WaitlistLogRow } from "./waiting-list-stats";

const log = (
  inscritAt: string,
  clotureAt: string,
  issue: WaitlistLogRow["issue"],
  demandeurLabel = "Ecole maternelle",
  structureLabel = "Maternelle Jules Verne",
): WaitlistLogRow => ({ inscritAt, clotureAt, issue, demandeurLabel, structureLabel });

const NOW = "2026-09-06T12:00:00.000Z";

describe("computeWaitlistStats", () => {
  it("vide → compteurs à zéro, moyennes nulles", () => {
    const s = computeWaitlistStats([], [], { dateFrom: null, dateTo: null, nowIso: NOW });
    expect(s).toEqual({
      waitingNow: 0,
      waitingAvgDays: null,
      noPlace: 0,
      placed: 0,
      placedAvgDays: null,
      outcomes: [],
      noPlaceByDemandeur: [],
      noPlaceByStructure: [],
      byMonth: [],
    });
  });

  it("sans place = retraits usager/gestionnaire sans réservation ; placés = auto + réservé", () => {
    const logs = [
      log("2026-09-01T08:00:00.000Z", "2026-09-03T08:00:00.000Z", "AUTO_BOOKED"),
      log("2026-09-01T08:00:00.000Z", "2026-09-05T08:00:00.000Z", "BOOKED"),
      log("2026-09-02T08:00:00.000Z", "2026-09-04T08:00:00.000Z", "LEFT", "Ecole élémentaire", ""),
      log("2026-09-02T08:00:00.000Z", "2026-09-04T08:00:00.000Z", "REMOVED"),
      log("2026-09-02T08:00:00.000Z", "2026-09-04T08:00:00.000Z", "ANONYMIZED"),
    ];
    const live = [
      { inscritAt: "2026-09-04T12:00:00.000Z", demandeurLabel: "Autres", structureLabel: "" },
    ];
    const s = computeWaitlistStats(logs, live, { dateFrom: null, dateTo: null, nowIso: NOW });
    expect(s.noPlace).toBe(2);
    expect(s.placed).toBe(2);
    expect(s.placedAvgDays).toBe(3); // (2 j + 4 j) / 2
    expect(s.waitingNow).toBe(1);
    expect(s.waitingAvgDays).toBe(2);
    expect(s.outcomes.map((o) => `${o.label}=${o.value}`)).toEqual([
      "Inscrits automatiquement=1",
      "Ont réservé eux-mêmes=1",
      "Retirés sans place=1",
      "Retirés par le service=1",
      "Comptes anonymisés=1",
      "Toujours en attente=1",
    ]);
    // Sans place : catégorie et structure (repli catégorie quand pas de structure).
    // Égalité de valeurs → ordre alphabétique.
    expect(s.noPlaceByDemandeur).toEqual([
      { label: "Ecole élémentaire", value: 1 },
      { label: "Ecole maternelle", value: 1 },
    ]);
    expect(s.noPlaceByStructure).toEqual([
      { label: "Ecole élémentaire", value: 1 },
      { label: "Maternelle Jules Verne", value: 1 },
    ]);
    expect(s.byMonth).toEqual([{ label: "9", value: 6 }]);
  });

  it("le filtre de dates porte sur la date d'inscription ; « en attente » reste l'état du jour", () => {
    const logs = [
      log("2026-06-10T08:00:00.000Z", "2026-06-12T08:00:00.000Z", "LEFT"),
      log("2026-09-02T08:00:00.000Z", "2026-09-04T08:00:00.000Z", "LEFT"),
    ];
    const live = [
      { inscritAt: "2026-06-20T08:00:00.000Z", demandeurLabel: "", structureLabel: "" },
      { inscritAt: "2026-09-05T08:00:00.000Z", demandeurLabel: "", structureLabel: "" },
    ];
    const s = computeWaitlistStats(logs, live, {
      dateFrom: "2026-09-01",
      dateTo: "2026-12-31",
      nowIso: NOW,
    });
    expect(s.noPlace).toBe(1);
    expect(s.waitingNow).toBe(2);
    expect(s.outcomes).toEqual([
      { label: "Retirés sans place", value: 1 },
      { label: "Toujours en attente", value: 1 },
    ]);
    expect(s.byMonth).toEqual([{ label: "9", value: 2 }]);
  });
});
