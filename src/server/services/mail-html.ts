import sanitizeHtml from "sanitize-html";

// ════════════════════════════════════════════════════════════════════════════
//  Assainissement du HTML des gabarits d'e-mails (constats BAC1 et S1).
//
//  Le gestionnaire d'UN service pouvait enregistrer jusqu'à 50 000 caractères de
//  HTML libre, ensuite envoyés aux usagers sous l'en-tête et le logo de la Ville,
//  via son relais SMTP légitime — donc avec SPF et DKIM valides. Le risque n'est
//  pas tant technique que réputationnel : un message d'hameçonnage authentiquement
//  signé par la collectivité passe tous les filtres anti-spam.
//
//  Aucun assainisseur n'existait dans le projet ; le seul rempart était le bac à
//  sable de l'iframe d'aperçu (`sandbox=""`), qui empêche l'exécution de scripts
//  DANS L'APERÇU mais ne dit rien de ce qui part par courriel.
//
//  ── Liste blanche, jamais liste noire ──
//  On énumère ce qui est AUTORISÉ, et tout le reste tombe. L'inverse — interdire
//  `<script>`, `onerror`, `javascript:` — se contourne indéfiniment : c'est un jeu
//  que l'attaquant gagne toujours, puisqu'il lui suffit de trouver une seule
//  construction non prévue.
//
//  La liste couvre exactement ce que produit l'éditeur (StarterKit, couleurs,
//  surlignage, alignement, images, tableaux). Un gabarit légitime traverse donc
//  sans perte : c'est la condition pour que la protection ne soit pas désactivée
//  au premier gabarit cassé.
//
//  ⚠️ Ce que cela ne couvre PAS : un lien vers un domaine tiers reste possible.
//  L'interdire casserait des usages légitimes (lien vers un partenaire, un
//  formulaire). Le risque d'hameçonnage par lien subsiste donc, borné par le fait
//  que seuls les gestionnaires peuvent écrire ces gabarits — et que leurs
//  modifications sont désormais tracées (cf. BAC4).
// ════════════════════════════════════════════════════════════════════════════

/** Propriétés CSS tolérées, avec la forme attendue de leur valeur. */
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]+)$/i;

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    // Texte et structure (StarterKit)
    "p",
    "br",
    "hr",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "s",
    "strike",
    "code",
    "pre",
    "blockquote",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "ul",
    "ol",
    "li",
    // Couleur et surlignage
    "span",
    "mark",
    // Liens et images
    "a",
    "img",
    // Tableaux
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "th",
    "td",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "title", "width", "height"],
    // `style` n'est accepté que filtré par `allowedStyles` ci-dessous.
    span: ["style"],
    mark: ["style", "data-color"],
    p: ["style"],
    h1: ["style"],
    h2: ["style"],
    h3: ["style"],
    h4: ["style"],
    h5: ["style"],
    h6: ["style"],
    th: ["colspan", "rowspan", "style"],
    td: ["colspan", "rowspan", "style"],
    table: ["style"],
  },
  // Seules ces propriétés survivent, et seulement sous cette forme. Sans ce
  // filtre, `style` rouvrirait la porte (`background: url(javascript:…)`,
  // positionnement absolu recouvrant le contenu légitime du message).
  allowedStyles: {
    "*": {
      color: [COLOR],
      "background-color": [COLOR],
      "text-align": [/^(left|right|center|justify)$/],
      "font-weight": [/^(normal|bold|[1-9]00)$/],
      "font-style": [/^(normal|italic)$/],
      "text-decoration": [/^(none|underline|line-through)$/],
    },
  },
  // Schémas d'URL admis. `javascript:` et `vbscript:` en sont absents, et
  // `data:` n'est toléré que pour les images (cf. allowedSchemesByTag) : un
  // `data:text/html` dans un lien équivaudrait à du script.
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesByTag: { img: ["http", "https", "data"] },
  allowedSchemesAppliedToAttributes: ["href", "src"],
  // Une URL sans schéma (`//exemple.fr`) hérite du protocole de la page : on
  // exige un schéma explicite.
  allowProtocolRelative: false,
  // Tout lien s'ouvre isolément : `noopener` empêche la page cible de manipuler
  // la fenêtre d'origine, `noreferrer` de savoir d'où vient le clic.
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }),
  },
  // Les commentaires HTML peuvent servir à masquer du contenu ou à perturber
  // l'analyse des clients de messagerie. Aucun gabarit légitime n'en a besoin.
  allowedClasses: {},
  parseStyleAttributes: true,
};

/**
 * Assainit le HTML d'un gabarit d'e-mail. Renvoie toujours une chaîne exploitable :
 * une entrée vide ou non textuelle donne "".
 *
 * Les marqueurs de variables (`{{prenom}}`, `{{#if …}}`) traversent intacts : ce
 * sont du texte pour l'analyseur, et ils sont résolus APRÈS, au rendu.
 *
 * NORMALISE au passage : les éléments vides sont réécrits en forme auto-fermante
 * (`<br>` → `<br />`). Le rendu est identique dans les clients de messagerie, mais
 * la sortie n'est donc pas toujours identique à l'entrée, même propre — d'où
 * l'absence de contrôle « le contenu a-t-il été filtré ? », qui se déclencherait
 * sur cette réécriture bénigne et crierait au loup.
 */
export function sanitizeTemplateHtml(html: unknown): string {
  if (typeof html !== "string" || html === "") return "";
  return sanitizeHtml(html, OPTIONS);
}
