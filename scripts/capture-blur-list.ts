// Liste des PERSONNES RÉELLES à flouter sur les captures de documentation : tous les
// comptes qui ne sont pas des comptes de démonstration (seed @test.fr, administrateur
// seedé, comptes anonymisés). Écrit `.capture-blur.json` (ignoré par git), lu par
// scripts/capture-doc-shots.mjs. Usage : npx tsx --env-file=.env scripts/capture-blur-list.ts
import fs from "node:fs";
import { prisma } from "@/server/db";

const DEMO = /@test\.fr$|^informatique@chatillon92\.fr$|@anonymise\.local$/;

const users = await prisma.user.findMany({
  select: { nom: true, prenom: true, email: true },
});
const tokens = new Set<string>();
for (const u of users) {
  if (!u.email || DEMO.test(u.email)) continue;
  const nom = u.nom.trim();
  const prenom = u.prenom.trim();
  if (nom.length >= 2) tokens.add(nom);
  if (prenom.length >= 2) tokens.add(prenom);
  tokens.add(u.email);
  tokens.add(u.email.split("@")[0]);
}
fs.writeFileSync(".capture-blur.json", JSON.stringify([...tokens], null, 1));
console.log(`.capture-blur.json : ${tokens.size} jeton(s) à flouter`);
await prisma.$disconnect();
