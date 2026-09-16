import { describe, expect, it } from "vitest";
import { isOfferDateClosed, type OfferExercice } from "./offer-closure";

const exo = (over: Partial<OfferExercice> = {}): OfferExercice => ({
  dateStart: "2026-09-01",
  dateEnd: "2027-06-30",
  activeDays: "lun,mar,jeu,ven",
  openOnHolidays: false,
  openOnSchoolHolidays: false,
  ...over,
});
// Vacances d'hiver 2027 (zone C) : bornes au format des plages (début exclu, fin incluse).
const hiver = [{ dateStart: "2027-02-06", dateEnd: "2027-02-21" }];

describe("isOfferDateClosed", () => {
  it("vacances scolaires fermées → date de vacances fermée", () => {
    expect(isOfferDateClosed("2027-02-08", [exo()], hiver)).toBe(true);
  });
  it("vacances scolaires ouvertes → date de vacances ouverte", () => {
    expect(isOfferDateClosed("2027-02-08", [exo({ openOnSchoolHolidays: true })], hiver)).toBe(
      false,
    );
  });
  it("jour ordinaire hors vacances → ouvert", () => {
    expect(isOfferDateClosed("2027-03-01", [exo()], hiver)).toBe(false);
  });
  it("jour inactif de l'exercice (mercredi) → fermé", () => {
    expect(isOfferDateClosed("2027-03-03", [exo()], hiver)).toBe(true);
  });
  it("férié fermé → fermé ; férié ouvert → ouvert", () => {
    expect(isOfferDateClosed("2027-05-06", [exo()], [])).toBe(true); // Ascension 2027 (jeudi)
    expect(isOfferDateClosed("2027-05-06", [exo({ openOnHolidays: true })], [])).toBe(false);
  });
  it("date hors de tout exercice → jamais fermée par ce prédicat", () => {
    expect(isOfferDateClosed("2026-02-09", [exo()], hiver)).toBe(false);
  });
});
