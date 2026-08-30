// Capture des écrans de documentation (captures @2x, mêmes gabarits que docs/img).
// Usage : le serveur dev (ou prod locale) tourne sur http://localhost:3000, base SEEDÉE
// (comptes de démo du seed), puis :  node scripts/capture-doc-shots.mjs
// Produit : docs/img/06-agenda-admin.png, docs/img/03-mon-compte.png,
//           public/onboarding/pointage-mode.png
// Après validation des images : `pnpm gen:docs && pnpm gen:docs:word` (artefacts).
import fs from "node:fs";
import puppeteer from "puppeteer";

const BASE = process.env.CAPTURE_BASE_URL ?? "http://localhost:3000";
// Identifiants de DÉMO du seed (prisma/seed.ts) — fixtures du dépôt, pas des secrets.
const ADMIN = { email: "informatique@chatillon92.fr", password: "Admin123456!" };
// Usager SANS réservation sur l'exercice en cours : le bloc catégorie/structure
// s'affiche en mode MODIFIABLE (sinon lecture seule, #p-demandeur absent).
const USAGER = { email: "lea.loisir-mat@test.fr", password: "Test0123456!" };
// Gabarit des captures existantes : fenêtre 1380×940 rendue en ×2 (2760×1880).
const VIEWPORT = { width: 1380, height: 940, deviceScaleFactor: 2 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Masque l'indicateur des devtools Next.js (pastille « N ») quand la capture est
// prise sur un serveur de dev — sans objet en prod.
const hideDevtools = (page) =>
  page.addStyleTag({ content: "nextjs-portal{display:none !important}" });

async function login(page, { email, password }) {
  await page.goto(BASE, { waitUntil: "networkidle0" });
  const status = await page.evaluate(async (body) => {
    const r = await fetch("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    return r.status;
  }, JSON.stringify({ email, password }));
  if (status !== 200) throw new Error(`connexion ${email} : HTTP ${status}`);
}

const browser = await puppeteer.launch({ headless: true, args: ["--hide-scrollbars"] });
try {
  // ── 1. Agenda admin (docs/img/06-agenda-admin.png) ────────────────────────────────
  {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport(VIEWPORT);
    await login(page, ADMIN);
    await page.goto(`${BASE}/services/svc_001/agenda`, { waitUntil: "networkidle0" });
    // Exercice 2025-2026 : semaine de septembre avec réservations (badges + macaron).
    await page.waitForSelector('button[aria-label="Exercice précédent"]');
    await page.click('button[aria-label="Exercice précédent"]');
    await page.waitForSelector(".planning-name-tag", { timeout: 15000 });
    await hideDevtools(page);
    await sleep(800); // polices/transitions
    await page.screenshot({ path: "docs/img/06-agenda-admin.png" });
    console.log("✓ docs/img/06-agenda-admin.png");

    // ── 3. Barre d'options, « Mode pointage » coché (public/onboarding) ─────────────
    await page.evaluate(() => {
      const label = [...document.querySelectorAll("label")].find((l) =>
        l.textContent?.includes("Mode pointage"),
      );
      label?.querySelector("input")?.click();
    });
    await sleep(600);
    const clip = await page.evaluate(() => {
      const labels = [...document.querySelectorAll("label")].filter(
        (l) =>
          l.textContent?.includes("Masquer les horaires") ||
          l.textContent?.includes("Mode validation") ||
          l.textContent?.includes("Mode pointage"),
      );
      const btns = [...document.querySelectorAll("button")].filter(
        (b) =>
          b.getAttribute("aria-label")?.includes("Imprimer") ||
          b.getAttribute("title")?.includes("création") ||
          b.textContent?.includes("Mode création"),
      );
      const boxes = [...labels, ...btns].map((e) => e.getBoundingClientRect());
      const x1 = Math.min(...boxes.map((b) => b.left));
      const y1 = Math.min(...boxes.map((b) => b.top));
      const x2 = Math.max(...boxes.map((b) => b.right));
      const y2 = Math.max(...boxes.map((b) => b.bottom));
      return { x: x1 - 6, y: y1 - 6, width: x2 - x1 + 12, height: y2 - y1 + 12 };
    });
    await page.screenshot({ path: "public/onboarding/pointage-mode.png", clip });
    console.log("✓ public/onboarding/pointage-mode.png");
    await ctx.close();
  }

  // ── 2. Mon compte, côté USAGER (docs/img/03-mon-compte.png) ───────────────────────
  {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport(VIEWPORT);
    await login(page, USAGER);
    await page.goto(`${BASE}/mon-compte`, { waitUntil: "networkidle0" });
    await page.waitForSelector("#p-demandeur"); // bloc catégorie/structure rendu
    await hideDevtools(page);
    await sleep(500);
    await page.screenshot({ path: "docs/img/03-mon-compte.png", fullPage: true });
    console.log("✓ docs/img/03-mon-compte.png");
    await ctx.close();
  }
} finally {
  await browser.close();
}
for (const f of [
  "docs/img/06-agenda-admin.png",
  "docs/img/03-mon-compte.png",
  "public/onboarding/pointage-mode.png",
]) {
  const { size } = fs.statSync(f);
  console.log(`  ${f} — ${Math.round(size / 1024)} Ko`);
}
