import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _assainir, journal } from "./log";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
});
// `vi.stubEnv` et non `Object.defineProperty` : Node refuse de redéfinir une
// propriété de `process.env`, et l'erreur remontait depuis `afterEach` — donc sur
// TOUS les tests du fichier, y compris ceux qui ne touchaient pas à NODE_ENV.
const prod = (on: boolean) => vi.stubEnv("NODE_ENV", on ? "production" : "test");
const derniere = (c: "error" | "warn" | "log") =>
  String((console[c] as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0] ?? "");

describe("masquage — le filtre est dans le journal, pas dans la consigne", () => {
  it.each([
    "password",
    "motDePasse",
    "mot_de_passe",
    "secret",
    "token",
    "jeton",
    "cookie",
    "authorization",
    "session",
    "apiKey",
    "api_key",
    "cle",
  ])("masque la clé « %s »", (k) => {
    // Un journal structuré invite à passer des objets entiers (« c'est plus
    // pratique »), et un objet entier finit par contenir un secret. La discipline
    // de l'appelant tient jusqu'au premier ajout fait dans l'urgence.
    expect(JSON.stringify(_assainir({ [k]: "valeur-sensible" }))).not.toContain("valeur-sensible");
  });

  it("masque quelle que soit la casse", () => {
    expect(JSON.stringify(_assainir({ PASSWORD: "x", Token: "y" }))).not.toMatch(/"x"|"y"/);
  });

  it("masque en profondeur, pas seulement au premier niveau", () => {
    const o = { requete: { entetes: { cookie: "session=abc" } } };
    expect(JSON.stringify(_assainir(o))).not.toContain("session=abc");
  });

  it("laisse passer ce qui n'est pas sensible", () => {
    expect(_assainir({ email: "a@b.fr", compteur: 3 })).toEqual({ email: "a@b.fr", compteur: 3 });
  });

  it("déplie une Error en objet lisible", () => {
    const r = _assainir(new Error("boum")) as { nom: string; message: string; pile: string };
    expect(r.nom).toBe("Error");
    expect(r.message).toBe("boum");
    expect(r.pile).toContain("boum");
  });

  it("borne la profondeur — un objet cyclique ne doit pas faire tomber le journal", () => {
    const a: Record<string, unknown> = {};
    a.moi = a;
    expect(() => JSON.stringify(_assainir(a))).not.toThrow();
  });
});

describe("format", () => {
  it("production : une ligne JSON avec niveau, module, horodatage", () => {
    prod(true);
    journal.erreur("backup:restore", "Échec", { req: "ABC123" });
    const l = JSON.parse(derniere("error"));
    expect(l).toMatchObject({
      niveau: "erreur",
      module: "backup:restore",
      message: "Échec",
      req: "ABC123",
    });
    expect(l.t).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("développement : format lisible, pas de JSON", () => {
    // Une ligne JSON de 200 caractères au milieu d'un rechargement à chaud n'aide
    // personne — et un journal qu'on renonce à lire ne sert à rien.
    prod(false);
    journal.erreur("captcha", "Consommation impossible");
    expect(derniere("error")).toContain("[captcha] Consommation impossible");
    expect(() => JSON.parse(derniere("error"))).toThrow();
  });

  it.each([
    ["info", "log"],
    ["avert", "warn"],
    ["erreur", "error"],
  ] as const)("le niveau « %s » écrit sur console.%s", (niveau, sortie) => {
    prod(false);
    journal[niveau]("m", "msg");
    expect(console[sortie]).toHaveBeenCalled();
  });

  it("ne lève JAMAIS — un journal qui échoue ferait tomber l'opération qu'il décrit", () => {
    prod(true);
    const piege = {
      get explose() {
        throw new Error("accès interdit");
      },
    };
    expect(() => journal.erreur("m", "msg", { piege })).not.toThrow();
  });
});
