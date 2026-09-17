import { beforeEach, describe, expect, it, vi } from "vitest";

// `vi.hoisted` : les factories de vi.mock sont remontées en tête de module, les doubles
// qu'elles référencent doivent l'être aussi.
const { queryRaw, transaction, configStore } = vi.hoisted(() => {
  const queryRaw = vi.fn();
  const transaction = vi.fn(
    async (fn: (tx: unknown) => Promise<unknown>, _opts?: { timeout?: number }) =>
      fn({ $queryRaw: queryRaw }),
  );
  return { queryRaw, transaction, configStore: new Map<string, string>() };
});
vi.mock("@/server/db", () => ({ prisma: { $transaction: transaction } }));
vi.mock("@/server/config", () => ({
  getConfigMany: vi.fn(async (keys: string[]) =>
    Object.fromEntries(keys.map((k) => [k, configStore.get(k) ?? ""])),
  ),
  setConfig: vi.fn(async (k: string, v: string) => {
    configStore.set(k, v);
  }),
}));

import {
  cronLockId,
  getCronSchedule,
  getLastCronAt,
  isScheduleDue,
  nextCronRun,
  withCronLock,
} from "./cron-tasks";

beforeEach(() => {
  vi.clearAllMocks();
  configStore.clear();
});

describe("withCronLock — verrou d'exécution d'une tâche", () => {
  it("verrou obtenu : exécute fn sous la transaction et renvoie son résultat", async () => {
    queryRaw.mockResolvedValueOnce([{ locked: true }]);
    const fn = vi.fn(async () => "fait");
    const out = await withCronLock("waiting-list", fn);
    expect(out).toEqual({ acquired: true, result: "fait" });
    expect(fn).toHaveBeenCalledTimes(1);
    // Transaction tenue le temps de l'exécution (timeout élargi, pas les 5 s par défaut).
    const opts = transaction.mock.calls[0]?.[1] as { timeout: number } | undefined;
    expect(opts?.timeout).toBeGreaterThan(5_000);
  });

  it("verrou déjà tenu (autre passage en cours) : fn n'est PAS appelée", async () => {
    queryRaw.mockResolvedValueOnce([{ locked: false }]);
    const fn = vi.fn(async () => "fait");
    const out = await withCronLock("waiting-list", fn);
    expect(out).toEqual({ acquired: false });
    expect(fn).not.toHaveBeenCalled();
  });

  it("identifiant de verrou : déterministe, distinct par tâche, entier 32 bits", () => {
    expect(cronLockId("backup")).toBe(cronLockId("backup"));
    expect(cronLockId("backup")).not.toBe(cronLockId("waiting-list"));
    for (const id of [cronLockId("backup"), cronLockId("rgpd-retention")]) {
      expect(Number.isInteger(id)).toBe(true);
      expect(Math.abs(id)).toBeLessThanOrEqual(2 ** 31);
    }
  });
});

describe("planification et dernier déclenchement (lecture par clé)", () => {
  it("getCronSchedule : valeur configurée valide, sinon défaut de la tâche", async () => {
    expect(await getCronSchedule("waiting-list")).toEqual({ type: "everyMinutes", step: 5 });
    configStore.set(
      "cron.schedule.waiting-list",
      JSON.stringify({ type: "everyMinutes", step: 30 }),
    );
    expect(await getCronSchedule("waiting-list")).toEqual({ type: "everyMinutes", step: 30 });
    configStore.set("cron.schedule.waiting-list", "{pas du json");
    expect(await getCronSchedule("waiting-list")).toEqual({ type: "everyMinutes", step: 5 });
  });

  it("getLastCronAt : date ISO valide, null sinon", async () => {
    expect(await getLastCronAt("backup")).toBeNull();
    configStore.set("cron.lastCronAt.backup", "2026-09-17T02:00:00.000Z");
    expect((await getLastCronAt("backup"))?.toISOString()).toBe("2026-09-17T02:00:00.000Z");
    configStore.set("cron.lastCronAt.backup", "hier");
    expect(await getLastCronAt("backup")).toBeNull();
  });

  it("isScheduleDue everyMinutes : tolérance de 2 min sur le pas", () => {
    const s = { type: "everyMinutes", step: 15 } as const;
    const now = new Date("2026-09-17T10:00:00Z");
    expect(isScheduleDue(s, null, now)).toBe(true);
    expect(isScheduleDue(s, new Date("2026-09-17T09:47:00Z"), now)).toBe(true);
    expect(isScheduleDue(s, new Date("2026-09-17T09:50:00Z"), now)).toBe(false);
  });
});

// ─── nextCronRun — échéance THÉORIQUE, jamais rabattue sur « maintenant » ───────────
// (Dom 2026-09-17 : la colonne « Prochaine » suivait l'heure courante quand le cron ne
// tournait pas et annonçait « dans moins d'une minute » indéfiniment.)

describe("nextCronRun", () => {
  const now = new Date("2026-09-17T17:31:34.444Z"); // 19:31:34 Paris (été, +2 h)
  it("intervalle : dernier déclenchement + pas, MÊME si c'est déjà passé (cron à l'arrêt)", () => {
    const last = new Date("2026-09-05T13:12:07.841Z");
    expect(nextCronRun({ type: "everyMinutes", step: 5 }, last, now)).toEqual(
      new Date("2026-09-05T13:17:07.841Z"),
    );
  });
  it("intervalle : échéance future rendue telle quelle", () => {
    const last = new Date("2026-09-17T17:29:00.000Z");
    expect(nextCronRun({ type: "everyMinutes", step: 5 }, last, now)).toEqual(
      new Date("2026-09-17T17:34:00.000Z"),
    );
  });
  it("intervalle : jamais déclenchée → au prochain passage, c'est-à-dire maintenant", () => {
    expect(nextCronRun({ type: "everyMinutes", step: 5 }, null, now)).toEqual(now);
  });
  it("heure fixe encore à venir aujourd'hui → aujourd'hui (heure murale Paris)", () => {
    // 21:00 Paris = 19:00 UTC en été.
    expect(nextCronRun({ type: "dailyAt", hour: 21, minute: 0 }, null, now)).toEqual(
      new Date("2026-09-17T19:00:00.000Z"),
    );
  });
  it("heure fixe passée et déjà déclenchée aujourd'hui → demain", () => {
    const last = new Date("2026-09-17T03:00:30.000Z"); // déclenchée à 05:00 Paris
    expect(nextCronRun({ type: "dailyAt", hour: 5, minute: 0 }, last, now)).toEqual(
      new Date("2026-09-18T03:00:00.000Z"),
    );
  });
  it("heure fixe passée SANS déclenchement depuis → l'échéance du jour, dépassée (en retard)", () => {
    const last = new Date("2026-09-16T03:00:10.000Z"); // hier
    expect(nextCronRun({ type: "dailyAt", hour: 5, minute: 0 }, last, now)).toEqual(
      new Date("2026-09-17T03:00:00.000Z"),
    );
    expect(nextCronRun({ type: "dailyAt", hour: 5, minute: 0 }, null, now)).toEqual(
      new Date("2026-09-17T03:00:00.000Z"),
    );
  });
});
