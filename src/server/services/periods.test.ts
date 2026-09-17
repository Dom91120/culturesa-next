import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { parseYmdUtc } from "@/lib/date-utc";

// Le module sous test lit le client Prisma du module (`@/server/db`) directement, sans
// injection : on lui substitue un client factice dont CHAQUE méthode est un espion.
// `$transaction` rejoue la callback avec ce même client (tx === prisma) et mémorise
// les options (isolation, timeouts) pour les vérifier. `vi.hoisted` : les factories de
// vi.mock sont remontées en tête de module, les doubles qu'elles référencent aussi.
const { db, transaction } = vi.hoisted(() => {
  const transaction = vi.fn(
    async (cb: (tx: unknown) => Promise<unknown>, _opts?: Record<string, unknown>) => cb(db),
  );
  const db = {
    $transaction: transaction,
    exercice: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    period: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    periodHoliday: { deleteMany: vi.fn(), createMany: vi.fn() },
    booking: { count: vi.fn() },
  };
  return { db, transaction };
});
vi.mock("@/server/db", () => ({ prisma: db }));
// La régénération des miroirs (slots.ts) n'est pas l'objet du test : espionnée, et sa
// classe d'erreur redéfinie pour simuler le refus « miroir réservé ».
vi.mock("@/server/services/slots", () => {
  class SlotMutationError extends Error {}
  return { SlotMutationError, regenerateRecurringMirrorsForPeriodInTx: vi.fn(async () => {}) };
});
vi.mock("@/server/services/recurring-children", () => ({
  createSyncRecurringCache: vi.fn(() => ({ marker: "cache-partage" })),
}));

import {
  createExercice,
  createServicePeriod,
  deleteExercice,
  deleteServicePeriod,
  listServicePeriods,
  PeriodError,
  parseActiveDays,
  refreshPeriodHolidays,
  saveExerciceBookingDelay,
  saveExerciceMaxima,
  saveExerciceOpeningConfig,
  setExerciceVisibleToUsers,
  updateExercice,
  updateServicePeriod,
} from "./periods";
import { createSyncRecurringCache } from "./recurring-children";
import { regenerateRecurringMirrorsForPeriodInTx, SlotMutationError } from "./slots";

/**
 * Client transactionnel factice : on ne fournit que les modèles/méthodes que la
 * fonction sous test utilise ; tout accès imprévu explose (undefined is not a
 * function), ce qui est voulu — le test documente exactement ce que lit la fonction.
 */
function fakeTx(models: Record<string, unknown>): Prisma.TransactionClient {
  return models as unknown as Prisma.TransactionClient;
}

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("boom", {
    code,
    clientVersion: "test",
  });
}

/** « YYYY-MM-DD » → valeur @db.Date (minuit UTC), comme Prisma la remonte. */
const d = parseYmdUtc;

/** Dates « YYYY-MM-DD » des lignes passées à periodHoliday.createMany (triées). */
function createdHolidayDates(): string[] {
  const call = db.periodHoliday.createMany.mock.calls[0]?.[0] as
    | { data: { date: Date }[] }
    | undefined;
  return (call?.data ?? []).map((r) => r.date.toISOString().slice(0, 10)).sort();
}

/** Options de la première transaction ouverte (isolation, timeouts). */
function txOptions(): Record<string, unknown> | undefined {
  return transaction.mock.calls[0]?.[1];
}

const SERIALIZABLE = Prisma.TransactionIsolationLevel.Serializable;

beforeEach(() => {
  // `resetAllMocks` (et non clearAllMocks) : les tests posent des mockResolvedValue
  // par cas ; le reset rend à chaque espion son implémentation d'origine
  // ($transaction rejoue la callback, la régénération résout).
  vi.resetAllMocks();
});

// ─── refreshPeriodHolidays — remplissage de period_holidays ──────────────────

