// Capture de la modale « S'inscrire sur la liste d'attente » pour l'onboarding usager :
// public/onboarding/waitlist-form.png — tableau des demi-journées (lundi matin coché) et
// cadre « Option » (réservation automatique cochée), rendu ×2. Aucune écriture en base :
// la modale n'est pas validée.
// Usage : serveur sur http://localhost:3000, base seedée :
//   node scripts/capture-onboarding-waitlist.mjs [chemin de sortie]
import puppeteer from "puppeteer";

const BASE = process.env.CAPTURE_BASE_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "public/onboarding/waitlist-form.png";
// Usager de test d'un service dont la liste d'attente est active (défaut).
const USER = { email: "marie.maternelle@test.fr", password: "Test0123456!" };
const SERVICE = "svc_004";
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
  await page.goto(`${BASE}/reservations/${SERVICE}`, { waitUntil: "networkidle0" });
  await page.waitForSelector('button[aria-label="Liste d\'attente"]');
  await page.click('button[aria-label="Liste d\'attente"]');
  await page.waitForSelector("dialog[open] table input[type=checkbox]");
  await sleep(300);
  // Lundi matin + option « Réservation automatique ».
  const boxes = await page.$$("dialog[open] input[type=checkbox]");
  await boxes[0].click();
  await boxes[boxes.length - 1].click();
  await page.mouse.move(5, 5);
  await page.addStyleTag({ content: "nextjs-portal{display:none !important}" });
  await sleep(300);
  const clip = await page.evaluate(() => {
    const dlg = document.querySelector("dialog[open]");
    // Cadrage voulu (Dom 2026-09-06) : le tableau puis le cadre « Option », sans le
    // paragraphe « Vous serez prévenu par e-mail… » qui les sépare — masqué le temps de
    // la capture.
    for (const el of dlg.querySelectorAll("table ~ p")) el.style.display = "none";
    const table = dlg.querySelector("table").getBoundingClientRect();
    // Cadre « Option » = ancêtre encadré de la dernière case à cocher.
    const last = [...dlg.querySelectorAll("input[type=checkbox]")].pop();
    let box = last.parentElement;
    while (box && getComputedStyle(box).borderTopWidth === "0px") box = box.parentElement;
    const b = box.getBoundingClientRect();
    const x = Math.min(table.left, b.left) - 4;
    const right = Math.max(table.right, b.right) + 4;
    return { x, y: table.top - 4, width: right - x, height: b.bottom + 4 - (table.top - 4) };
  });
  await page.screenshot({ path: OUT, clip });
  console.log(`✓ ${OUT} — ${Math.round(clip.width)}×${Math.round(clip.height)} px CSS (×2)`);
} finally {
  await browser.close();
}
