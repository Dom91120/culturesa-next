import { describe, expect, it } from "vitest";
import { ATTRIBUTS_COOKIE, alerteCookiesNonSecurises, cookiesSecurises } from "./cookie-policy";

const env = (o: Record<string, string | undefined>) => o as NodeJS.ProcessEnv;

describe("cookiesSecurises — ce que le constat A5 corrige", () => {
  it("production → Secure, QUEL QUE SOIT le schéma de BETTER_AUTH_URL", () => {
    // Le cœur du constat. Better Auth déduisait `Secure` du schéma de l'URL : un
    // `http://` — le schéma réellement servi par le conteneur, donc la valeur qu'on
    // est naturellement tenté d'y mettre — retirait la protection sans un mot.
    expect(
      cookiesSecurises(env({ NODE_ENV: "production", BETTER_AUTH_URL: "http://app:3000" })),
    ).toBe(true);
    expect(cookiesSecurises(env({ NODE_ENV: "production", BETTER_AUTH_URL: "https://x.fr" }))).toBe(
      true,
    );
    expect(cookiesSecurises(env({ NODE_ENV: "production" }))).toBe(true);
  });

  it("hors production → pas de Secure, sinon plus personne ne se connecte en local", () => {
    // Un navigateur refuse d'émettre un cookie `Secure` sur http://localhost : le
    // formulaire se rechargerait indéfiniment, sans message.
    expect(cookiesSecurises(env({ NODE_ENV: "development" }))).toBe(false);
    expect(cookiesSecurises(env({ NODE_ENV: "test" }))).toBe(false);
    expect(cookiesSecurises(env({}))).toBe(false);
  });

  it("échappatoire EXPLICITE, et elle seule, lève la protection", () => {
    expect(cookiesSecurises(env({ NODE_ENV: "production", ALLOW_INSECURE_COOKIES: "true" }))).toBe(
      false,
    );
  });

  it.each(["1", "TRUE", "oui", "yes", ""])(
    "« %s » ne lève PAS la protection — seule la chaîne exacte « true » le fait",
    (v) => {
      // Une échappatoire trop accueillante finit ouverte par accident. Un opérateur
      // qui écrit `ALLOW_INSECURE_COOKIES=1` doit voir que ça n'a pas marché, plutôt
      // que de désactiver `Secure` en croyant avoir écrit autre chose.
      expect(cookiesSecurises(env({ NODE_ENV: "production", ALLOW_INSECURE_COOKIES: v }))).toBe(
        true,
      );
    },
  );
});

describe("alerteCookiesNonSecurises — le silence était le défaut", () => {
  it("alerte quand la protection est levée EN PRODUCTION", () => {
    expect(
      alerteCookiesNonSecurises(env({ NODE_ENV: "production", ALLOW_INSECURE_COOKIES: "true" })),
    ).toBe(true);
  });

  it("n'alerte pas en production protégée", () => {
    expect(alerteCookiesNonSecurises(env({ NODE_ENV: "production" }))).toBe(false);
  });

  it("n'alerte pas en développement — ce serait du bruit à chaque démarrage", () => {
    // Un avertissement qui s'affiche tous les jours en local est un avertissement
    // qu'on ne lira plus le jour où il apparaîtra en production.
    expect(alerteCookiesNonSecurises(env({ NODE_ENV: "development" }))).toBe(false);
  });
});

describe("ATTRIBUTS_COOKIE", () => {
  it("httpOnly : le cookie reste hors de portée de tout script", () => {
    expect(ATTRIBUTS_COOKIE.httpOnly).toBe(true);
  });

  it("sameSite vaut « lax », PAS « strict »", () => {
    // `strict` casserait les liens de confirmation d'adresse et de réinitialisation
    // de mot de passe, qui arrivent depuis un client de messagerie. Un parcours cassé
    // se « répare » en abaissant l'attribut — plus bas que `lax`.
    expect(ATTRIBUTS_COOKIE.sameSite).toBe("lax");
  });

  it("path racine", () => {
    expect(ATTRIBUTS_COOKIE.path).toBe("/");
  });
});
