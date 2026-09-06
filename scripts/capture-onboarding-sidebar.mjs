// Capture de la barre de gauche (liste des services) pour l'onboarding usager :
// public/onboarding/services-sidebar.png — carte aux coins arrondis, fond transparent,
// service actif = le premier de la liste. Compte de test dont la catégorie voit TOUS les
// services de démo (assistante maternelle : 4 services), rendue ×2.
// Usage : le serveur (dev ou prod locale) tourne sur http://localhost:3000, base seedée :
//   node scripts/capture-onboarding-sidebar.mjs [chemin de sortie]
import puppeteer from "puppeteer";

const BASE = process.env.CAPTURE_BASE_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "public/onboarding/services-sidebar.png";
const USER = { email: "nina.assmat@test.fr", password: "Test0123456!" };
const RADIUS = 14; // coins de la carte (px CSS)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const page = await browser.newPage();
  await page.setViewport({ width: 1380, height: 940, deviceScaleFactor: 2 });
  await login(page, USER);
  await page.goto(`${BASE}/reservations`, { waitUntil: "networkidle0" });
  // Premier service actif (comme la capture d'origine).
  await page.waitForSelector("#service-sidebar button");
  await page.click("#service-sidebar button");
  await sleep(1200);
  const box = await page.evaluate((radius) => {
    const wrap = document.querySelector("#service-sidebar-wrap");
    const buttons = [...document.querySelectorAll("#service-sidebar button")];
    const last = buttons[buttons.length - 1].getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    const height = Math.ceil(last.bottom - w.top + 14);
    // Carte : hauteur ramenée au contenu, coins arrondis, tout le reste transparent.
    wrap.style.height = `${height}px`;
    wrap.style.borderRadius = `${radius}px`;
    wrap.style.borderRight = "none";
    wrap.style.overflow = "hidden";
    const style = document.createElement("style");
    style.textContent = `
      nextjs-portal{display:none !important}
      html, body, .app-layout, .app-main, main { background: transparent !important }
      .app-main, #user-bar { visibility: hidden !important }
      #service-sidebar-wrap * { visibility: visible }
    `;
    document.head.appendChild(style);
    return { x: w.left, y: w.top, width: Math.ceil(w.width), height, services: buttons.length };
  }, RADIUS);
  // Souris hors de la barre : aucun survol figé sur la capture.
  await page.mouse.move(900, 700);
  await sleep(300);
  await page.screenshot({
    path: OUT,
    omitBackground: true,
    clip: { x: box.x, y: box.y, width: box.width, height: box.height },
  });
  console.log(`✓ ${OUT} — ${box.width}×${box.height} px CSS (×2), ${box.services} services`);
} finally {
  await browser.close();
}
