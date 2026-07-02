// Génère la page d'aide servie dans l'app à partir de la source markdown UNIQUE.
//   docs/Guide-utilisation.md  →  public/aide/guide-utilisation.html
// Relancer après toute modif du guide :  pnpm gen:docs
// NB : le livrable Word (docs/Guide-utilisateur-CultuResa.docx) est maintenu à la MAIN
// (mieux mis en page qu'une conversion automatique) ; il n'est pas généré ici.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcMd = join(root, "docs", "Guide-utilisation.md");
const outHtml = join(root, "public", "aide", "guide-utilisation.html");

// Slug façon GitHub : minuscules, on retire emojis/ponctuation, espaces → tirets.
// (marked v18 ne génère plus les id d'en-têtes ; on les réinjecte pour que les
// liens d'ancrage internes du guide — #1-usager, etc. — fonctionnent.)
const slug = (text) =>
  text
    .replace(/<[^>]+>/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

// On retire le commentaire mainteneur en tête du .md (note de régénération) avant le rendu.
const md = readFileSync(srcMd, "utf8").replace(/^<!--[\s\S]*?-->\s*/, "");
const body = marked
  .parse(md, { mangle: false, headerIds: true })
  // Réinjecte les id d'en-têtes (ancres internes).
  .replace(
    /<(h[1-6])>(.*?)<\/\1>/g,
    (_m, tag, inner) => `<${tag} id="${slug(inner)}">${inner}</${tag}>`,
  )
  // Les liens inter-documents (.md) ne sont pas servis dans /aide : on neutralise le
  // lien tout en gardant le libellé (les ancres internes #… restent fonctionnelles).
  .replace(/<a href="[^"#][^"]*\.md[^"]*">(.*?)<\/a>/g, "<span>$1</span>")
  // marked percent-encode les accents dans les href d'ancres ; on les redécode pour
  // qu'ils correspondent EXACTEMENT aux id d'en-têtes (UTF-8 brut) réinjectés ci-dessus.
  .replace(/href="#([^"]+)"/g, (_m, frag) => `href="#${decodeURIComponent(frag)}"`);

const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Guide d'utilisation — CultuRésa</title>
<style>
  :root {
    --bg: #ffffff; --fg: #1f2430; --muted: #5b6472; --accent: #2f8f5b;
    --border: #e3e7ee; --surface2: #f6f8fb; --code: #eef1f6;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #12151b; --fg: #e6e9ef; --muted: #9aa4b2; --accent: #4fbf82;
      --border: #2a2f3a; --surface2: #1a1f27; --code: #1c222b;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--fg);
    font: 16px/1.65 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  }
  main { max-width: 820px; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
  h1 { font-size: 1.9rem; line-height: 1.2; margin: 0 0 .4rem; }
  h2 { font-size: 1.35rem; margin: 2.4rem 0 .8rem; padding-bottom: .35rem; border-bottom: 1px solid var(--border); }
  h3 { font-size: 1.08rem; margin: 1.8rem 0 .5rem; }
  p, li { color: var(--fg); }
  a { color: var(--accent); }
  hr { border: none; border-top: 1px solid var(--border); margin: 2.2rem 0; }
  blockquote {
    margin: 1rem 0; padding: .6rem 1rem; border-left: 3px solid var(--accent);
    background: var(--surface2); color: var(--muted); border-radius: 0 6px 6px 0;
  }
  blockquote p { margin: .2rem 0; }
  code { background: var(--code); padding: .1em .35em; border-radius: 4px; font-size: .92em; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: .95rem; }
  th, td { border: 1px solid var(--border); padding: .5rem .7rem; text-align: left; vertical-align: top; }
  th { background: var(--surface2); }
  ul, ol { padding-left: 1.4rem; }
  li { margin: .25rem 0; }
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;

mkdirSync(dirname(outHtml), { recursive: true });
writeFileSync(outHtml, html, "utf8");
console.log(`✓ ${outHtml}`);
console.log(`  (source : ${srcMd})`);
