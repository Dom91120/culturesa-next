import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendMailOrQueue } from "@/server/mailer";
import { prisma } from "@/server/db";
import { isDigestDue, sendManagerDigest } from "./manager-notice";

// Périphérie remplacée : base, envoi, gabarits. Ce qui est testé ici est la RÈGLE
// d'échéance et le DÉCOUPAGE des envois — pas le rendu des e-mails.
vi.mock("@/server/db", () => ({
  prisma: {
    service: { findMany: vi.fn(), update: vi.fn(async () => ({})) },
    booking: { findMany: vi.fn() },
  },
}));
vi.mock("@/server/mailer", () => ({ sendMailOrQueue: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/server/config", () => ({ getAppUrl: vi.fn(async () => "http://exemple.test") }));
vi.mock("@/server/services/mail-templates", () => ({
  getMailTemplate: vi.fn(async (kind: string) => ({ subject: kind, html: "{{liste}}" })),
}));
vi.mock("@/server/services/mail-send", () => ({
  buildTemplatedMail: vi.fn(
    (
      tpl: { subject: string },
      vars: Record<string, string>,
      _url: string,
      raw: { liste: string },
    ) => ({ subject: tpl.subject, html: raw.liste, text: vars.nombre }),
  ),
}));
vi.mock("@/server/services/booking-mail", () => ({
  formatSlotLabel: vi.fn(() => "lundi 09:00 – 10:30"),
  resolvePeriodLabels: vi.fn(async (rows: unknown[]) => rows.map(() => "")),
}));

const cfg = (o: Partial<Parameters<typeof isDigestDue>[0]>) =>
  ({
    mode: "none",
    intervalHours: 4,
    hour: 8,
    weekday: "lun",
    lastSentAt: null,
    ...o,
  }) as Parameters<typeof isDigestDue>[0];

// Heures d'ÉTÉ à Paris (UTC+2) : 10:00 UTC = 12 h heure murale.
const paris = (iso: string) => new Date(iso);

describe("isDigestDue — mode « each » (Unitaires)", () => {
  it("est TOUJOURS dû : rien ne s'accumule", () => {
    const now = paris("2026-08-28T10:00:00Z");
    // Y compris à la seconde qui suit le dernier envoi — c'est tout l'objet du mode :
    // la seule chose qui empêche un doublon est le curseur, pas une échéance.
    expect(isDigestDue(cfg({ mode: "each", lastSentAt: new Date(now.getTime() - 1000) }), now)).toBe(
      true,
    );
    expect(isDigestDue(cfg({ mode: "each", lastSentAt: null }), now)).toBe(true);
  });

  it("ne change rien aux autres modes", () => {
    const now = paris("2026-08-28T10:00:00Z"); // vendredi, 12 h à Paris
    // « hours » attend toujours son intervalle…
    expect(
      isDigestDue(
        cfg({ mode: "hours", intervalHours: 4, lastSentAt: new Date(now.getTime() - 3_600_000) }),
        now,
      ),
    ).toBe(false);
    // …« none » ne part jamais…
    expect(isDigestDue(cfg({ mode: "none", lastSentAt: null }), now)).toBe(false);
    // …et « daily » reste calé sur son heure murale.
    expect(
      isDigestDue(cfg({ mode: "daily", hour: 8, lastSentAt: paris("2026-08-27T10:00:00Z") }), now),
    ).toBe(true);
    expect(
      isDigestDue(cfg({ mode: "daily", hour: 20, lastSentAt: paris("2026-08-27T10:00:00Z") }), now),
    ).toBe(false);
  });
});

// ── Découpage des envois : un e-mail par réservation, ou un récapitulatif ──

const serviceFindMany = vi.mocked(prisma.service.findMany);
const bookingFindMany = vi.mocked(prisma.booking.findMany);
const envoyer = vi.mocked(sendMailOrQueue);

/** Un service configuré, avec un gestionnaire destinataire et un curseur déjà posé. */
function serviceEn(mode: string) {
  serviceFindMany.mockResolvedValue([
    {
      id: "svc_001",
      label: "Médiathèque",
      mgrNoticeMode: mode,
      mgrNoticeIntervalHours: 4,
      mgrNoticeHour: 8,
      mgrNoticeWeekday: "lun",
      mgrNoticeLastSentAt: new Date("2026-08-27T06:00:00Z"),
      managers: [{ user: { email: "gestion@exemple.test" } }],
    },
  ] as never);
}

/** Aucune auto-validation, `n` réservations déposées depuis le curseur. */
function reservationsDeposees(n: number) {
  const rows = Array.from({ length: n }, (_, i) => ({
    periodId: null,
    validated: i % 2 === 0,
    user: { prenom: `Usager${i}`, nom: "TEST", email: `u${i}@exemple.test` },
    slot: { startTime: "09:00", endTime: "10:30", slotDate: null, slotDay: "lun" },
  }));
  bookingFindMany.mockResolvedValueOnce([] as never).mockResolvedValueOnce(rows as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sendManagerDigest — un e-mail par réservation en mode « each »", () => {
  it("découpe : 3 réservations → 3 e-mails", async () => {
    serviceEn("each");
    reservationsDeposees(3);

    const res = await sendManagerDigest(new Date("2026-08-28T10:00:00Z"));

    expect(res.emails).toBe(3);
    // Chaque e-mail ne porte QU'UNE ligne : c'est ce qui distingue le mode.
    expect(envoyer.mock.calls.map(([m]) => (m.html.match(/<li/g) ?? []).length)).toEqual([1, 1, 1]);
    // …et annonce « 1 » comme nombre, pas le total du lot.
    expect(envoyer.mock.calls.map(([m]) => m.text)).toEqual(["1", "1", "1"]);
  });

  it("les autres modes conservent le récapitulatif groupé : 3 réservations → 1 e-mail", async () => {
    // Quotidienne à 8 h, curseur d'hier, il est 12 h à Paris → échéance atteinte.
    serviceEn("daily");
    reservationsDeposees(3);

    const res = await sendManagerDigest(new Date("2026-08-28T10:00:00Z"));

    expect(res.emails).toBe(1);
    expect((envoyer.mock.calls[0][0].html.match(/<li/g) ?? []).length).toBe(3);
  });

  it("rien à signaler → aucun e-mail, et le curseur avance quand même", async () => {
    serviceEn("each");
    bookingFindMany.mockResolvedValueOnce([] as never).mockResolvedValueOnce([] as never);

    const res = await sendManagerDigest(new Date("2026-08-28T10:00:00Z"));

    expect(res.emails).toBe(0);
    // Sans quoi la même fenêtre serait re-balayée à chaque passage du cron.
    expect(vi.mocked(prisma.service.update)).toHaveBeenCalledTimes(1);
  });
});
