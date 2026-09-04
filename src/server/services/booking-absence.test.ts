import { describe, expect, it, vi } from "vitest";

// `bookings` (BookingError) importe le client Prisma et les guards : neutralisés.
vi.mock("@/server/db", () => ({ prisma: {} }));
vi.mock("@/server/guards", () => ({ getSession: vi.fn(async () => null) }));
vi.mock("@/server/services/holidays", () => ({
  getSchoolZone: vi.fn(async () => "C"),
  loadSchoolHolidayRanges: vi.fn(async () => []),
}));

import {
  absencePrevenueAtFromYmd,
  absenceWriteData,
  assertAbsenceDeclarable,
} from "./booking-absence";
import { BookingError } from "./bookings";

const TODAY = "2026-09-04";
const dated = (ymd: string, pointage: string | null = null) => ({
  bookingType: "unique",
  pointage,
  slot: { slotDate: new Date(`${ymd}T00:00:00Z`) },
});

describe("assertAbsenceDeclarable", () => {
  it("accepte une séance datée à venir non pointée", () => {
    expect(() => assertAbsenceDeclarable(dated("2026-09-10"), TODAY)).not.toThrow();
  });

  it("accepte le jour même (on n'est pas à l'heure près)", () => {
    expect(() => assertAbsenceDeclarable(dated(TODAY), TODAY)).not.toThrow();
  });

  it("refuse une parente récurrente (le signalement est par occurrence)", () => {
    expect(() =>
      assertAbsenceDeclarable(
        { bookingType: "recurring", pointage: null, slot: { slotDate: null } },
        TODAY,
      ),
    ).toThrow(BookingError);
  });

  it("refuse une réservation sans date", () => {
    expect(() =>
      assertAbsenceDeclarable(
        { bookingType: "unique", pointage: null, slot: { slotDate: null } },
        TODAY,
      ),
    ).toThrow(/séance datée/);
  });

  it("refuse une séance déjà pointée (présente ou absente)", () => {
    expect(() => assertAbsenceDeclarable(dated("2026-09-10", "present"), TODAY)).toThrow(
      /déjà pointée/,
    );
    expect(() => assertAbsenceDeclarable(dated("2026-09-10", "absent"), TODAY)).toThrow(
      /déjà pointée/,
    );
  });

  it("refuse une séance passée (relève du pointage)", () => {
    expect(() => assertAbsenceDeclarable(dated("2026-09-03"), TODAY)).toThrow(/passée/);
  });

  it("gestionnaire (allowPast) : accepte une séance passée tant qu'elle n'est pas pointée", () => {
    expect(() =>
      assertAbsenceDeclarable(dated("2026-09-03"), TODAY, { allowPast: true }),
    ).not.toThrow();
    expect(() =>
      assertAbsenceDeclarable(dated("2026-09-03", "absent"), TODAY, { allowPast: true }),
    ).toThrow(/déjà pointée/);
  });
});

describe("absenceWriteData", () => {
  it("pose l'absence avec auteur, horodatage et motif borné", () => {
    const d = absenceWriteData(true, "usager", `  ${"x".repeat(300)}  `);
    expect(d.absencePrevenuePar).toBe("usager");
    expect(d.absencePrevenueAt).toBeInstanceOf(Date);
    expect(d.pointageMotif).toHaveLength(255);
  });

  it("ne touche pas au motif quand il n'est pas fourni", () => {
    const d = absenceWriteData(true, "gestionnaire", undefined);
    expect("pointageMotif" in d).toBe(false);
  });

  it("date de signalement choisie (gestionnaire) : posée telle quelle, lue au bon jour à Paris", () => {
    const at = absencePrevenueAtFromYmd("2026-09-02");
    const d = absenceWriteData(true, "gestionnaire", undefined, at);
    expect(d.absencePrevenueAt).toBe(at);
    expect(at.toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" })).toBe("2026-09-02");
    // Idem en hiver (UTC+1) : midi +02:00 = 11 h Paris, toujours le même jour.
    expect(
      absencePrevenueAtFromYmd("2026-01-15").toLocaleDateString("fr-CA", {
        timeZone: "Europe/Paris",
      }),
    ).toBe("2026-01-15");
  });

  it("retire l'absence en conservant le motif stocké", () => {
    const d = absenceWriteData(false, "usager", undefined);
    expect(d.absencePrevenueAt).toBeNull();
    expect(d.absencePrevenuePar).toBeNull();
    expect("pointageMotif" in d).toBe(false);
  });
});
