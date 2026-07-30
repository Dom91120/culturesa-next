import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BASE_DELAY_MS,
  COUNTER_TTL_MS,
  delayForFailures,
  emailFingerprint,
  FREE_ATTEMPTS,
  isCounterStale,
  MAX_DELAY_MS,
  remainingLockSeconds,
} from "./login-throttle";

// `emailFingerprint` dérive sa clé de BETTER_AUTH_SECRET (cf. server/crypto) :
// sans secret, l'appel lève. On en pose un le temps des tests.
const ORIG_SECRET = process.env.BETTER_AUTH_SECRET;
beforeAll(() => {
  process.env.BETTER_AUTH_SECRET = "secret-de-test-pour-empreintes";
});
afterAll(() => {
  if (ORIG_SECRET === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = ORIG_SECRET;
});

const NOW = new Date("2026-07-30T12:00:00Z").getTime();
const MIN = 60_000;
const ago = (ms: number) => new Date(NOW - ms);
const inMs = (ms: number) => new Date(NOW + ms);

describe("delayForFailures — l'attente croît puis plafonne", () => {
  it("aucune attente tant que le seuil n'est pas franchi", () => {
    // Les fautes de frappe ordinaires ne doivent rien coûter : un usager
    // ralenti dès le 2e essai finirait par appeler le service informatique.
    for (let n = 0; n <= FREE_ATTEMPTS; n++) {
      expect(delayForFailures(n)).toBe(0);
    }
  });

  it("double à chaque échec au-delà du seuil", () => {
    expect(delayForFailures(FREE_ATTEMPTS + 1)).toBe(BASE_DELAY_MS);
    expect(delayForFailures(FREE_ATTEMPTS + 2)).toBe(BASE_DELAY_MS * 2);
    expect(delayForFailures(FREE_ATTEMPTS + 3)).toBe(BASE_DELAY_MS * 4);
    expect(delayForFailures(FREE_ATTEMPTS + 4)).toBe(BASE_DELAY_MS * 8);
  });

  it("plafonne, pour ne pas transformer la protection en blocage", () => {
    // Un verrou qui s'allonge indéfiniment devient une arme : il suffirait
    // d'échouer volontairement pour évincer quelqu'un de son compte.
    expect(delayForFailures(FREE_ATTEMPTS + 20)).toBe(MAX_DELAY_MS);
    expect(delayForFailures(1000)).toBe(MAX_DELAY_MS);
  });

  it("le bruteforce devient sans objet une fois le plafond atteint", () => {
    // ~4 essais par heure et par compte : hors de portée pour un dictionnaire.
    expect(3_600_000 / MAX_DELAY_MS).toBeLessThanOrEqual(4);
  });
});

describe("remainingLockSeconds — ce que voit l'usager", () => {
  const frais = { failures: 8, lastFailureAt: ago(MIN) };

  it("aucune entrée → connexion permise", () => {
    expect(remainingLockSeconds(null, NOW)).toBe(0);
  });

  it("entrée sans verrou → connexion permise", () => {
    expect(remainingLockSeconds({ ...frais, lockedUntil: null }, NOW)).toBe(0);
  });

  it("verrou expiré → connexion permise", () => {
    expect(remainingLockSeconds({ ...frais, lockedUntil: ago(1000) }, NOW)).toBe(0);
  });

  it("verrou actif → secondes restantes, arrondies au-dessus", () => {
    expect(remainingLockSeconds({ ...frais, lockedUntil: inMs(90_000) }, NOW)).toBe(90);
    expect(remainingLockSeconds({ ...frais, lockedUntil: inMs(1500) }, NOW)).toBe(2);
  });

  it("compteur périmé → aucune attente, même verrou en cours", () => {
    // Trois fautes de frappe étalées sur des mois ne doivent pas se cumuler.
    expect(
      remainingLockSeconds(
        { failures: 20, lockedUntil: inMs(10 * MIN), lastFailureAt: ago(COUNTER_TTL_MS + MIN) },
        NOW,
      ),
    ).toBe(0);
  });
});

describe("isCounterStale — péremption du compteur", () => {
  it("échec récent → compteur vivant", () => {
    expect(isCounterStale(ago(COUNTER_TTL_MS - MIN), NOW)).toBe(false);
  });
  it("au-delà du délai → compteur périmé", () => {
    expect(isCounterStale(ago(COUNTER_TTL_MS + MIN), NOW)).toBe(true);
  });
});

describe("emailFingerprint — ni l'adresse, ni de fuite d'existence", () => {
  it("ne contient pas l'adresse en clair", () => {
    const fp = emailFingerprint("marie.durand@exemple.fr");
    expect(fp).not.toContain("marie");
    expect(fp).not.toContain("exemple.fr");
    expect(fp).not.toContain("@");
  });

  it("stable pour une même adresse", () => {
    expect(emailFingerprint("a@b.fr")).toBe(emailFingerprint("a@b.fr"));
  });

  it("insensible à la casse et aux espaces — sinon le freinage se contourne", () => {
    // « Marie@… » et « marie@… » désignent le même compte : sans normalisation,
    // il suffirait de varier la casse pour repartir avec un compteur neuf.
    const ref = emailFingerprint("marie@exemple.fr");
    expect(emailFingerprint("  MARIE@Exemple.FR  ")).toBe(ref);
  });

  it("distingue deux adresses différentes", () => {
    expect(emailFingerprint("a@b.fr")).not.toBe(emailFingerprint("c@d.fr"));
  });
});

describe("scénarios de bout en bout", () => {
  it("un usager qui se trompe cinq fois n'est jamais freiné", () => {
    for (let n = 1; n <= 5; n++) expect(delayForFailures(n)).toBe(0);
  });

  it("un attaquant est ralenti dès le sixième essai", () => {
    expect(delayForFailures(6)).toBeGreaterThan(0);
  });

  it("100 tentatives coûtent au moins une heure d'attente cumulée", () => {
    let total = 0;
    for (let n = 1; n <= 100; n++) total += delayForFailures(n);
    expect(total).toBeGreaterThan(60 * 60_000);
  });
});
