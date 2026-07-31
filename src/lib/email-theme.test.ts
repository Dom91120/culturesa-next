import { beforeEach, describe, expect, it, vi } from "vitest";
import { emailButton, escapeHtml, safeHref, wrapEmailHtml } from "./email-theme";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("safeHref — liste blanche de schémas (constat S4)", () => {
  it.each([
    "https://ville.fr/verif?token=abc",
    "http://localhost:3000/x",
    "mailto:a@b.fr",
  ])("laisse passer %s", (url) => {
    expect(safeHref(url)).toBe(url);
  });

  it.each(["/mon-compte", "#", "?k=v"])("laisse passer le chemin relatif %s", (url) => {
    // L'aperçu de l'éditeur de gabarits passe « # ». Le refuser casserait un écran
    // d'administration sans rien protéger : sans schéma, pas de schéma dangereux.
    expect(safeHref(url)).toBe(url);
  });

  it.each([
    ["javascript:alert(1)", "le cas que l'ancienne version laissait passer"],
    ["JavaScript:alert(1)", "casse mélangée"],
    ["  javascript:alert(1)  ", "espaces autour"],
    ["java\nscript:alert(1)", "retour à la ligne inséré dans le schéma"],
    ["data:text/html;base64,PHNjcmlwdD4=", "data:"],
    ["vbscript:msgbox", "vbscript:"],
  ])("neutralise %s (%s)", (url) => {
    expect(safeHref(url)).toBe("#");
  });

  it("journalise la neutralisation au lieu de la taire", () => {
    // Un lien devenu inerte sans explication se diagnostique mal : le message dit
    // pourquoi. Neutraliser en silence reviendrait à masquer l'anomalie.
    safeHref("javascript:alert(1)");
    expect(console.error).toHaveBeenCalled();
  });

  it("ne lève JAMAIS — le chemin d'envoi des e-mails de compte en dépend", () => {
    // Lever ferait échouer l'envoi, donc priverait un usager de la récupération de
    // son compte à cause d'une URL mal configurée. Le message doit partir.
    for (const v of ["", "   ", "pas une url", "http://", "://x"]) {
      expect(() => safeHref(v)).not.toThrow();
    }
  });
});

describe("emailButton", () => {
  it("échappe le libellé", () => {
    // Aucun appelant ne fournit aujourd'hui de donnée d'usager — mais la fonction
    // est exportée d'un module partagé et se présente comme réutilisable.
    const html = emailButton("https://x.fr", "<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("ne permet pas de sortir de l'attribut href", () => {
    const html = emailButton('https://x.fr/" onclick="alert(1)', "Ouvrir");
    expect(html).not.toContain('onclick="alert(1)"');
  });

  it("neutralise un href à schéma interdit tout en gardant le bouton", () => {
    const html = emailButton("javascript:alert(1)", "Ouvrir");
    expect(html).toContain('href="#"');
    expect(html).toContain("Ouvrir");
  });

  it("préserve une URL de vérification réelle, esperluettes comprises", () => {
    // `escapeHtml` transforme « & » en « &amp; » : c'est la forme CORRECTE en
    // attribut HTML, que le client mail redécode. Un lien de réinitialisation
    // cassé ici passerait inaperçu jusqu'au premier usager bloqué dehors.
    const url = "https://culturesa.fr/verif?token=abc&callbackURL=%2Fmon-compte";
    expect(emailButton(url, "Confirmer")).toContain(
      'href="https://culturesa.fr/verif?token=abc&amp;callbackURL=%2Fmon-compte"',
    );
  });
});

describe("wrapEmailHtml — le lien « Portail », même primitive", () => {
  it("neutralise une URL de portail à schéma interdit", () => {
    // Non cité par le constat, et pourtant plus exposé : l'URL vient de la
    // configuration éditable, et ce lien figure dans TOUS les e-mails.
    const html = wrapEmailHtml("<p>x</p>", { appUrl: "javascript:alert(1)" });
    expect(html).not.toContain("javascript:alert(1)");
    expect(html).toContain('href="#"');
  });

  it("conserve une URL de portail légitime", () => {
    expect(wrapEmailHtml("<p>x</p>", { appUrl: "https://culturesa.fr" })).toContain(
      'href="https://culturesa.fr"',
    );
  });

  it("sans URL configurée : texte simple, aucun lien", () => {
    const html = wrapEmailHtml("<p>x</p>");
    expect(html).toContain("Portail CultuRésa");
  });

  it("échappe le préheader", () => {
    expect(wrapEmailHtml("<p>x</p>", { preheader: "<img onerror=alert(1)>" })).not.toContain(
      "<img onerror",
    );
  });
});

describe("escapeHtml — source unique", () => {
  it("couvre les cinq caractères, contenu comme attribut", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("échappe l'esperluette EN PREMIER", () => {
    // Sinon « &lt; » produit par le remplacement de « < » serait ré-échappé en
    // « &amp;lt; » et s'afficherait littéralement.
    expect(escapeHtml("<")).toBe("&lt;");
  });
});
