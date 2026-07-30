import { describe, expect, it } from "vitest";
import { argsChromium, sandboxActif } from "./pdf-browser";

const env = (o: Record<string, string | undefined>) => o as NodeJS.ProcessEnv;

describe("sandboxActif — décision explicite, jamais déduite", () => {
  it("désactivé par défaut : c'est l'état réel du déploiement", () => {
    expect(sandboxActif(env({}))).toBe(false);
  });

  it("seule la chaîne exacte « true » l'active", () => {
    // Même exigence qu'en A5 : une bascule qui accepte « 1 » ou « TRUE » finit
    // actionnée par mégarde. Ici l'erreur serait immédiatement visible — toute
    // génération de PDF échouerait —, mais la règle vaut d'être uniforme.
    expect(sandboxActif(env({ PUPPETEER_SANDBOX: "true" }))).toBe(true);
    for (const v of ["1", "TRUE", "oui", ""]) {
      expect(sandboxActif(env({ PUPPETEER_SANDBOX: v }))).toBe(false);
    }
  });
});

describe("argsChromium", () => {
  it("sans bac à sable : les DEUX drapeaux, jamais un seul", () => {
    // En désactiver un seul laisse Chromium tenter l'autre voie et échouer au
    // démarrage — panne au lancement, pas dégradation silencieuse.
    const a = argsChromium(env({}));
    expect(a).toContain("--no-sandbox");
    expect(a).toContain("--disable-setuid-sandbox");
  });

  it("bac à sable actif : AUCUN drapeau de désactivation ne subsiste", () => {
    // Le piège serait d'ajouter l'option sans retirer les drapeaux : le bac à sable
    // resterait désactivé, avec une variable d'environnement affirmant le contraire.
    const a = argsChromium(env({ PUPPETEER_SANDBOX: "true" }));
    expect(a).not.toContain("--no-sandbox");
    expect(a).not.toContain("--disable-setuid-sandbox");
  });

  it.each([
    [
      "--disable-dev-shm-usage",
      "/dev/shm vaut 64 Mo en conteneur : Chromium s'y écrase sur les gros documents",
    ],
    ["--disable-gpu", "aucune carte graphique dans le conteneur"],
    ["--disable-extensions", "aucune extension installée"],
  ])("%s est toujours présent", (drapeau) => {
    expect(argsChromium(env({}))).toContain(drapeau);
    expect(argsChromium(env({ PUPPETEER_SANDBOX: "true" }))).toContain(drapeau);
  });

  it("aucun drapeau n'affaiblit l'isolement d'origine", () => {
    // Garde-fou contre le réflexe « ajouter un drapeau jusqu'à ce que ça marche » :
    // ces trois-là reviennent constamment dans les recettes trouvées en ligne et
    // désactivent des protections réelles du moteur de rendu.
    const interdits = [
      "--disable-web-security",
      "--disable-site-isolation-trials",
      "--allow-running-insecure-content",
    ];
    const tous = [...argsChromium(env({})), ...argsChromium(env({ PUPPETEER_SANDBOX: "true" }))];
    for (const i of interdits) expect(tous).not.toContain(i);
  });
});
