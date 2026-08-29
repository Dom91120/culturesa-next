import { describe, expect, it } from "vitest";
import { resolveSlotRange, slotRunsOn } from "./slot-range";

const T1 = { periodStart: "2026-09-01", periodEnd: "2026-12-31" };

describe("resolveSlotRange — plage effective d'un créneau récurrent", () => {
  it("sans bornes propres : toute la période", () => {
    expect(resolveSlotRange(T1)).toEqual({ start: "2026-09-01", end: "2026-12-31" });
    expect(resolveSlotRange({ ...T1, slotStart: null, slotEnd: "" })).toEqual({
      start: "2026-09-01",
      end: "2026-12-31",
    });
  });

  it("restreint des deux côtés", () => {
    expect(resolveSlotRange({ ...T1, slotStart: "2026-11-05", slotEnd: "2026-12-19" })).toEqual({
      start: "2026-11-05",
      end: "2026-12-19",
    });
  });

  it("rogne sur la période : elle reste la borne extérieure", () => {
    // Un créneau qui déborde ne l'emporte pas sur sa période — sinon il génèrerait des
    // dates réservables en dehors d'elle.
    expect(resolveSlotRange({ ...T1, slotStart: "2026-08-01", slotEnd: "2027-02-01" })).toEqual({
      start: "2026-09-01",
      end: "2026-12-31",
    });
  });

  it("recouvrement VIDE → repli sur la période entière", () => {
    // La période a été déplacée sous le créneau. Sans ce repli, le créneau ne
    // s'afficherait plus sur aucune semaine : ni modifiable, ni supprimable.
    expect(
      resolveSlotRange({
        periodStart: "2027-01-01",
        periodEnd: "2027-03-31",
        slotStart: "2026-11-05",
        slotEnd: "2026-12-19",
      }),
    ).toEqual({ start: "2027-01-01", end: "2027-03-31" });
  });

  it("bornes croisées (fin avant début) → repli, pas de plage vide", () => {
    expect(resolveSlotRange({ ...T1, slotStart: "2026-12-01", slotEnd: "2026-10-01" })).toEqual({
      start: "2026-09-01",
      end: "2026-12-31",
    });
  });
});

describe("slotRunsOn — le créneau tourne-t-il ce jour-là ?", () => {
  const restreint = { ...T1, slotStart: "2026-11-05", slotEnd: "2026-12-19" };

  it("dans la plage, bornes incluses", () => {
    expect(slotRunsOn({ ...restreint, dateYmd: "2026-11-05" })).toBe(true);
    expect(slotRunsOn({ ...restreint, dateYmd: "2026-12-01" })).toBe(true);
    expect(slotRunsOn({ ...restreint, dateYmd: "2026-12-19" })).toBe(true);
  });

  it("hors plage, alors même que le jour appartient à la période", () => {
    // C'est tout l'objet du réglage : la colonne du jour reste ouverte (période),
    // seul CE créneau ne tourne pas encore.
    expect(slotRunsOn({ ...restreint, dateYmd: "2026-10-15" })).toBe(false);
    expect(slotRunsOn({ ...restreint, dateYmd: "2026-12-24" })).toBe(false);
  });

  it("période sans dates : aucune restriction", () => {
    // État légitime d'une période en cours de saisie (cf. schema.prisma).
    expect(slotRunsOn({ dateYmd: "2026-10-15", periodStart: null, periodEnd: null })).toBe(true);
  });
});
