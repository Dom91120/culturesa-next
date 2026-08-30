// Contrôle de fraîcheur de la documentation (`pnpm docs:check`) — trois vérifications :
//
//   1. AIDE INTÉGRÉE — régénère public/aide depuis docs/Guide-utilisation.md et échoue
//      si le résultat diffère de ce qui est commité (le .md a changé sans `pnpm gen:docs`).
//      NB : le build régénère aussi l'aide, ce contrôle protège surtout le dépôt/le dev.
//   2. LIVRABLES WORD — échoue si un guide Markdown est plus récent que son .docx
//      (les .docx ne sont pas comparables octet à octet : horodatage interne du zip).
//   3. LIBELLÉS FANTÔMES — chaque libellé d'interface cité « entre guillemets » dans
//      Guide-utilisation.md doit exister dans src/ : c'est ainsi qu'on aurait détecté
//      « Modèle de période » resté dans la doc un an après la suppression de la bascule.
//
// Sort en code 1 au premier problème, avec le geste correctif à faire.
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
process.chdir(root);
let failed = false;
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  failed = true;
};

// ── 1. Aide intégrée en phase avec le Markdown ────────────────────────────────────────
execFileSync(process.execPath, ["scripts/gen-guide-html.mjs"], { stdio: "ignore" });
try {
  execSync("git diff --quiet -- public/aide", { stdio: "ignore" });
  console.log("✓ Aide intégrée (public/aide) en phase avec docs/Guide-utilisation.md");
} catch {
  fail(
    "public/aide ne correspond plus à docs/Guide-utilisation.md — le dossier vient d'être régénéré : committez-le (pnpm gen:docs).",
  );
}

// ── 2. Word pas plus vieux que sa source ─────────────────────────────────────────────
// Comparaison par date de DERNIER COMMIT (les mtime locaux ne veulent rien dire après
// un clone) : le .docx doit avoir été (re)commité au plus tard avec le .md.
const lastCommitTs = (file) =>
  Number(execSync(`git log -1 --format=%ct -- "${file}"`).toString().trim() || 0);
for (const [md, docx] of [
  ["docs/Guide-utilisation.md", "docs/Guide-utilisation.docx"],
  ["docs/Guide-utilisation.md", "docs/Guide-usager.docx"],
  ["docs/Guide-administration.md", "docs/Guide-administration-CultuResa.docx"],
]) {
  if (lastCommitTs(md) > lastCommitTs(docx)) {
    fail(`${docx} est plus ancien que ${md} — relancez \`pnpm gen:docs:word\` et committez.`);
  } else {
    console.log(`✓ ${docx} à jour de ${md}`);
  }
}

// ── 3. Libellés d'interface cités dans le guide → doivent exister dans src/ ─────────
// Guillemets français du guide fonctionnel uniquement (le guide serveur cite des
// commandes, pas des libellés). Normalisation : apostrophes typographiques et espaces
// insécables ramenées à leur forme simple des deux côtés.
const normalize = (s) =>
  s
    .replace(/[  ]/g, " ")
    .replace(/’/g, "'")
    .replace(/\s+/g, " ")
    .trim();

// Citations du guide qui ne sont PAS des libellés d'interface (prose, exemples).
const ALLOWLIST = new Set([
  "2025-2026", // exemple d'exercice
  "libre", // modes de thème, cités hors contexte exact
  "liste",
  "Clôturé", // suffixe d'état rendu dynamiquement
  "entre guillemets", // auto-référence du présent script si citée un jour
]);

const guide = normalize(fs.readFileSync("docs/Guide-utilisation.md", "utf8"));
const labels = new Set();
for (const m of guide.matchAll(/«\s?([^»]{2,60}?)\s?»/g)) labels.add(m[1].trim());

// Les COMMENTAIRES sont retirés du corpus : un libellé d'UI supprimée survit longtemps
// dans les commentaires (c'est précisément le cas « Modèle de période ») — seul le code
// effectif (chaînes JSX/TS) atteste qu'un libellé existe encore à l'écran.
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const corpus = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    // src/generated (client Prisma) : du généré, pas de l'UI — il embarque en outre
    // schema.prisma en chaîne, commentaires compris, ce qui aveuglait le détecteur.
    if (e.isDirectory()) {
      if (e.name !== "generated") walk(p);
    } else if (/\.(ts|tsx)$/.test(e.name)) corpus.push(stripComments(fs.readFileSync(p, "utf8")));
  }
};
walk("src");
const code = normalize(corpus.join("\n"));

const orphans = [...labels].filter((l) => !ALLOWLIST.has(l) && !code.includes(l));
if (orphans.length > 0) {
  fail(
    `libellés cités dans docs/Guide-utilisation.md introuvables dans src/ (interface disparue ou renommée ?) :\n    - ${orphans.join("\n    - ")}`,
  );
} else {
  console.log(`✓ ${labels.size} libellés du guide retrouvés dans src/`);
}

process.exit(failed ? 1 : 0);
