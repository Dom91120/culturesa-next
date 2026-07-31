import { describe, expect, it } from "vitest";
import { adressesFixesSchema, mailTemplateSchema, mailTypeMetaSchema } from "./echanges";

describe("mailTypeMetaSchema — une seule écriture des plafonds (constat S3)", () => {
  it("accepte et normalise", () => {
    const r = mailTypeMetaSchema.parse({
      label: "  Relance  ",
      description: " un mot ",
      recipient: " a@b.fr ",
    });
    expect(r).toEqual({ label: "Relance", description: "un mot", recipient: "a@b.fr" });
  });

  it("refuse un libellé vide, y compris fait d'espaces", () => {
    // `trim()` s'applique AVANT le contrôle de longueur : un libellé « espaces »
    // était accepté par un `if (!label)` naïf et produisait une entrée sans nom.
    expect(mailTypeMetaSchema.safeParse({ label: "   " }).success).toBe(false);
  });

  it.each([
    ["label", 100],
    ["description", 300],
    ["recipient", 200],
  ])("%s : accepte la limite, refuse un caractère de plus", (champ, max) => {
    const base = { label: "x", description: "", recipient: "" };
    expect(mailTypeMetaSchema.safeParse({ ...base, [champ]: "a".repeat(max) }).success).toBe(true);
    expect(mailTypeMetaSchema.safeParse({ ...base, [champ]: "a".repeat(max + 1) }).success).toBe(
      false,
    );
  });

  it("description et destinataire sont facultatifs", () => {
    expect(mailTypeMetaSchema.parse({ label: "X" })).toEqual({
      label: "X",
      description: "",
      recipient: "",
    });
  });
});

describe("mailTemplateSchema", () => {
  it("accepte un gabarit ordinaire", () => {
    expect(mailTemplateSchema.safeParse({ subject: "Objet", html: "<p>Bonjour</p>" }).success).toBe(
      true,
    );
  });

  it.each([
    ["subject", 500],
    ["html", 50_000],
  ])("%s : accepte la limite, refuse au-delà", (champ, max) => {
    const base = { subject: "o", html: "h" };
    expect(mailTemplateSchema.safeParse({ ...base, [champ]: "a".repeat(max) }).success).toBe(true);
    expect(mailTemplateSchema.safeParse({ ...base, [champ]: "a".repeat(max + 1) }).success).toBe(
      false,
    );
  });

  it("refuse une valeur non textuelle", () => {
    // Remplace un `typeof subject !== "string"` écrit à la main. Une server action
    // est une frontière réseau : le typage ne survit pas à l'appel.
    expect(mailTemplateSchema.safeParse({ subject: 42, html: "x" }).success).toBe(false);
  });

  it("n'assainit PAS le HTML — ce n'est pas son rôle", () => {
    // L'assainissement relève de BAC1/S1, au stockage et à l'envoi. Ce schéma borne
    // la TAILLE. Les confondre ferait croire qu'un seul des deux contrôles suffit.
    expect(mailTemplateSchema.parse({ subject: "o", html: "<script>x</script>" }).html).toBe(
      "<script>x</script>",
    );
  });
});

describe("adressesFixesSchema — le silence corrigé", () => {
  it("accepte une liste et la normalise", () => {
    expect(adressesFixesSchema.parse(" a@b.fr ,c@d.fr ")).toBe("a@b.fr, c@d.fr");
  });

  it("REFUSE une entrée invalide au lieu de la jeter en silence", () => {
    // L'ancienne règle gardait tout ce qui contenait un « @ » et supprimait le
    // reste sans un mot : une faute de frappe disparaissait, et l'administrateur
    // croyait avoir enregistré une adresse qui ne recevrait jamais rien. Un défaut
    // de notification ne se remarque pas ; un refus, si.
    const r = adressesFixesSchema.safeParse("valide@x.fr, faute-de-frappe");
    expect(r.success).toBe(false);
    expect(r.success === false && r.error.issues[0].message).toBe("Adresse e-mail invalide.");
  });

  it("refuse une saisie vide plutôt que d'enregistrer un destinataire fantôme", () => {
    for (const v of ["", "   ", ",,"]) {
      expect(adressesFixesSchema.safeParse(v).success).toBe(false);
    }
  });

  it("tolère les virgules superflues autour d'adresses valides", () => {
    // La rigueur porte sur les adresses, pas sur la ponctuation : refuser une
    // virgule en trop ferait passer le contrôle pour un caprice.
    expect(adressesFixesSchema.parse("a@b.fr, ,c@d.fr,")).toBe("a@b.fr, c@d.fr");
  });

  it("refuse une entrée qui contient « @ » sans être une adresse", () => {
    // Le cœur du durcissement : `.includes("@")` acceptait « @ », « a@ », « @b ».
    for (const v of ["@", "a@", "@b.fr", "a@b"]) {
      expect(adressesFixesSchema.safeParse(v).success).toBe(false);
    }
  });
});
