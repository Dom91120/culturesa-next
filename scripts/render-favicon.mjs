// Génère le favicon src/app/icon.png (256×256, fond transparent) à partir du monogramme
// « CR » de la sidebar, rendu DANS l'application pour utiliser sa police (Instrument Sans,
// chargée par next/font, indisponible hors page) — même police, taille relative et graisse
// que l'avatar de la barre utilisateur, sur un disque de la couleur de la sidebar cerné d'un
// filet vert (Dom 2026-09-06).
// Usage : serveur sur http://localhost:3000 :  node scripts/render-favicon.mjs
import puppeteer from "puppeteer";

const BASE = process.env.CAPTURE_BASE_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "src/app/icon.png";
const SIZE = 256;
// Fond du disque = fond de la sidebar (--sidebar-bg du thème clair, app-legacy.css).
const BG = "#1a1f2e";

const browser = await puppeteer.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 600, height: 400, deviceScaleFactor: 1 });
  // La page de connexion suffit : la police y est chargée.
  await page.goto(`${BASE}/auth/login`, { waitUntil: "networkidle0", timeout: 120000 });
  await page.evaluate(
    async ({ size, bg }) => {
      await document.fonts.ready;
      const el = document.createElement("div");
      el.id = "favicon-mark";
      // Même recette que .sidebar-mark (30px / .8rem / 700 / letter-spacing -0.1em), à l'échelle.
      el.style.cssText = `position:fixed;top:20px;left:20px;width:${size}px;height:${size}px;border-radius:50%;background:${bg};border:${Math.round(size / 30)}px solid #5ab544;box-sizing:border-box;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:${(size * 12.8) / 30}px;letter-spacing:-0.1em;line-height:1;z-index:99999`;
      el.innerHTML = 'C<em style="color:#5ab544;font-style:italic">R</em>';
      document.body.appendChild(el);
      // Tout le reste invisible et fond transparent : le PNG ne garde que le disque
      // (coins transparents), pas la page derrière.
      const style = document.createElement("style");
      style.textContent =
        "html,body{background:transparent !important} body > *:not(#favicon-mark){visibility:hidden !important}";
      document.head.appendChild(style);
    },
    { size: SIZE, bg: BG },
  );
  await new Promise((r) => setTimeout(r, 300));
  const el = await page.$("#favicon-mark");
  await el.screenshot({ path: OUT, omitBackground: true });
  console.log(`✓ ${OUT} (${SIZE}×${SIZE}, fond transparent)`);
} finally {
  await browser.close();
}