describe("refreshPeriodHolidays", () => {
  it("vide TOUJOURS la table de la période, même sans dates (état légitime après la bascule)", async () => {
    const deleteMany = vi.fn();
    const createMany = vi.fn();
    const tx = fakeTx({
      period: { findUnique: vi.fn(async () => ({ dateStart: null, dateEnd: null })) },
      periodHoliday: { deleteMany, createMany },
    });
    await expect(refreshPeriodHolidays(12, tx)).resolves.toBeUndefined();
    expect(deleteMany).toHaveBeenCalledWith({ where: { periodId: 12 } });
    expect(createMany).not.toHaveBeenCalled();
  });

  it("période introuvable : purge sans insertion, sans erreur", async () => {
    const deleteMany = vi.fn();
    const createMany = vi.fn();
    const tx = fakeTx({
      period: { findUnique: vi.fn(async () => null) },
      periodHoliday: { deleteMany, createMany },
    });
    await refreshPeriodHolidays(12, tx);
    expect(deleteMany).toHaveBeenCalledWith({ where: { periodId: 12 } });
    expect(createMany).not.toHaveBeenCalled();
  });

  it("fériés fixes de la plage (bornes incluses), en Date minuit UTC, avec skipDuplicates", async () => {
    const createMany = vi.fn();
    const tx = fakeTx({
      period: {
        findUnique: vi.fn(async () => ({ dateStart: d("2026-05-01"), dateEnd: d("2026-05-10") })),
      },
      periodHoliday: { deleteMany: vi.fn(), createMany },
    });
    await refreshPeriodHolidays(7, tx);
    expect(createMany).toHaveBeenCalledWith({
      data: [
        { periodId: 7, date: d("2026-05-01"), label: "Fête du Travail" },
        { periodId: 7, date: d("2026-05-08"), label: "Victoire 1945" },
      ],
      skipDuplicates: true,
    });
  });

  it("fériés mobiles (Pâques 2026 = 5 avril) : lundi de Pâques, Ascension, Pentecôte", async () => {
    const createMany = vi.fn();
    const tx = fakeTx({
      period: {
        findUnique: vi.fn(async () => ({ dateStart: d("2026-04-01"), dateEnd: d("2026-05-31") })),
      },
      periodHoliday: { deleteMany: vi.fn(), createMany },
    });
    await refreshPeriodHolidays(7, tx);
    const rows = (createMany.mock.calls[0][0] as { data: { date: Date; label: string }[] }).data;
    const byLabel = Object.fromEntries(
      rows.map((r) => [r.label, r.date.toISOString().slice(0, 10)]),
    );
    expect(byLabel).toEqual({
      "Fête du Travail": "2026-05-01",
      "Victoire 1945": "2026-05-08",
      "Lundi de Pâques": "2026-04-06",
      Ascension: "2026-05-14",
      "Lundi de Pentecôte": "2026-05-25",
    });
  });

  it("période à cheval sur deux années : Noël puis Jour de l'an", async () => {
    const createMany = vi.fn();
    const tx = fakeTx({
      period: {
        findUnique: vi.fn(async () => ({ dateStart: d("2026-12-20"), dateEnd: d("2027-01-05") })),
      },
      periodHoliday: { deleteMany: vi.fn(), createMany },
    });
    await refreshPeriodHolidays(7, tx);
    expect(createMany.mock.calls[0][0]).toEqual({
      data: [
        { periodId: 7, date: d("2026-12-25"), label: "Noël" },
        { periodId: 7, date: d("2027-01-01"), label: "Jour de l'an" },
      ],
      skipDuplicates: true,
    });
  });

  it("férié tombant un dimanche (Toussaint 2026) : inscrit quand même — la table ignore le jour de semaine", async () => {
    const createMany = vi.fn();
    const tx = fakeTx({
      period: {
        findUnique: vi.fn(async () => ({ dateStart: d("2026-10-26"), dateEnd: d("2026-11-08") })),
      },
      periodHoliday: { deleteMany: vi.fn(), createMany },
    });
    await refreshPeriodHolidays(7, tx);
    expect(d("2026-11-01").getUTCDay()).toBe(0); // dimanche
    expect(createMany.mock.calls[0][0].data).toEqual([
      { periodId: 7, date: d("2026-11-01"), label: "Toussaint" },
    ]);
  });

  it("plage sans férié (juin 2026) : purge, mais AUCUN createMany à vide", async () => {
    const deleteMany = vi.fn();
    const createMany = vi.fn();
    const tx = fakeTx({
      period: {
        findUnique: vi.fn(async () => ({ dateStart: d("2026-06-01"), dateEnd: d("2026-06-30") })),
      },
      periodHoliday: { deleteMany, createMany },
    });
    await refreshPeriodHolidays(7, tx);
    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(createMany).not.toHaveBeenCalled();
  });

  it("sans client explicite : travaille sur le client du module (hors transaction)", async () => {
    db.period.findUnique.mockResolvedValue({
      dateStart: d("2026-07-14"),
      dateEnd: d("2026-07-14"),
    });
    await refreshPeriodHolidays(3);
    expect(db.periodHoliday.deleteMany).toHaveBeenCalledWith({ where: { periodId: 3 } });
    expect(createdHolidayDates()).toEqual(["2026-07-14"]);
  });
});

// ─── Exercices ───────────────────────────────────────────────────────────────

