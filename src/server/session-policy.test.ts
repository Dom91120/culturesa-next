import { describe, expect, it } from "vitest";
import {
  checkSessionPolicy,
  sessionDeadlineAt,
  shouldTouch,
  TOUCH_THROTTLE_MS,
} from "./session-policy";

// « Maintenant » figé : mercredi 15 juillet 2026, 12 h UTC.
const NOW = new Date("2026-07-15T12:00:00Z").getTime();
const MIN = 60 * 1000;
const H = 60 * MIN;

/** Date située `ms` millisecondes AVANT NOW. */
const ago = (ms: number) => new Date(NOW - ms);

describe("checkSessionPolicy — inactivité par rôle", () => {
  it("gestionnaire : actif il y a 14 min → session valide", () => {
    expect(checkSessionPolicy("gestionnaire", ago(14 * MIN), ago(H), NOW)).toBe("ok");
  });
  it("gestionnaire : inactif depuis 16 min → révoquée", () => {
    expect(checkSessionPolicy("gestionnaire", ago(16 * MIN), ago(H), NOW)).toBe("idle");
  });
  it("administrateur : même seuil de 15 min que le gestionnaire", () => {
    expect(checkSessionPolicy("administrateur", ago(14 * MIN), ago(H), NOW)).toBe("ok");
    expect(checkSessionPolicy("administrateur", ago(16 * MIN), ago(H), NOW)).toBe("idle");
  });
  it("usager : 16 min d'inactivité restent tolérées (seuil à 2 h)", () => {
    expect(checkSessionPolicy("utilisateur", ago(16 * MIN), ago(H), NOW)).toBe("ok");
  });
  it("usager : inactif depuis 2 h 01 → révoquée", () => {
    expect(checkSessionPolicy("utilisateur", ago(2 * H + MIN), ago(3 * H), NOW)).toBe("idle");
  });
});

describe("checkSessionPolicy — plafond absolu", () => {
  it("gestionnaire actif en continu : révoquée au-delà de 8 h", () => {
    // Actif à l'instant, mais session ouverte depuis plus de 8 h.
    expect(checkSessionPolicy("gestionnaire", ago(MIN), ago(8 * H + MIN), NOW)).toBe("absolute");
  });
  it("gestionnaire actif en continu : valide juste avant 8 h", () => {
    expect(checkSessionPolicy("gestionnaire", ago(MIN), ago(7 * H), NOW)).toBe("ok");
  });
  it("usager actif en continu : révoquée au-delà de 24 h", () => {
    expect(checkSessionPolicy("utilisateur", ago(MIN), ago(24 * H + MIN), NOW)).toBe("absolute");
  });
  it("le plafond absolu prime sur l'inactivité (diagnostic le plus fort)", () => {
    // Les DEUX limites sont dépassées : on renvoie « absolute ».
    expect(checkSessionPolicy("gestionnaire", ago(2 * H), ago(9 * H), NOW)).toBe("absolute");
  });
});

describe("checkSessionPolicy — rôle absent ou inconnu", () => {
  it("rôle indéfini → repli sur le rôle le MOINS privilégié (utilisateur)", () => {
    expect(checkSessionPolicy(undefined, ago(30 * MIN), ago(H), NOW)).toBe("ok");
    expect(checkSessionPolicy(undefined, ago(3 * H), ago(4 * H), NOW)).toBe("idle");
  });
});

describe("sessionDeadlineAt — réveil du composant de surveillance", () => {
  it("gestionnaire : échéance = dernière activité + 15 min", () => {
    const lastSeen = ago(5 * MIN);
    expect(sessionDeadlineAt("gestionnaire", lastSeen, ago(H))).toBe(lastSeen.getTime() + 15 * MIN);
  });
  it("usager : échéance = dernière activité + 2 h", () => {
    const lastSeen = ago(5 * MIN);
    expect(sessionDeadlineAt("utilisateur", lastSeen, ago(H))).toBe(lastSeen.getTime() + 2 * H);
  });
  it("le plafond absolu l'emporte quand il tombe en premier", () => {
    // Session ouverte il y a 7 h 55 (plafond 8 h) : le plafond échoit dans 5 min,
    // avant l'inactivité (15 min à partir de maintenant).
    const created = ago(7 * H + 55 * MIN);
    const lastSeen = new Date(NOW);
    expect(sessionDeadlineAt("gestionnaire", lastSeen, created)).toBe(created.getTime() + 8 * H);
  });
  it("échéance cohérente avec le verdict : ok juste avant, idle juste après", () => {
    const lastSeen = ago(5 * MIN);
    const created = ago(H);
    const d = sessionDeadlineAt("gestionnaire", lastSeen, created);
    expect(checkSessionPolicy("gestionnaire", lastSeen, created, d - 1000)).toBe("ok");
    expect(checkSessionPolicy("gestionnaire", lastSeen, created, d + 1000)).toBe("idle");
  });
});

describe("shouldTouch — throttle des écritures d'activité", () => {
  it("activité récente → pas de réécriture", () => {
    expect(shouldTouch(ago(TOUCH_THROTTLE_MS - 1000), NOW)).toBe(false);
  });
  it("throttle écoulé → réécriture", () => {
    expect(shouldTouch(ago(TOUCH_THROTTLE_MS + 1000), NOW)).toBe(true);
  });
});
