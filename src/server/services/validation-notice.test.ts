import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({ prisma: {} }));
vi.mock("@/server/config", () => ({
  getConfigMany: vi.fn(async () => ({})),
  setConfig: vi.fn(async () => {}),
}));
vi.mock("@/server/services/booking-mail", () => ({
  sendBookingConfirmationMailsBatch: vi.fn(async () => {}),
}));

import { resolveValidationNotice, validationNoticeWindow } from "./validation-notice";

const NOW = new Date("2026-09-04T10:00:00Z");

describe("validationNoticeWindow", () => {
  it("ouvre une fenêtre : l'état connu = celui d'AVANT le clic, échéance = maintenant + délai", () => {
    const w = validationNoticeWindow(
      { validated: false, validationNoticeFrom: null, validationNoticeDueAt: null },
      NOW,
      5,
    );
    expect(w.validationNoticeFrom).toBe(false);
    expect(w.validationNoticeDueAt.toISOString()).toBe("2026-09-04T10:05:00.000Z");
  });

  it("fenêtre déjà ouverte : conserve l'état connu du premier clic, repousse l'échéance", () => {
    const w = validationNoticeWindow(
      {
        validated: true, // déjà validée par le 1er clic…
        validationNoticeFrom: false, // …mais l'usager connaît « en attente »
        validationNoticeDueAt: new Date("2026-09-04T10:03:00Z"),
      },
      NOW,
      5,
    );
    expect(w.validationNoticeFrom).toBe(false);
    expect(w.validationNoticeDueAt.toISOString()).toBe("2026-09-04T10:05:00.000Z");
  });
});

describe("resolveValidationNotice", () => {
  it("validé → dévalidé → validé : un seul e-mail « confirmée »", () => {
    expect(resolveValidationNotice(false, true)).toBe("confirm_validate");
  });
  it("validé → dévalidé : retour à l'état connu → aucun e-mail", () => {
    expect(resolveValidationNotice(false, false)).toBeNull();
  });
  it("dévalidation nette : « remise en attente »", () => {
    expect(resolveValidationNotice(true, false)).toBe("unvalidate");
  });
  it("état connu inconnu (null) : on notifie l'état courant", () => {
    expect(resolveValidationNotice(null, true)).toBe("confirm_validate");
  });
});