describe("createExercice", () => {
  const base = { label: "2026-2027", type: "scolaire" as const };

  it("date de début après la date de fin → refus AVANT toute transaction", async () => {
    await expect(
      createExercice("s1", { ...base, dateStart: d("2026-09-01"), dateEnd: d("2026-08-31") }),
    ).rejects.toThrow("La date de début doit être avant la date de fin.");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("premier exercice du service → « affiché aux utilisateurs » ; un autre déjà visible → non", async () => {
    db.exercice.findFirst.mockResolvedValueOnce(null);
    db.exercice.create.mockResolvedValue({ id: 1 });
    await createExercice("s1", { ...base, dateStart: d("2026-09-01"), dateEnd: d("2027-07-04") });
    expect(db.exercice.findFirst).toHaveBeenCalledWith({
      where: { serviceId: "s1", visibleToUsers: true },
      select: { id: true },
    });
    expect(db.exercice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ serviceId: "s1", visibleToUsers: true }),
      }),
    );

    db.exercice.findFirst.mockResolvedValueOnce({ id: 1 });
    await createExercice("s1", { ...base, label: "2027-2028", dateStart: null, dateEnd: null });
    expect(db.exercice.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ visibleToUsers: false }) }),
    );
  });

  it("début = fin (exercice d'un jour) et dates absentes : acceptés", async () => {
    db.exercice.findFirst.mockResolvedValue(null);
    db.exercice.create.mockResolvedValue({ id: 1 });
    await expect(
      createExercice("s1", { ...base, dateStart: d("2026-09-01"), dateEnd: d("2026-09-01") }),
    ).resolves.toEqual({ id: 1 });
    await expect(
      createExercice("s1", { ...base, dateStart: null, dateEnd: d("2026-09-01") }),
    ).resolves.toEqual({ id: 1 });
  });
});

describe("updateExercice", () => {
  it("exercice absent ou d'un autre service → « Exercice introuvable. » (anti-IDOR), rien n'est écrit", async () => {
    db.exercice.findUnique.mockResolvedValueOnce(null);
    await expect(updateExercice("s1", 9, { label: "x" })).rejects.toThrow("Exercice introuvable.");
    db.exercice.findUnique.mockResolvedValueOnce({
      serviceId: "AUTRE",
      dateStart: null,
      dateEnd: null,
    });
    await expect(updateExercice("s1", 9, { label: "x" })).rejects.toThrow(PeriodError);
    expect(db.exercice.update).not.toHaveBeenCalled();
  });

  it("libellé/type seuls : pas de contrôle des périodes, data limité aux champs fournis", async () => {
    db.exercice.findUnique.mockResolvedValue({ serviceId: "s1", dateStart: null, dateEnd: null });
    db.exercice.update.mockResolvedValue({ id: 9 });
    await updateExercice("s1", 9, { label: "Nouveau" });
    expect(db.period.findMany).not.toHaveBeenCalled();
    expect(db.exercice.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 9 }, data: { label: "Nouveau" } }),
    );
  });

  it("nouvelle date combinée à la date courante inchangée : début > fin → refus", async () => {
    db.exercice.findUnique.mockResolvedValue({
      serviceId: "s1",
      dateStart: d("2026-09-01"),
      dateEnd: d("2027-07-04"),
    });
    await expect(updateExercice("s1", 9, { dateEnd: d("2026-08-01") })).rejects.toThrow(
      "La date de début doit être avant la date de fin.",
    );
  });

  it("resserrer les dates alors qu'une période datée en sortirait → refus nommant la période", async () => {
    db.exercice.findUnique.mockResolvedValue({
      serviceId: "s1",
      dateStart: d("2026-09-01"),
      dateEnd: d("2027-07-04"),
    });
    db.period.findMany.mockResolvedValue([
      { label: "Trimestre 1", dateStart: d("2026-09-01"), dateEnd: d("2026-12-18") },
      { label: "Trimestre 3", dateStart: d("2027-03-01"), dateEnd: d("2027-07-04") },
    ]);
    await expect(updateExercice("s1", 9, { dateEnd: d("2027-06-30") })).rejects.toThrow(
      "La période « Trimestre 3 » sortirait de la plage de l'exercice.",
    );
    expect(db.exercice.update).not.toHaveBeenCalled();
    // Seules les périodes DATÉES sont contrôlées : une période sans dates (bascule) ne bloque pas.
    expect(db.period.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { exerciceId: 9, dateStart: { not: null }, dateEnd: { not: null } },
      }),
    );
  });

  it("élargir les dates : les périodes tiennent, update avec les deux dates", async () => {
    db.exercice.findUnique.mockResolvedValue({
      serviceId: "s1",
      dateStart: d("2026-09-01"),
      dateEnd: d("2027-07-04"),
    });
    db.period.findMany.mockResolvedValue([
      { label: "T1", dateStart: d("2026-09-01"), dateEnd: d("2026-12-18") },
    ]);
    db.exercice.update.mockResolvedValue({ id: 9 });
    await updateExercice("s1", 9, { dateStart: d("2026-08-24"), dateEnd: d("2027-07-10") });
    expect(db.exercice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { dateStart: d("2026-08-24"), dateEnd: d("2027-07-10") },
      }),
    );
  });
});

describe("deleteExercice", () => {
  it("anti-IDOR : exercice d'un autre service → refus", async () => {
    db.exercice.findUnique.mockResolvedValue({ serviceId: "AUTRE", _count: { periods: 0 } });
    await expect(deleteExercice("s1", 9)).rejects.toThrow("Exercice introuvable.");
    expect(db.exercice.delete).not.toHaveBeenCalled();
  });

  it("refuse tant qu'il reste des périodes ; supprime sinon", async () => {
    db.exercice.findUnique.mockResolvedValueOnce({ serviceId: "s1", _count: { periods: 2 } });
    await expect(deleteExercice("s1", 9)).rejects.toThrow(
      "Supprimez d'abord les périodes de cet exercice.",
    );
    expect(db.exercice.delete).not.toHaveBeenCalled();

    db.exercice.findUnique.mockResolvedValueOnce({ serviceId: "s1", _count: { periods: 0 } });
    await deleteExercice("s1", 9);
    expect(db.exercice.delete).toHaveBeenCalledWith({ where: { id: 9 } });
  });
});

