import { describe, expect, it } from "vitest";
import { autoriseCron } from "./cron";

const SECRET = "secret-cron-de-test-suffisamment-long";
const env = (o: Record<string, string | undefined> = {}) =>
  ({ CRON_SECRET: SECRET, ...o }) as unknown as NodeJS.ProcessEnv;

describe("autoriseCron", () => {
  it("accepte le bon secret", () => {
    expect(autoriseCron(new Headers({ "x-cron-secret": SECRET }), env())).toBe(true);
  });

  it("refuse un secret erroné de même longueur", () => {
    // Même longueur : c'est le cas que `timingSafeEqual` doit trancher, et non le
    // contrôle de longueur qui le précède.
    const faux = `${SECRET.slice(0, -1)}X`;
    expect(autoriseCron(new Headers({ "x-cron-secret": faux }), env())).toBe(false);
  });

  it("refuse l'absence d'en-tête", () => {
    expect(autoriseCron(new Headers(), env())).toBe(false);
  });

  it("refuse si CRON_SECRET n'est pas configuré côté serveur", () => {
    // Sinon un déploiement sans secret ouvrirait les routes à quiconque n'envoie
    // rien : l'absence de configuration deviendrait une absence de contrôle.
    expect(
      autoriseCron(new Headers({ "x-cron-secret": SECRET }), env({ CRON_SECRET: undefined })),
    ).toBe(false);
  });

  it("ne lève pas sur un secret de longueur différente", () => {
    // `timingSafeEqual` jette si les tampons diffèrent en longueur : sans le contrôle
    // préalable, une tentative erronée renverrait 500 au lieu de 401 — et signalerait
    // au passage que la longueur ne correspond pas.
    expect(() => autoriseCron(new Headers({ "x-cron-secret": "x" }), env())).not.toThrow();
    expect(autoriseCron(new Headers({ "x-cron-secret": "x" }), env())).toBe(false);
  });

  it("les en-têtes X-Forwarded-* NE SONT PAS un signal d'origine exploitable", () => {
    // Verrouille l'enseignement de BAC5 : Next.js définit lui-même ces en-têtes sur
    // CHAQUE requête quand ils sont absents (base-server.js). Une version antérieure
    // de ce garde rejetait sur leur présence — elle refusait donc aussi l'appel
    // légitime du conteneur cron, et aurait arrêté toutes les tâches planifiées.
    // Si quelqu'un réintroduit ce contrôle, ce test tombera.
    const h = new Headers({
      "x-cron-secret": SECRET,
      "x-forwarded-for": "203.0.113.7",
      "x-forwarded-proto": "https",
      "x-forwarded-host": "culturesa.exemple.fr",
    });
    expect(autoriseCron(h, env())).toBe(true);
  });
});
