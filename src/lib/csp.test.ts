import { describe, expect, it } from "vitest";
import { buildCsp, generateNonce } from "./csp";

const directive = (csp: string, nom: string) =>
  csp.split("; ").find((d) => d.startsWith(`${nom} `)) ?? "";

describe("buildCsp — ce que le constat S2 exigeait", () => {
  it("script-src ne contient PLUS 'unsafe-inline'", () => {
    // Le cœur du constat. `'unsafe-inline'` autorise tout script inline, donc
    // exactement ce qu'injecte une XSS : la CSP n'opposait plus rien à sa menace
    // principale.
    expect(directive(buildCsp("abc"), "script-src")).not.toContain("'unsafe-inline'");
  });

  it("script-src porte le nonce et 'strict-dynamic'", () => {
    const d = directive(buildCsp("VALEUR"), "script-src");
    expect(d).toContain("'nonce-VALEUR'");
    expect(d).toContain("'strict-dynamic'");
  });

  it("'unsafe-eval' seulement en développement", () => {
    // Requis par le rechargement à chaud de Turbopack. En production il rouvrirait
    // l'exécution de chaînes de caractères — l'autre moitié de ce que la CSP doit
    // fermer.
    expect(directive(buildCsp("x", true), "script-src")).toContain("'unsafe-eval'");
    expect(directive(buildCsp("x", false), "script-src")).not.toContain("'unsafe-eval'");
  });

  it("le nonce est correctement délimité", () => {
    // Une apostrophe manquante autour de `nonce-…` rend la source invalide : le
    // navigateur ignore la directive entière et REFUSE alors tous les scripts.
    expect(buildCsp("abc")).toContain("'nonce-abc'");
  });
});

describe("directives conservées — la CSP ne doit pas s'affaiblir ailleurs", () => {
  // Ces directives protégeaient déjà correctement avant S2. Le risque d'un
  // déplacement d'en-tête est d'en perdre une au passage, sans que rien ne casse
  // visiblement.
  it.each([
    ["default-src", "'self'"],
    ["style-src", "'self' 'unsafe-inline'"],
    ["img-src", "'self' data: blob:"],
    ["font-src", "'self'"],
    ["connect-src", "'self'"],
    ["frame-ancestors", "'none'"],
    ["frame-src", "'none'"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
  ])("%s reste « %s »", (nom, valeur) => {
    expect(directive(buildCsp("n"), nom)).toBe(`${nom} ${valeur}`);
  });

  it("style-src garde 'unsafe-inline', et c'est délibéré", () => {
    // L'application pose massivement des styles par attribut `style={{…}}`. Un
    // style injecté permet du défacement et de l'exfiltration par sélecteur, pas
    // de l'exécution de code. Le retirer supposerait de convertir tous ces
    // attributs — chantier sans rapport avec la sécurité.
    expect(directive(buildCsp("n"), "style-src")).toContain("'unsafe-inline'");
  });
});

describe("generateNonce", () => {
  it("produit 128 bits encodés en base64", () => {
    const n = generateNonce();
    expect(n).toMatch(/^[A-Za-z0-9+/]{22}==$/); // 16 octets → 24 caractères
    expect(atob(n)).toHaveLength(16);
  });

  it("ne se répète pas", () => {
    // Un nonce réutilisé est un nonce inutile : l'attaquant n'aurait qu'à lire une
    // réponse précédente pour le connaître.
    const vus = new Set(Array.from({ length: 500 }, generateNonce));
    expect(vus.size).toBe(500);
  });
});