// ─── Périodes : création ─────────────────────────────────────────────────────

const exo = { serviceId: "s1", dateStart: d("2026-09-01"), dateEnd: d("2027-07-04") };

const periodInput = {
  exerciceId: 5,
  label: "Trimestre 2",
  etiquette: null,
  dateStart: d("2027-01-04"),
  dateEnd: d("2027-02-26"),
  disponibilite: d("2026-12-01"),
  color: "#abcdef",
};

describe("createServicePeriod", () => {
  it("exercice d'un autre service → refus, aucune transaction", async () => {
    db.exercice.findUnique.mockResolvedValue({ ...exo, serviceId: "AUTRE" });
    await expect(createServicePeriod("s1", periodInput)).rejects.toThrow("Exercice introuvable.");
    expect(transaction).not.toHaveBeenCalled();
    expect(db.period.create).not.toHaveBeenCalled();
  });

  it("date de début après la date de fin → refus (CHECK dates ordonnées, côté applicatif)", async () => {
    db.exercice.findUnique.mockResolvedValue(exo);
    await expect(
      createServicePeriod("s1", {
        ...periodInput,
        dateStart: d("2027-02-26"),
        dateEnd: d("2027-01-04"),
      }),
    ).rejects.toThrow("La date de début doit être avant la date de fin.");
  });

  it("période débordant l'exercice (avant le début OU après la fin) → refus", async () => {
    db.exercice.findUnique.mockResolvedValue(exo);
    await expect(
      createServicePeriod("s1", { ...periodInput, dateStart: d("2026-08-31") }),
    ).rejects.toThrow("La période doit tenir dans les dates de l'exercice.");
    await expect(
      createServicePeriod("s1", { ...periodInput, dateEnd: d("2027-07-05") }),
    ).rejects.toThrow("La période doit tenir dans les dates de l'exercice.");
  });

  it("exercice sans dates : la période datée n'est pas bornée par l'exercice", async () => {
    db.exercice.findUnique.mockResolvedValue({ serviceId: "s1", dateStart: null, dateEnd: null });
    db.period.findMany.mockResolvedValue([]);
    db.period.create.mockResolvedValue({ id: 31, dateStart: null, dateEnd: null });
    await expect(
      createServicePeriod("s1", { ...periodInput, dateStart: d("2000-01-01") }),
    ).resolves.toEqual(expect.objectContaining({ id: 31 }));
  });

  it("chevauchement d'une période sœur du MÊME exercice → refus avec ses dates ; bornes touchantes = chevauchement", async () => {
    db.exercice.findUnique.mockResolvedValue(exo);
    db.period.findMany.mockResolvedValue([
      { dateStart: d("2026-09-01"), dateEnd: d("2026-12-18") },
    ]);
    await expect(
      createServicePeriod("s1", { ...periodInput, dateStart: d("2026-12-18") }),
    ).rejects.toThrow(
      "La période chevauche une autre période de l'exercice (2026-09-01 → 2026-12-18).",
    );
    expect(db.period.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { exerciceId: 5, dateStart: { not: null }, dateEnd: { not: null } },
      }),
    );
    expect(db.period.create).not.toHaveBeenCalled();
  });

  it("période adjacente (lendemain de la fin d'une sœur) : acceptée", async () => {
    db.exercice.findUnique.mockResolvedValue(exo);
    db.period.findMany.mockResolvedValue([
      { dateStart: d("2026-09-01"), dateEnd: d("2026-12-18") },
      // Sœur sans dates (bascule) : ignorée par le contrôle.
      { dateStart: null, dateEnd: null },
    ]);
    db.period.create.mockResolvedValue({
      id: 31,
      dateStart: d("2026-12-19"),
      dateEnd: d("2027-02-26"),
    });
    await expect(
      createServicePeriod("s1", { ...periodInput, dateStart: d("2026-12-19") }),
    ).resolves.toEqual(expect.objectContaining({ id: 31 }));
  });

  it("création : insert puis remplissage de period_holidays DANS la même transaction", async () => {
    db.exercice.findUnique.mockResolvedValue(exo);
    db.period.findMany.mockResolvedValue([]);
    // La période créée est relue par refreshPeriodHolidays (findUnique) : Noël + Jour de l'an.
    db.period.create.mockResolvedValue({
      id: 31,
      dateStart: d("2026-12-14"),
      dateEnd: d("2027-01-08"),
    });
    db.period.findUnique.mockResolvedValue({
      dateStart: d("2026-12-14"),
      dateEnd: d("2027-01-08"),
    });
    const input = { ...periodInput, dateStart: d("2026-12-14"), dateEnd: d("2027-01-08") };
    await expect(createServicePeriod("s1", input)).resolves.toEqual(
      expect.objectContaining({ id: 31 }),
    );
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(db.period.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          serviceId: "s1",
          exerciceId: 5,
          label: "Trimestre 2",
          etiquette: null,
          dateStart: d("2026-12-14"),
          dateEnd: d("2027-01-08"),
          disponibilite: d("2026-12-01"),
          color: "#abcdef",
        },
      }),
    );
    expect(db.periodHoliday.deleteMany).toHaveBeenCalledWith({ where: { periodId: 31 } });
    expect(createdHolidayDates()).toEqual(["2026-12-25", "2027-01-01"]);
    // Ordre : create avant la purge/insertion des fériés.
    expect(db.period.create.mock.invocationCallOrder[0]).toBeLessThan(
      db.periodHoliday.deleteMany.mock.invocationCallOrder[0],
    );
  });

  it("période SANS dates : aucun contrôle de chevauchement, création OK, table de fériés vide", async () => {
    db.exercice.findUnique.mockResolvedValue(exo);
    db.period.create.mockResolvedValue({ id: 32, dateStart: null, dateEnd: null });
    db.period.findUnique.mockResolvedValue({ dateStart: null, dateEnd: null });
    await createServicePeriod("s1", { ...periodInput, dateStart: null, dateEnd: null });
    expect(db.period.findMany).not.toHaveBeenCalled();
    expect(db.periodHoliday.deleteMany).toHaveBeenCalledWith({ where: { periodId: 32 } });
    expect(db.periodHoliday.createMany).not.toHaveBeenCalled();
  });
});

