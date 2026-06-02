/* Extrait _ICON_CATEGORIES et svcIcon de l'ancien app.js (PHP) vers un module TS,
   sans retranscription manuelle (préserve les octets emoji exacts). */
const fs = require("node:fs");
const path = require("node:path");

const SRC = "C:/Users/d.leger/Documents/test/public/js/app.js";
const OUT = path.join(__dirname, "..", "src", "app", "(admin)", "services", "legacy-icons.ts");

const src = fs.readFileSync(SRC, "utf8");

// ── 1. Bloc _ICON_CATEGORIES (array literal) ──
const catDecl = "const _ICON_CATEGORIES = [";
const catStart = src.indexOf(catDecl);
if (catStart === -1) throw new Error("_ICON_CATEGORIES introuvable");
const arrOpen = src.indexOf("[", catStart);
let depth = 0;
let i = arrOpen;
for (; i < src.length; i++) {
  const ch = src[i];
  if (ch === "[") depth++;
  else if (ch === "]") {
    depth--;
    if (depth === 0) break;
  }
}
const catLiteral = src.slice(arrOpen, i + 1); // "[ ... ]"

// ── 2. Fonction svcIcon ──
const fnStart = src.indexOf("function svcIcon(");
if (fnStart === -1) throw new Error("svcIcon introuvable");
const braceOpen = src.indexOf("{", fnStart);
depth = 0;
let j = braceOpen;
for (; j < src.length; j++) {
  const ch = src[j];
  if (ch === "{") depth++;
  else if (ch === "}") {
    depth--;
    if (depth === 0) break;
  }
}
const fnFull = src.slice(fnStart, j + 1);

// On garde la logique déterministe (à partir de `const l = (label`),
// en remplaçant le bloc d'origine (lookup SERVICES) par un paramètre explicite.
const bodyStart = fnFull.indexOf("const l = (label");
if (bodyStart === -1) throw new Error("corps svcIcon inattendu");
let body = fnFull.slice(bodyStart, fnFull.length - 1); // jusqu'à juste avant le '}' final
// Typage minimal pour passer tsc strict / Biome.
body = body.replace("const pick = arr =>", "const pick = (arr: string[]) =>");

const out = `// AUTO-GÉNÉRÉ depuis test/public/js/app.js (ancienne version PHP) — ne pas éditer à la main.
// Régénérer : node scripts/extract-legacy-icons.cjs

export type IconCategory = { label: string; icons: string[] };

export const ICON_CATEGORIES: IconCategory[] = ${catLiteral};

// Icône d'un service : l'icône configurée si présente, sinon un fallback
// déterministe dérivé du libellé (repris à l'identique de l'ancien svcIcon).
export function legacyServiceIcon(
  label: string,
  id: string,
  configuredIcon: string | null,
): string {
  if (configuredIcon) return configuredIcon;
  ${body.trim()}
}
`;

fs.writeFileSync(OUT, out, "utf8");
console.log("Écrit:", OUT, "(", Buffer.byteLength(out), "octets )");
