import { describe, expect, it } from "vitest";
import { CHEMIN_ENROLEMENT, exige2FA, ROLES_2FA_REQUIS } from "./two-factor-policy";

describe("exige2FA — qui doit disposer d'un second facteur", () => {
  it("les rôles privilégiés, qui peuvent exporter la base nominative", () => {
    expect(exige2FA("gestionnaire")).toBe(true);
    expect(exige2FA("administrateur")).toBe(true);
  });

  it("PAS les usagers", () => {
    // Leur compte ne donne accès qu'à leurs propres réservations. Imposer une
    // application d'authentification à des familles pour réserver une séance
    // serait disproportionné — et ferait fuir les usagers, pas les attaquants.
    expect(exige2FA("utilisateur")).toBe(false);
  });

  it("rôle absent → pas d'exigence", () => {
    // Le garde n'est atteint qu'après contrôle du rôle : un rôle indéfini ne doit
    // pas produire une redirection en boucle vers l'enrôlement.
    expect(exige2FA(undefined)).toBe(false);
  });
});

describe("garde-fous du dispositif", () => {
  it("le chemin d'enrôlement vit sous /mon-compte", () => {
    // Point CRITIQUE : /mon-compte n'appelle que `requireUser`, jamais
    // `requireRole` — la page d'enrôlement échappe donc au garde qui redirige
    // vers elle. Déplacer cette page sous (admin) créerait une boucle de
    // redirection, et un gestionnaire incapable d'accéder à quoi que ce soit.
    expect(CHEMIN_ENROLEMENT.startsWith("/mon-compte")).toBe(true);
  });

  it("la liste des rôles exigeants ne contient pas « utilisateur »", () => {
    expect(ROLES_2FA_REQUIS.has("utilisateur")).toBe(false);
  });
});
