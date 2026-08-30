// Génère les pages d'aide servies dans l'app à partir de la source markdown UNIQUE :
//   docs/Guide-utilisation.md (+ docs/img/*)
//     → public/aide/guide-utilisation.html  (guide COMPLET, gestionnaires/admins)
//     → public/aide/guide-usager.html       (déclinaison USAGER, sections filtrées)
//     → public/aide/img/*
// Relancer après toute modif du guide :  pnpm gen:docs (aussi lancé par `pnpm build`).
// Livrables Word : `pnpm gen:docs:word` (mêmes sources, mêmes déclinaisons).
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const require = createRequire(import.meta.url);
const { filtrerGuideUsager } = require("./guide-usager-filter.cjs");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcMd = join(root, "docs", "Guide-utilisation.md");
const srcImg = join(root, "docs", "img");
const outImg = join(root, "public", "aide", "img");

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
const mdComplet = readFileSync(srcMd, "utf8").replace(/^<!--[\s\S]*?-->\s*/, "");

const renderBody = (md) =>
  marked
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

const pageHtml = (title, body) => `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
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
  /* Captures d'écran : cadrées, bordure douce, légende (l'italique qui suit) centrée. */
  img { display: block; max-width: 100%; height: auto; margin: 1rem auto .3rem; border: 1px solid var(--border); border-radius: 8px; }
  img + em { display: block; text-align: center; font-size: .82rem; color: var(--muted); margin-bottom: 1.4rem; }
  /* Impression / export PDF (option « Imprimer → Enregistrer en PDF » du navigateur). */
  @media print {
    :root { --bg: #fff; --fg: #000; --muted: #444; --border: #bbb; --surface2: #f2f2f2; }
    main { max-width: none; padding: 0; }
    h2 { break-after: avoid; }
    h3 { break-after: avoid; }
    img, table, blockquote { break-inside: avoid; }
    a { color: inherit; text-decoration: none; }
  }
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;

// Les deux déclinaisons : guide complet + guide de l'usager (sections filtrées).
const outputs = [
  ["guide-utilisation.html", "Guide d'utilisation — CultuRésa", mdComplet],
  ["guide-usager.html", "Guide de l'usager — CultuRésa", filtrerGuideUsager(mdComplet)],
];
for (const [file, title, md] of outputs) {
  const out = join(root, "public", "aide", file);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, pageHtml(title, renderBody(md)), "utf8");
  console.log(`✓ ${out}`);
}

// Copie les captures d'écran référencées par le guide (chemins relatifs `img/…`).
if (existsSync(srcImg)) {
  cpSync(srcImg, outImg, { recursive: true });
  console.log(`✓ ${outImg} (captures copiées depuis docs/img)`);
}
console.log(`  (source : ${srcMd})`);
