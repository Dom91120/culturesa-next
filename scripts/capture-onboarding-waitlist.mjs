// Capture de la modale « S'inscrire sur la liste d'attente » pour l'onboarding usager :
// public/onboarding/waitlist-form.png — du tableau des demi-journées (lundi et mardi
// après-midi cochés) au cadre « Option » (réservation automatique cochée), en passant par
// le paragraphe e-mail et le bloc « Périodes souhaitées » (service à plusieurs périodes,
// seule la première cochée) — maquette Dom 2026-09-06, rendu ×2. Aucune écriture en base :
// la modale n'est pas validée.
// Usage : serveur sur http://localhost:3000, base seedée :
//   node scripts/capture-onboarding-waitlist.mjs [chemin de sortie]
import puppeteer from "puppeteer";

const BASE = process.env.CAPTURE_BASE_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "public/onboarding/waitlist-form.png";
// Usager de test ayant accès à un service à PLUSIEURS périodes (bloc « Périodes souhaitées »).
const USER = { email: "paul.elementaire@test.fr", password: "Test0123456!" };
const SERVICE = "svc_003";
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
  // Lundi et mardi APRÈS-MIDI (2e ligne du tableau) ; périodes : seule la première reste
  // cochée ; option « Réservation automatique » cochée.
  const rows = await page.$$("dialog[open] table tbody tr");
  const pm = await rows[1].$$("input[type=checkbox]");
  await pm[0].click();
  await pm[1].click();
  const others = await page.$$("dialog[open] input[type=checkbox]:not(table input)");
  // Hors tableau : les périodes, puis l'option (dernière case).
  for (const b of others.slice(1, others.length - 1)) await b.click();
  await others[others.length - 1].click();
  await page.mouse.move(5, 5);
  await page.addStyleTag({ content: "nextjs-portal{display:none !important}" });
  await sleep(300);
  const clip = await page.evaluate(() => {
    const dlg = document.querySelector("dialog[open]");
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
