import { describe, expect, it } from "vitest";
import {
  CHEMIN_ENROLEMENT,
  derogation2FADev,
  exige2FA,
  ROLES_2FA_REQUIS,
} from "./two-factor-policy";

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

describe("exige2FA — qui doit disposer d'un second facteur", () => {
  it("les administrateurs, qui cumulent tous les privilèges", () => {
    // Export de la base nominative, restauration de sauvegarde, changement de
    // rôle, identifiants SMTP : un mot de passe seul ne protège pas cela.
    expect(exige2FA("administrateur", env({ NODE_ENV: "production" }))).toBe(true);
  });

  it("PAS les gestionnaires", () => {
    // Agents de terrain, au périmètre borné à leurs services. Leur imposer une
    // application d'authentification pour saisir des réservations au quotidien
    // pèserait sur l'usage sans réduire proportionnellement le risque.
    // Arbitrage assumé : un gestionnaire compromis garde accès aux données
    // de SES services.
    expect(exige2FA("gestionnaire")).toBe(false);
  });

  it("PAS les usagers", () => {
    // Leur compte ne donne accès qu'à leurs propres réservations. L'exiger de
    // familles pour réserver une séance serait disproportionné — et ferait fuir
    // les usagers, pas les attaquants.
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

  it("la liste des rôles exigeants se limite aux administrateurs", () => {
    expect([...ROLES_2FA_REQUIS]).toEqual(["administrateur"]);
  });
});

describe("dérogation de développement — DEV_SKIP_2FA", () => {
  it("hors production ET valeur exacte « true » : l'enrôlement n'est plus imposé", () => {
    // Le seul cas où elle s'ouvre. Motif : éviter un second secret TOTP à
    // enregistrer sur chaque poste, refait à chaque base recréée ou restaurée.
    const dev = env({ NODE_ENV: "development", DEV_SKIP_2FA: "true" });
    expect(derogation2FADev(dev)).toBe(true);
    expect(exige2FA("administrateur", dev)).toBe(false);
  });

  it("INOPÉRANTE en production, même variable posée", () => {
    // Le garde-fou qui compte : un `.env` de serveur qui hériterait de la ligne
    // ne doit pas ouvrir l'administration sans second facteur. Vaut aussi pour un
    // build local servi par `npm run start`, qui tourne en NODE_ENV=production.
    const prod = env({ NODE_ENV: "production", DEV_SKIP_2FA: "true" });
    expect(derogation2FADev(prod)).toBe(false);
    expect(exige2FA("administrateur", prod)).toBe(true);
  });

  it.each(["1", "TRUE", "yes", "on", ""])(
    "valeur « %s » : sans effet, comme pour ALLOW_INSECURE_COOKIES",
    (v) => {
      // Une échappatoire trop accueillante finit ouverte par accident ; celui qui
      // écrit autre chose que « true » doit constater que ça n'a pas pris.
      expect(derogation2FADev(env({ NODE_ENV: "development", DEV_SKIP_2FA: v }))).toBe(false);
      expect(exige2FA("administrateur", env({ NODE_ENV: "development", DEV_SKIP_2FA: v }))).toBe(
        true,
      );
    },
  );

  it("absente : le second facteur reste exigé en développement", () => {
    expect(derogation2FADev(env({ NODE_ENV: "development" }))).toBe(false);
    expect(exige2FA("administrateur", env({ NODE_ENV: "development" }))).toBe(true);
  });
});
