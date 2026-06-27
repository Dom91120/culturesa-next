// Nettoyage conservateur du CSS mort de app-legacy.css (audit code mort 2026-06).
// Règle : une règle CSS n'est supprimée que si TOUS ses sélecteurs sont morts ;
// un sélecteur est mort s'il contient AU MOINS un token classe/id dont le nom
// n'apparaît NULLE PART (même en sous-chaîne) dans les sources .ts/.tsx.
// La recherche en sous-chaîne est volontairement laxiste (faux "vivants" possibles,
// jamais de faux "morts") : tout token construit dynamiquement ou fragmenté dans un
// template string reste détecté comme vivant.
// Usage : node scripts/prune-dead-css.mjs [--apply]

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const CSS_PATH = join(ROOT, "src", "app", "app-legacy.css");
const APPLY = process.argv.includes("--apply");

// ── Source corpus : tout le contenu .ts/.tsx de src/ ──
function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(readFileSync(p, "utf8"));
  }
  return out;
}
const corpus = walk(join(ROOT, "src"), []).join("\n");

const css = readFileSync(CSS_PATH, "utf8");

// ── Parse en blocs de premier niveau (gère les @media imbriqués) ──
function parseBlocks(text) {
  const blocks = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open === -1) {
      blocks.push({ kind: "raw", text: text.slice(i) });
      break;
    }
    const header = text.slice(i, open);
    // Trouve l'accolade fermante correspondante.
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") depth--;
      j++;
    }
    const body = text.slice(open + 1, j - 1);
    const sel = header
      .trim()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .trim();
    if (sel.startsWith("@media") || sel.startsWith("@supports")) {
      blocks.push({ kind: "at", header: text.slice(i, open), body, raw: text.slice(i, j) });
    } else if (sel.startsWith("@")) {
      // @keyframes, @font-face, @page… : conservés tels quels.
      blocks.push({ kind: "raw", text: text.slice(i, j) });
    } else {
      blocks.push({ kind: "rule", header: text.slice(i, open), body, raw: text.slice(i, j) });
    }
    i = j;
  }
  return blocks;
}

const tokenRe = /[.#]([A-Za-z0-9_-]+)/g;

// Classes composées DYNAMIQUEMENT (ex. `toast toast--${variant}`) : le nom complet
// n'apparaît jamais littéralement dans les sources → on les conserve explicitement
// pour éviter un faux « mort ». Ajouter ici toute nouvelle famille de ce type.
const KEEP = new Set(["toast--success", "toast--danger", "toast--warn"]);

const liveCache = new Map();
function tokenLive(name) {
  if (!liveCache.has(name)) liveCache.set(name, KEEP.has(name) || corpus.includes(name));
  return liveCache.get(name);
}

function selectorDead(selector) {
  // Un sélecteur sans classe ni id (élément, *, :root…) est toujours vivant.
  let dead = false;
  for (const m of selector.matchAll(tokenRe)) {
    if (!tokenLive(m[1])) dead = true;
  }
  return dead;
}

function ruleDead(header) {
  const sel = header.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  if (!sel) return false;
  const selectors = sel
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (selectors.length === 0) return false;
  return selectors.every(selectorDead);
}

const dropped = [];
function processBlocks(blocks) {
  let out = "";
  for (const b of blocks) {
    if (b.kind === "raw") {
      out += b.text;
    } else if (b.kind === "rule") {
      if (ruleDead(b.header)) dropped.push(b.header.trim().replace(/\s+/g, " "));
      else out += b.raw;
    } else {
      // @media / @supports : filtre les règles internes ; bloc vidé → supprimé.
      const inner = processBlocks(parseBlocks(b.body));
      if (inner.trim()) out += `${b.header}{${inner}}`;
      else dropped.push(`${b.header.trim().replace(/\s+/g, " ")} (bloc entier)`);
    }
  }
  return out;
}

const cleaned = processBlocks(parseBlocks(css));

console.log(`Règles supprimées : ${dropped.length}`);
for (const d of dropped) console.log(`  - ${d}`);
const before = css.split("\n").length;
const after = cleaned.split("\n").length;
console.log(`Lignes : ${before} → ~${after}`);

if (APPLY) {
  // Compacte les lignes vides multiples laissées par les suppressions.
  writeFileSync(CSS_PATH, cleaned.replace(/\n{3,}/g, "\n\n"), "utf8");
  console.log("Fichier réécrit.");
} else {
  console.log("(dry-run — relancer avec --apply pour écrire)");
}
