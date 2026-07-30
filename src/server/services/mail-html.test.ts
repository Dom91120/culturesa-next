import { describe, expect, it } from "vitest";
import { sanitizeTemplateHtml } from "./mail-html";

describe("ce que l'éditeur produit doit traverser intact", () => {
  // Condition de survie de la protection : si un gabarit légitime est abîmé,
  // quelqu'un finira par désactiver le filtre.
  const cas: [string, string][] = [
    ["paragraphe et gras", "<p>Bonjour <strong>Marie</strong>,</p>"],
    ["italique, souligné, barré", "<p><em>a</em><u>b</u><s>c</s></p>"],
    ["titres", "<h1>Titre</h1><h2>Sous-titre</h2>"],
    ["listes", "<ul><li>un</li><li>deux</li></ul><ol><li>a</li></ol>"],
    ["citation et code", "<blockquote><p>cité</p></blockquote><pre><code>x</code></pre>"],
    ["séparateur et saut", "<p>a<br />b</p><hr />"],
    ["alignement (TextAlign)", '<p style="text-align:center">centré</p>'],
    ["couleur (TextStyle)", '<p><span style="color:#1e6b47">vert</span></p>'],
    ["surlignage (Highlight)", '<mark style="background-color:#ff0">important</mark>'],
    ["lien", '<p><a href="https://chatillon92.fr" rel="noopener noreferrer">le site</a></p>'],
    ["lien mailto", '<a href="mailto:contact@ville.fr" rel="noopener noreferrer">écrire</a>'],
    ["image distante", '<img src="https://ville.fr/a.png" alt="visuel" />'],
    ["tableau", "<table><tbody><tr><th>En-tête</th><td>Valeur</td></tr></tbody></table>"],
  ];

  for (const [nom, html] of cas) {
    it(`conserve : ${nom}`, () => {
      expect(sanitizeTemplateHtml(html)).toBe(html);
    });
  }

  it("conserve les marqueurs de variables et les blocs conditionnels", () => {
    // Ils sont du texte pour l'analyseur, et résolus APRÈS, au rendu.
    const tpl = "<p>{{salutation}}</p>{{#if periode}}<p>{{periode}}</p>{{/if}}";
    expect(sanitizeTemplateHtml(tpl)).toBe(tpl);
  });

  it("conserve une image en data: (collée dans l'éditeur)", () => {
    const html = '<img src="data:image/png;base64,iVBORw0KGgo=" alt="" />';
    expect(sanitizeTemplateHtml(html)).toContain("data:image/png");
  });
});

describe("ce qui doit tomber", () => {
  it("retire les scripts", () => {
    const out = sanitizeTemplateHtml("<p>a</p><script>alert(1)</script>");
    expect(out).not.toContain("script");
    expect(out).toContain("<p>a</p>");
  });

  it("retire les gestionnaires d'événement", () => {
    const out = sanitizeTemplateHtml('<img src="https://x.fr/a.png" onerror="alert(1)" />');
    expect(out).not.toContain("onerror");
  });

  it("retire un lien javascript:", () => {
    expect(sanitizeTemplateHtml('<a href="javascript:alert(1)">clic</a>')).not.toContain(
      "javascript",
    );
  });

  it("retire un lien data:text/html — équivalent à du script", () => {
    expect(
      sanitizeTemplateHtml('<a href="data:text/html;base64,PHNjcmlwdD4=">clic</a>'),
    ).not.toContain("data:text/html");
  });

  it("retire les iframes et objets", () => {
    const out = sanitizeTemplateHtml('<iframe src="https://x.fr"></iframe><object></object>');
    expect(out).not.toContain("iframe");
    expect(out).not.toContain("object");
  });

  it("retire un style non prévu (positionnement, image de fond)", () => {
    const out = sanitizeTemplateHtml(
      '<p style="position:absolute;background:url(javascript:alert(1))">a</p>',
    );
    expect(out).not.toContain("position");
    expect(out).not.toContain("javascript");
  });

  it("retire une URL sans schéma explicite", () => {
    // `//exemple.fr` hérite du protocole : en courriel, comportement imprévisible.
    expect(sanitizeTemplateHtml('<a href="//exemple.fr">clic</a>')).not.toContain("exemple.fr");
  });

  it("retire les balises de formulaire", () => {
    const out = sanitizeTemplateHtml('<form action="https://x.fr"><input name="mdp" /></form>');
    expect(out).not.toContain("<form");
    expect(out).not.toContain("<input");
  });

  it("retire un style embarqué qui redéfinirait l'habillage", () => {
    expect(sanitizeTemplateHtml("<style>body{display:none}</style><p>a</p>")).not.toContain(
      "<style",
    );
  });
});

describe("liens sortants — ce qui est ajouté", () => {
  it("ajoute rel=noopener noreferrer", () => {
    expect(sanitizeTemplateHtml('<a href="https://x.fr">clic</a>')).toContain(
      'rel="noopener noreferrer"',
    );
  });

  it("un lien vers un domaine tiers reste possible — limite assumée", () => {
    // Interdire les domaines tiers casserait des usages légitimes. Le risque
    // d'hameçonnage par lien subsiste, borné par le fait que seuls les
    // gestionnaires écrivent ces gabarits, et que c'est désormais tracé (BAC4).
    expect(sanitizeTemplateHtml('<a href="https://exemple-tiers.fr">clic</a>')).toContain(
      "exemple-tiers.fr",
    );
  });
});

describe("entrées dégénérées", () => {
  it("chaîne vide", () => {
    expect(sanitizeTemplateHtml("")).toBe("");
  });
  it("valeurs non textuelles", () => {
    expect(sanitizeTemplateHtml(null)).toBe("");
    expect(sanitizeTemplateHtml(undefined)).toBe("");
    expect(sanitizeTemplateHtml(42)).toBe("");
  });
  it("balises non fermées — pas de plantage", () => {
    expect(() => sanitizeTemplateHtml("<p><strong>a")).not.toThrow();
  });
  // Les deux SEULES réécritures constatées en confrontant l'assainisseur aux
  // 11 gabarits par défaut du projet. Aucune ne perd de contenu : le rendu dans
  // un client de messagerie est identique. Documentées ici pour qu'on ne les
  // prenne pas un jour pour une régression.
  it("normalise les éléments vides", () => {
    expect(sanitizeTemplateHtml("<p>a<br>b</p>")).toBe("<p>a<br />b</p>");
  });

  it("décode les entités en caractères littéraux", () => {
    expect(sanitizeTemplateHtml("<p>1&nbsp;h</p>")).toBe("<p>1 h</p>");
  });

  it("mais RÉÉCHAPPE ce qui doit l'être", () => {
    // Le décodage ne doit pas rouvrir une injection : un chevron littéral dans
    // le texte ressort échappé.
    expect(sanitizeTemplateHtml("<p>a &lt;script&gt; b</p>")).toBe("<p>a &lt;script&gt; b</p>");
    expect(sanitizeTemplateHtml("<p>1 < 2 & 3</p>")).not.toContain("<p>1 < 2");
  });

  it("idempotent : assainir deux fois donne le même résultat", () => {
    const sale = '<p onclick="x()">a<script>b</script></p>';
    const une = sanitizeTemplateHtml(sale);
    expect(sanitizeTemplateHtml(une)).toBe(une);
  });
});