// ─── Périodes : mise à jour ──────────────────────────────────────────────────

const currentPeriod = {
  serviceId: "s1",
  exerciceId: 5,
  dateStart: d("2027-01-04"),
  dateEnd: d("2027-02-26"),
};

describe("updateServicePeriod", () => {
  it("période absente, sans service ou d'un autre service → « Période introuvable. »", async () => {
    db.period.findUnique.mockResolvedValueOnce(null);
    await expect(updateServicePeriod("s1", 31, { label: "x" })).rejects.toThrow(
      "Période introuvable.",
    );
    db.period.findUnique.mockResolvedValueOnce({ ...currentPeriod, serviceId: null });
    await expect(updateServicePeriod("s1", 31, { label: "x" })).rejects.toThrow(PeriodError);
    db.period.findUnique.mockResolvedValueOnce({ ...currentPeriod, serviceId: "AUTRE" });
    await expect(updateServicePeriod("s1", 31, { label: "x" })).rejects.toThrow(PeriodError);
    expect(db.period.update).not.toHaveBeenCalled();
  });

  it("changement SANS dates (libellé, couleur, dispo) : simple update, ni transaction ni régénération", async () => {
    db.period.findUnique.mockResolvedValue(currentPeriod);
    db.period.update.mockResolvedValue({ id: 31 });
    await updateServicePeriod("s1", 31, {
      label: "T2",
      color: "#000000",
      disponibilite: null,
      etiquette: "hiver",
    });
    expect(db.period.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 31 },
        data: { label: "T2", color: "#000000", disponibilite: null, etiquette: "hiver" },
      }),
    );
    expect(transaction).not.toHaveBeenCalled();
    expect(db.exercice.findUnique).not.toHaveBeenCalled();
    expect(regenerateRecurringMirrorsForPeriodInTx).not.toHaveBeenCalled();
    expect(db.periodHoliday.deleteMany).not.toHaveBeenCalled();
  });

  it("une seule date fournie : l'autre est lue sur la période courante, puis validée dans l'exercice", async () => {
    db.period.findUnique.mockResolvedValue(currentPeriod);
    db.exercice.findUnique.mockResolvedValue(exo);
    db.period.findMany.mockResolvedValue([]);
    db.period.update.mockResolvedValue({ id: 31 });
    await updateServicePeriod("s1", 31, { dateEnd: d("2027-03-05") });
    expect(db.exercice.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5 } }),
    );
    // Chevauchement : la période elle-même est exclue des sœurs.
    expect(db.period.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          exerciceId: 5,
          dateStart: { not: null },
          dateEnd: { not: null },
          id: { not: 31 },
        },
      }),
    );
    expect(db.period.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { dateStart: d("2027-01-04"), dateEnd: d("2027-03-05") },
      }),
    );
  });

  it("nouvelles dates chevauchant une sœur → refus AVANT la transaction", async () => {
    db.period.findUnique.mockResolvedValue(currentPeriod);
    db.exercice.findUnique.mockResolvedValue(exo);
    db.period.findMany.mockResolvedValue([
      { dateStart: d("2027-03-01"), dateEnd: d("2027-04-30") },
    ]);
    await expect(updateServicePeriod("s1", 31, { dateEnd: d("2027-03-01") })).rejects.toThrow(
      "La période chevauche une autre période de l'exercice (2027-03-01 → 2027-04-30).",
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it("dates changées : update → fériés rafraîchis → miroirs régénérés, en transaction sérialisable 60 s", async () => {
    db.period.findUnique
      .mockResolvedValueOnce(currentPeriod) // lecture anti-IDOR
      .mockResolvedValueOnce({ dateStart: d("2027-01-04"), dateEnd: d("2027-05-14") }); // refresh
    db.exercice.findUnique.mockResolvedValue(exo);
    db.period.findMany.mockResolvedValue([]);
    db.period.update.mockResolvedValue({ id: 31 });
    await expect(updateServicePeriod("s1", 31, { dateEnd: d("2027-05-14") })).resolves.toEqual({
      id: 31,
    });
    expect(txOptions()).toEqual({ isolationLevel: SERIALIZABLE, timeout: 60_000, maxWait: 10_000 });
    expect(regenerateRecurringMirrorsForPeriodInTx).toHaveBeenCalledWith(db, "s1", 31);
    // Pâques 2027 = 28 mars → lundi de Pâques 29/03, Ascension 06/05 ; + 1er et 8 mai.
    expect(createdHolidayDates()).toEqual(["2027-03-29", "2027-05-01", "2027-05-06", "2027-05-08"]);
    const order = [
      db.period.update.mock.invocationCallOrder[0],
      db.periodHoliday.deleteMany.mock.invocationCallOrder[0],
      vi.mocked(regenerateRecurringMirrorsForPeriodInTx).mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("RÈGLE PRODUIT : un miroir réservé sortirait de la plage → la régénération refuse, le refus devient PeriodError", async () => {
    db.period.findUnique.mockResolvedValue(currentPeriod);
    db.exercice.findUnique.mockResolvedValue(exo);
    db.period.findMany.mockResolvedValue([]);
    db.period.update.mockResolvedValue({ id: 31 });
    vi.mocked(regenerateRecurringMirrorsForPeriodInTx).mockRejectedValueOnce(
      new SlotMutationError("Un créneau réservé le 2027-02-24 sortirait de la période."),
    );
    const p = updateServicePeriod("s1", 31, { dateEnd: d("2027-02-19") });
    await expect(p).rejects.toBeInstanceOf(PeriodError);
    // L'update des dates a bien été tenté DANS la transaction : c'est le rejet de la
    // callback qui annule tout (atomicité garantie par Prisma, pas rejouée ici).
    expect(db.period.update).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("le refus de la régénération remonte avec son message ; toute autre erreur est relancée telle quelle", async () => {
    db.period.findUnique.mockResolvedValue(currentPeriod);
    db.exercice.findUnique.mockResolvedValue(exo);
    db.period.findMany.mockResolvedValue([]);
    db.period.update.mockResolvedValue({ id: 31 });
    vi.mocked(regenerateRecurringMirrorsForPeriodInTx).mockRejectedValueOnce(
      new SlotMutationError("Miroir réservé hors plage."),
    );
    await expect(updateServicePeriod("s1", 31, { dateEnd: d("2027-02-19") })).rejects.toThrow(
      "Miroir réservé hors plage.",
    );
    vi.mocked(regenerateRecurringMirrorsForPeriodInTx).mockRejectedValueOnce(prismaError("P2034"));
    await expect(updateServicePeriod("s1", 31, { dateEnd: d("2027-02-19") })).rejects.toThrow(
      Prisma.PrismaClientKnownRequestError,
    );
  });

  it("période sans exercice de rattachement : dates changées sans contrôle d'exercice, régénération quand même", async () => {
    db.period.findUnique.mockResolvedValue({ ...currentPeriod, exerciceId: null });
    db.period.update.mockResolvedValue({ id: 31 });
    await updateServicePeriod("s1", 31, { dateStart: d("2027-01-11") });
    expect(db.exercice.findUnique).not.toHaveBeenCalled();
    expect(db.period.findMany).not.toHaveBeenCalled();
    expect(regenerateRecurringMirrorsForPeriodInTx).toHaveBeenCalledWith(db, "s1", 31);
  });
});

// ─── Périodes : suppression ──────────────────────────────────────────────────

describe("deleteServicePeriod", () => {
  it("anti-IDOR : période absente ou d'un autre service → refus sans transaction", async () => {
    db.period.findUnique.mockResolvedValueOnce(null);
    await expect(deleteServicePeriod("s1", 31)).rejects.toThrow("Période introuvable.");
    db.period.findUnique.mockResolvedValueOnce({ serviceId: "AUTRE" });
    await expect(deleteServicePeriod("s1", 31)).rejects.toThrow("Période introuvable.");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("GARDE « miroir réservé » : une réservation sur un créneau de la période OU rattachée à la période → refus", async () => {
    db.period.findUnique.mockResolvedValue({ serviceId: "s1" });
    db.booking.count.mockResolvedValue(1);
    await expect(deleteServicePeriod("s1", 31)).rejects.toThrow(
      "Des réservations existent sur cette période — annulez-les d'abord.",
    );
    expect(db.booking.count).toHaveBeenCalledWith({
      where: { OR: [{ slot: { periodId: 31 } }, { periodId: 31 }] },
    });
    expect(db.period.delete).not.toHaveBeenCalled();
  });

  it("aucune réservation : suppression, vérif + delete dans UNE transaction sérialisable", async () => {
    db.period.findUnique.mockResolvedValue({ serviceId: "s1" });
    db.booking.count.mockResolvedValue(0);
    db.period.delete.mockResolvedValue({ id: 31 });
    await expect(deleteServicePeriod("s1", 31)).resolves.toEqual({ id: 31 });
    expect(txOptions()).toEqual({ isolationLevel: SERIALIZABLE });
    expect(db.period.delete).toHaveBeenCalledWith({ where: { id: 31 } });
  });

  it("conflit de sérialisation (P2034) → message « réessayez » ; autre erreur Prisma relancée", async () => {
    db.period.findUnique.mockResolvedValue({ serviceId: "s1" });
    db.booking.count.mockResolvedValue(0);
    db.period.delete.mockRejectedValueOnce(prismaError("P2034"));
    await expect(deleteServicePeriod("s1", 31)).rejects.toThrow(
      "Modification simultanée détectée, réessayez.",
    );
    db.period.delete.mockRejectedValueOnce(prismaError("P2003"));
    await expect(deleteServicePeriod("s1", 31)).rejects.toThrow(
      Prisma.PrismaClientKnownRequestError,
    );
  });
});

// ─── Config d'ouverture de l'exercice ────────────────────────────────────────

const openingConfig = {
  activeDays: ["ven", "lun", "mer", "zzz"],
  openOnHolidays: false,
  openOnSchoolHolidays: true,
  morningStart: "09:00",
  morningEnd: "12:00",
  afternoonStart: "14:00",
  afternoonEnd: "17:00",
};

describe("saveExerciceOpeningConfig", () => {
  it("anti-IDOR : exercice d'un autre service → refus sans transaction", async () => {
    db.exercice.findUnique.mockResolvedValue({ serviceId: "AUTRE" });
    await expect(saveExerciceOpeningConfig("s1", 5, openingConfig)).rejects.toThrow(
      "Exercice introuvable.",
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it("jours actifs normalisés (ordre lun→dim, inconnus écartés) et config écrite sur l'exercice", async () => {
    db.exercice.findUnique.mockResolvedValue({ serviceId: "s1" });
    db.period.findMany.mockResolvedValue([]);
    await saveExerciceOpeningConfig("s1", 5, openingConfig);
    expect(db.exercice.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: {
        activeDays: "lun,mer,ven",
        openOnHolidays: false,
        openOnSchoolHolidays: true,
        morningStart: "09:00",
        morningEnd: "12:00",
        afternoonStart: "14:00",
        afternoonEnd: "17:00",
      },
    });
  });

  it("régénère les miroirs de TOUTES les périodes de l'exercice (scope service) avec UN cache partagé, transaction 120 s", async () => {
    db.exercice.findUnique.mockResolvedValue({ serviceId: "s1" });
    db.period.findMany.mockResolvedValue([{ id: 31 }, { id: 32 }, { id: 33 }]);
    await saveExerciceOpeningConfig("s1", 5, openingConfig);
    expect(db.period.findMany).toHaveBeenCalledWith({
      where: { exerciceId: 5, serviceId: "s1" },
      select: { id: true },
    });
    expect(txOptions()).toEqual({
      isolationLevel: SERIALIZABLE,
      timeout: 120_000,
      maxWait: 10_000,
    });
    const regen = vi.mocked(regenerateRecurringMirrorsForPeriodInTx);
    expect(regen).toHaveBeenCalledTimes(3);
    const cache = { marker: "cache-partage" };
    expect(regen.mock.calls.map((c) => c[2])).toEqual([31, 32, 33]);
    for (const c of regen.mock.calls) expect(c).toEqual([db, "s1", expect.any(Number), cache]);
    expect(createSyncRecurringCache).toHaveBeenCalledTimes(1);
    // Le cache est créé APRÈS l'update de l'exercice : il capture la nouvelle config.
    expect(db.exercice.update.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(createSyncRecurringCache).mock.invocationCallOrder[0],
    );
  });

  it("refus de la régénération (jour désormais fermé mais réservé) → PeriodError, la config n'est pas validée", async () => {
    db.exercice.findUnique.mockResolvedValue({ serviceId: "s1" });
    db.period.findMany.mockResolvedValue([{ id: 31 }]);
    vi.mocked(regenerateRecurringMirrorsForPeriodInTx).mockRejectedValueOnce(
      new SlotMutationError("Réservation un mercredi désormais fermé."),
    );
    const p = saveExerciceOpeningConfig("s1", 5, openingConfig);
    await expect(p).rejects.toThrow(PeriodError);
    await expect(saveExerciceOpeningConfig("s1", 5, openingConfig)).resolves.toBeUndefined();
  });
});

describe("parseActiveDays", () => {
  it("ordre canonique lun→dim, espaces tolérés, doublons et inconnus écartés, vide → []", () => {
    expect(parseActiveDays(" ven, lun ,mer,lun,xyz")).toEqual(["lun", "mer", "ven"]);
    expect(parseActiveDays("")).toEqual([]);
    expect(parseActiveDays("dim,sam")).toEqual(["sam", "dim"]);
  });
});

// ─── Maxima, délai, exercice visible ─────────────────────────────────────────

describe("saveExerciceMaxima", () => {
  it("plancher 1 et « par an » plafonné à « par période » × nombre de périodes", async () => {
    db.exercice.findUnique.mockResolvedValue({ serviceId: "s1" });
    db.period.count.mockResolvedValue(3);
    await saveExerciceMaxima("s1", 5, { maxReservations: 50, maxReservationsPeriod: 0 });
    expect(db.exercice.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { maxReservations: 3, maxReservationsPeriod: 1 },
    });
  });

  it("exercice sans période : pas de plafonnement du « par an »", async () => {
    db.exercice.findUnique.mockResolvedValue({ serviceId: "s1" });
    db.period.count.mockResolvedValue(0);
    await saveExerciceMaxima("s1", 5, { maxReservations: 50, maxReservationsPeriod: 2 });
    expect(db.exercice.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { maxReservations: 50, maxReservationsPeriod: 2 } }),
    );
  });

  it("anti-IDOR partagé par toutes les écritures d'exercice (maxima, délai, visibilité)", async () => {
    db.exercice.findUnique.mockResolvedValue(null);
    await expect(
      saveExerciceMaxima("s1", 5, { maxReservations: 1, maxReservationsPeriod: 1 }),
    ).rejects.toThrow("Exercice introuvable.");
    await expect(saveExerciceBookingDelay("s1", 5, 1)).rejects.toThrow("Exercice introuvable.");
    await expect(setExerciceVisibleToUsers("s1", 5, true)).rejects.toThrow("Exercice introuvable.");
    expect(db.exercice.update).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("saveExerciceBookingDelay", () => {
  it("délai tronqué à l'entier (encodage legacy conservé)", async () => {
    db.exercice.findUnique.mockResolvedValue({ serviceId: "s1" });
    await saveExerciceBookingDelay("s1", 5, 2.9);
    expect(db.exercice.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { bookingDelay: 2 },
    });
  });
});

describe("setExerciceVisibleToUsers — UN seul exercice visible par service", () => {
  it("cocher décoche d'abord les autres exercices du service, dans une transaction", async () => {
    db.exercice.findUnique.mockResolvedValue({ serviceId: "s1" });
    await setExerciceVisibleToUsers("s1", 5, true);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(db.exercice.updateMany).toHaveBeenCalledWith({
      where: { serviceId: "s1", visibleToUsers: true },
      data: { visibleToUsers: false },
    });
    expect(db.exercice.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { visibleToUsers: true },
    });
    expect(db.exercice.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      db.exercice.update.mock.invocationCallOrder[0],
    );
  });

  it("décocher laisse le service sans exercice visible (aucun autre n'est coché)", async () => {
    db.exercice.findUnique.mockResolvedValue({ serviceId: "s1" });
    await setExerciceVisibleToUsers("s1", 5, false);
    expect(db.exercice.updateMany).not.toHaveBeenCalled();
    expect(db.exercice.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { visibleToUsers: false },
    });
  });
});

// ─── Listage : tri legacy ────────────────────────────────────────────────────

describe("listServicePeriods", () => {
  it("périodes : dateStart croissant, sans dates EN DERNIER, puis id ; exercices : dateStart puis libellé", async () => {
    const row = (id: number, dateStart: string | null) => ({
      id,
      label: `P${id}`,
      etiquette: null,
      dateStart: dateStart ? d(dateStart) : null,
      dateEnd: null,
      disponibilite: null,
      color: "#fff",
      exerciceId: 5,
    });
    db.period.findMany.mockResolvedValue([
      row(4, null),
      row(3, "2027-01-04"),
      row(2, null),
      row(1, "2026-09-01"),
      row(5, "2026-09-01"),
    ]);
    db.exercice.findMany.mockResolvedValue([
      { id: 8, label: "Zêta", dateStart: null },
      { id: 7, label: "Beta", dateStart: d("2026-09-01") },
      { id: 6, label: "Alpha", dateStart: d("2026-09-01") },
      { id: 9, label: "Ancien", dateStart: d("2025-09-01") },
    ]);
    const { periods, exercices } = await listServicePeriods("s1");
    expect(periods.map((p) => p.id)).toEqual([1, 5, 3, 2, 4]);
    expect(exercices.map((e) => e.id)).toEqual([9, 6, 7, 8]);
    expect(db.period.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { serviceId: "s1" } }),
    );
    expect(db.exercice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { serviceId: "s1" } }),
    );
  });
});
