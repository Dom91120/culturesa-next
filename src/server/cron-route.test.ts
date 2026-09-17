import { beforeEach, describe, expect, it, vi } from "vitest";

// Protocole des routes /api/cron/* : verrou, planification, horodatage, journal.
// Les briques de cron-tasks sont simulées ; `withCronLock` exécute fn (verrou obtenu)
// ou non selon `lockHeld`.
let lockHeld = false;
const markCronAt = vi.fn(async () => {});
const recordCronRun = vi.fn(async () => {});
let due = true;

vi.mock("@/server/cron", () => ({ isAuthorizedCron: vi.fn(async () => true) }));
vi.mock("@/server/errors", () => ({
  messageClient: vi.fn(async (_e: unknown, generic: string) => generic),
}));
vi.mock("@/server/services/cron-tasks", () => ({
  getCronSchedule: vi.fn(async () => ({ type: "everyMinutes", step: 5 })),
  getLastCronAt: vi.fn(async () => null),
  isScheduleDue: vi.fn(() => due),
  markCronAt: (...a: unknown[]) => markCronAt(...(a as [])),
  recordCronRun: (...a: unknown[]) => recordCronRun(...(a as [])),
  withCronLock: vi.fn(async (_key: string, fn: () => Promise<unknown>) =>
    lockHeld ? { acquired: false } : { acquired: true, result: await fn() },
  ),
}));

import { runScheduledTask } from "./cron-route";

beforeEach(() => {
  vi.clearAllMocks();
  lockHeld = false;
  due = true;
});

describe("runScheduledTask", () => {
  it("tâche due : marque l'échéance AVANT d'exécuter, journalise le succès, renvoie le résumé", async () => {
    const order: string[] = [];
    markCronAt.mockImplementationOnce(async () => {
      order.push("mark");
    });
    const run = vi.fn(async () => {
      order.push("run");
      return { summary: "ok", payload: { n: 3 } };
    });
    const res = await runScheduledTask("waiting-list", run);
    expect(await res.json()).toEqual({ ok: true, n: 3 });
    expect(order).toEqual(["mark", "run"]);
    expect(recordCronRun).toHaveBeenCalledWith("waiting-list", {
      ok: true,
      trigger: "cron",
      summary: "ok",
    });
  });

  it("tâche non due : ne fait rien (ni horodatage ni journal)", async () => {
    due = false;
    const run = vi.fn(async () => ({ summary: "ok" }));
    const res = await runScheduledTask("waiting-list", run);
    expect(await res.json()).toEqual({ ok: true, skipped: true });
    expect(run).not.toHaveBeenCalled();
    expect(markCronAt).not.toHaveBeenCalled();
  });

  it("verrou tenu par un autre passage : répond « déjà en cours », sans rien faire", async () => {
    lockHeld = true;
    const run = vi.fn(async () => ({ summary: "ok" }));
    const res = await runScheduledTask("waiting-list", run);
    expect(await res.json()).toEqual({ ok: true, skipped: true, running: true });
    expect(run).not.toHaveBeenCalled();
    expect(markCronAt).not.toHaveBeenCalled();
    expect(recordCronRun).not.toHaveBeenCalled();
  });

  it("échec de la tâche : journal détaillé, réponse 500 générique, échéance consommée", async () => {
    const run = vi.fn(async () => {
      throw new Error("SMTP injoignable : mot de passe xyz");
    });
    const res = await runScheduledTask("backup", run);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "Échec de la tâche « backup »." });
    expect(markCronAt).toHaveBeenCalledTimes(1);
    expect(recordCronRun).toHaveBeenCalledWith("backup", {
      ok: false,
      trigger: "cron",
      summary: "SMTP injoignable : mot de passe xyz",
    });
  });
});
