import { describe, expect, it } from "vitest";
import { formatSlotLabel, slotTimeLabel } from "./slot-label";

describe("slotTimeLabel", () => {
  it("rend « HH:MM – HH:MM » avec un tiret demi-cadratin entouré d'espaces", () => {
    expect(slotTimeLabel("09:00", "10:00")).toBe("09:00 – 10:00");
  });

  it("tronque les heures à HH:MM (secondes ignorées)", () => {
    expect(slotTimeLabel("09:00:00", "10:30:00")).toBe("09:00 – 10:30");
  });

  it("rend « Journée entière » dès qu'une des deux heures est vide ou absente", () => {
    expect(slotTimeLabel("", "")).toBe("Journée entière");
    expect(slotTimeLabel("09:00", "")).toBe("Journée entière");
    expect(slotTimeLabel("", "10:00")).toBe("Journée entière");
    expect(slotTimeLabel(null, undefined)).toBe("Journée entière");
  });
});

describe("formatSlotLabel", () => {
  it("s'appuie sur slotTimeLabel pour la plage horaire (récurrent)", () => {
    expect(
      formatSlotLabel({
        startTime: "09:00:00",
        endTime: "10:00:00",
        slotDate: null,
        slotDay: "lun",
      }),
    ).toBe("Lundi · 09:00 – 10:00");
  });

  it("libelle un créneau journée entière daté", () => {
    expect(
      formatSlotLabel({
        startTime: "",
        endTime: "",
        slotDate: new Date("2026-09-17T00:00:00Z"),
        slotDay: null,
      }),
    ).toBe("jeudi 17 septembre 2026 · Journée entière");
  });
});
