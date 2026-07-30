import { beforeEach, describe, expect, it, vi } from "vitest";

// Posé AVANT tout import du module de cryptographie, qui lève si le secret manque.
// La suite complète ne charge pas `.env` ; ce fichier passait isolément et échouait
// en groupe — non pas sur un test, mais à la COLLECTE, parce qu'un `it.each` évalue
// sa table au chargement du fichier, hors de tout `beforeEach`.
process.env.BETTER_AUTH_SECRET ??= "secret-de-test-suffisamment-long-pour-la-derivation";

// La base est simulée : ces tests portent sur la LOGIQUE du défi (signature,
// expiration, anti-rejeu), pas sur PostgreSQL. Le comportement réel contre la base
// a été éprouvé séparément, sur la vraie table.
const createMany = vi.fn();
vi.mock("@/server/db", () => ({
  prisma: { captchaNonce: { createMany: (...a: unknown[]) => createMany(...a) } },
}));
vi.mock("svg-captcha", () => ({ create: () => ({ text: "ABC234", data: "<svg/>" }) }));

const { createCaptcha, verifyCaptcha } = await import("./captcha");
const { hmacSign } = await import("./crypto");

/** Fabrique un token valide pour une réponse connue (ce que fait createCaptcha). */
function token(reponse: string, ttlMs = 5 * 60 * 1000, nonce = "n1") {
  const exp = Date.now() + ttlMs;
  return `${exp}.${nonce}.${hmacSign("captcha", `${reponse.toUpperCase()}|${exp}|${nonce}`)}`;
}

beforeEach(() => {
  createMany.mockReset();
  createMany.mockResolvedValue({ count: 1 }); // nonce neuf par défaut
});

describe("verifyCaptcha — validité du défi", () => {
  it("accepte la bonne réponse", async () => {
    expect(await verifyCaptcha(token("ABC234"), "abc234")).toBe(true);
  });

  it("est insensible à la casse et aux espaces", async () => {
    // Le legacy l'était ; le durcissement ne doit pas rendre le formulaire pénible
    // au point qu'on soit tenté de retirer le captcha.
    expect(await verifyCaptcha(token("ABC234"), "  AbC234 ")).toBe(true);
  });

  it("refuse une mauvaise réponse", async () => {
    expect(await verifyCaptcha(token("ABC234"), "ZZZ999")).toBe(false);
  });

  it("refuse un token expiré", async () => {
    expect(await verifyCaptcha(token("ABC234", -1000), "ABC234")).toBe(false);
  });

  it("refuse une signature forgée", async () => {
    expect(await verifyCaptcha(`${Date.now() + 60_000}.n1.signature-inventee`, "ABC234")).toBe(
      false,
    );
  });

  it.each([
    ["token absent", null, "ABC234"],
    ["réponse absente", token("ABC234"), null],
    ["token malformé", "pas-un-token", "ABC234"],
  ])("refuse : %s", async (_cas, t, r) => {
    expect(await verifyCaptcha(t, r)).toBe(false);
  });

  it("n'écrit RIEN si la signature est invalide", async () => {
    // Sans ce garde-fou, n'importe qui ferait grossir la table en présentant des
    // nonces inventés — un déni de service par remplissage, offert par la
    // protection elle-même.
    await verifyCaptcha(`${Date.now() + 60_000}.n1.faux`, "ABC234");
    expect(createMany).not.toHaveBeenCalled();
  });
});

describe("anti-rejeu — le cœur du constat A3", () => {
  it("refuse un nonce déjà consommé", async () => {
    createMany.mockResolvedValue({ count: 0 }); // ON CONFLICT DO NOTHING
    expect(await verifyCaptcha(token("ABC234"), "ABC234")).toBe(false);
  });

  it("la consommation passe par une insertion, pas par une lecture préalable", async () => {
    // Vérifier puis écrire laisserait deux requêtes simultanées franchir le contrôle
    // avec le même token. L'insertion conditionnelle est atomique par construction.
    await verifyCaptcha(token("ABC234"), "ABC234");
    expect(createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
  });

  it("ÉCHEC FERMÉ : base indisponible → défi refusé", async () => {
    // Accepter « en attendant » rendrait l'anti-rejeu inopérant précisément quand la
    // base vacille — soit le moment où un attaquant a le plus de chances d'y être.
    createMany.mockRejectedValue(new Error("base injoignable"));
    expect(await verifyCaptcha(token("ABC234"), "ABC234")).toBe(false);
  });

  it("la date d'expiration stockée est celle du token", async () => {
    // Une expiration plus courte laisserait la purge effacer le nonce avant la fin du
    // TTL : le token redeviendrait rejouable pendant le temps restant, ce qui est
    // exactement le défaut que ce constat corrige.
    const t = token("ABC234", 5 * 60 * 1000);
    const exp = Number(t.split(".")[0]);
    await verifyCaptcha(t, "ABC234");
    const { data } = createMany.mock.calls[0][0] as { data: { expiresAt: Date }[] };
    expect(data[0].expiresAt.getTime()).toBe(exp);
  });
});

describe("createCaptcha", () => {
  it("produit un token à trois segments et un SVG", () => {
    const { svg, token: t } = createCaptcha();
    expect(svg).toContain("<svg");
    expect(t.split(".")).toHaveLength(3);
  });

  it("la réponse n'apparaît jamais dans le token", async () => {
    // Le token voyage jusqu'au client : il ne doit porter que l'empreinte HMAC.
    const { token: t } = createCaptcha();
    expect(t).not.toContain("ABC234");
  });

  it("deux appels produisent des nonces différents", () => {
    const n = (t: string) => t.split(".")[1];
    expect(n(createCaptcha().token)).not.toBe(n(createCaptcha().token));
  });
});
