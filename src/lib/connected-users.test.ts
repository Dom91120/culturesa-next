import { describe, expect, it } from "vitest";
import { describeUserAgent, type SessionRow, summarizeSessions } from "./connected-users";

const row = (p: Partial<SessionRow> & { userId: string }): SessionRow => ({
  nom: "DUPONT",
  prenom: "Ana",
  email: `${p.userId}@exemple.test`,
  role: "utilisateur",
  createdAt: "2026-09-07T06:00:00.000Z",
  updatedAt: "2026-09-07T07:00:00.000Z",
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36",
  ...p,
});

describe("describeUserAgent", () => {
  it("système · navigateur, Edge avant Chrome, Chrome avant Safari", () => {
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/128.0 Safari/537.36")).toBe(
      "Windows · Chrome",
    );
    expect(
      describeUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/128.0 Safari/537.36 Edg/128.0"),
    ).toBe("Windows · Edge");
    expect(
      describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17.0 Safari/604.1"),
    ).toBe("iPhone · Safari");
    expect(
      describeUserAgent("Mozilla/5.0 (Linux; Android 14) Chrome/128.0 Mobile Safari/537.36"),
    ).toBe("Android · Chrome");
    expect(describeUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Firefox/129.0")).toBe(
      "macOS · Firefox",
    );
  });
  it("inconnu si vide ou non reconnu", () => {
    expect(describeUserAgent(null)).toBe("Inconnu");
    expect(describeUserAgent("curl/8.0")).toBe("Inconnu");
  });
});

describe("summarizeSessions", () => {
  const NOW = "2026-09-07T07:30:00.000Z";

  it("vide", () => {
    expect(summarizeSessions([], NOW)).toEqual({ users: [], activeCount: 0, sessionCount: 0 });
  });

  it("regroupe par compte : dernière activité = max, depuis = min, appareils distincts", () => {
    const s = summarizeSessions(
      [
        row({
          userId: "u1",
          createdAt: "2026-09-06T14:00:00.000Z",
          updatedAt: "2026-09-07T06:00:00.000Z",
        }),
        row({
          userId: "u1",
          createdAt: "2026-09-07T06:30:00.000Z",
          updatedAt: "2026-09-07T07:10:00.000Z",
          userAgent: "Mozilla/5.0 (iPhone) Version/17.0 Safari/604.1",
        }),
        row({ userId: "u2", updatedAt: "2026-09-07T05:00:00.000Z" }),
      ],
      NOW,
    );
    expect(s.sessionCount).toBe(2);
    expect(s.users.map((u) => u.userId)).toEqual(["u1"]);
    const u1 = s.users[0];
    expect(u1.sessions).toBe(2);
    expect(u1.since).toBe("2026-09-06T14:00:00.000Z");
    expect(u1.lastActivity).toBe("2026-09-07T07:10:00.000Z");
    expect(u1.devices).toEqual(["Windows · Chrome", "iPhone · Safari"]);
    // Dernière action à 07:10 pour un relevé à 07:30 : hors fenêtre « actif » (5 min).
    expect(u1.active).toBe(false);
    // u2 : 2 h 30 sans activité → usager, déconnexion automatique à 2 h : ABSENT.
    expect(s.users.find((u) => u.userId === "u2")).toBeUndefined();
    expect(s.activeCount).toBe(0);
  });

  it("actif jusqu'à 5 min après la dernière action", () => {
    const at = (min: number) => new Date(new Date(NOW).getTime() - min * 60000).toISOString();
    expect(summarizeSessions([row({ userId: "a", updatedAt: at(4) })], NOW).activeCount).toBe(1);
    expect(summarizeSessions([row({ userId: "a", updatedAt: at(6) })], NOW).activeCount).toBe(0);
    expect(summarizeSessions([row({ userId: "a", updatedAt: at(6) })], NOW).users).toHaveLength(1);
  });

  it("ignore les sessions hors politique : inactivité (2 h usager, 15 min gestionnaire), plafond", () => {
    const at = (min: number) => new Date(new Date(NOW).getTime() - min * 60000).toISOString();
    const s = summarizeSessions(
      [
        row({ userId: "usager-ok", updatedAt: at(119) }),
        row({ userId: "usager-idle", updatedAt: at(121) }),
        row({ userId: "gest-ok", role: "gestionnaire", updatedAt: at(14) }),
        row({ userId: "gest-idle", role: "gestionnaire", updatedAt: at(16) }),
        // Gestionnaire actif mais session ouverte depuis 9 h : plafond 8 h dépassé.
        row({ userId: "gest-abs", role: "gestionnaire", createdAt: at(9 * 60), updatedAt: at(1) }),
      ],
      NOW,
    );
    expect(s.users.map((u) => u.userId).sort()).toEqual(["gest-ok", "usager-ok"]);
    expect(s.sessionCount).toBe(2);
  });
});
