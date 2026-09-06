// Capture DÉTOURÉE du badge « ma réservation » AVEC jauge (− 2 + Enfants ⏳ − 1 + Adulte),
// en BROUILLON (aucune écriture en base) : connexion usager de test, clic sur un créneau
// libre à jauge, capture de l'élément à ×3 sur fond transparent.
import puppeteer from "puppeteer";

const BASE = "http://localhost:3000";
const OUT = process.argv[2] ?? "public/onboarding/reservation-badge-gauge.png";
// 2e capture : le même badge SURVOLÉ (croix ×, poignée, macaron « A » gris) — page
// « Prévenir d'une absence » de l'onboarding (Dom 2026-09-06).
const OUT_HOVER = process.argv[3] ?? "public/onboarding/reservation-badge-hover.png";
const USERS = [
  // Usager de test SANS réservation sur ce service (sinon « Limite de réservations atteinte »),
  // dont la catégorie est en mode validation → badge « en attente » (⏳), comme le mock.
  { email: "marie.maternelle@test.fr", password: "Test0123456!" },
];
const SERVICES = ["svc_004"];
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
  for (const user of USERS) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1380, height: 940, deviceScaleFactor: 3 });
    await login(page, user);
    for (const id of SERVICES) {
      const href = `/reservations/${id}`;
      await page.goto(`${BASE}${href}`, { waitUntil: "networkidle0" });
      await sleep(600);
      // Créneaux libres à jauge : bloc horaire (pas journée entière) affichant « places ».
      let ok = false;
      let found = null;
      for (let k = 0; k < 6 && !ok; k++) {
        found = await page.evaluate((k) => {
          const blocks = [...document.querySelectorAll(".agenda-block")].filter((b) => {
            const t = b.textContent ?? "";
            if (!/place/.test(t) || /Clôturé/.test(t)) return false;
            if (b.querySelector(".user-agenda-mine-badge")) return false;
            const r = b.getBoundingClientRect();
            return r.width > 120 && r.height >= 36 && r.height <= 70;
          });
          const b = blocks[k];
          if (!b) return null;
          // Marque le bloc cliqué : le badge à capturer est CELUI de ce bloc (brouillon),
          // pas une réservation existante de l'usager ailleurs sur la page.
          for (const o of document.querySelectorAll("[data-cap]")) o.removeAttribute("data-cap");
          b.setAttribute("data-cap", "1");
          b.scrollIntoView({ block: "center" });
          const r = b.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: b.textContent };
        }, k);
        if (!found) break;
        await page.mouse.click(found.x, found.y);
        await sleep(500);
        ok = await page.evaluate(() => {
          const badge = document.querySelector("[data-cap] .user-agenda-mine-badge.has-widgets");
          const t = badge?.textContent ?? "";
          return !!badge && /Enfant/.test(t) && /Adulte/.test(t);
        });
        // Raté : on décoche le brouillon (verrou « une seule action ») avant le suivant.
        if (!ok) {
          await page.mouse.click(found.x, found.y);
          await sleep(300);
        }
      }
      if (!found) {
        const n = await page.$$eval(".agenda-block", (b) => b.length);
        console.log("  ", user.email, href, ": aucun créneau candidat (blocs :", n, ")");
        continue;
      }
      if (!ok) {
        const dbg = await page.evaluate(() => {
          const badge = document.querySelector(".user-agenda-mine-badge");
          const txt = document.body.innerText;
          const i = txt.search(/Limite|action en attente/);
          return {
            badges: document.querySelectorAll(".user-agenda-mine-badge").length,
            badgeText: badge ? badge.textContent.replace(/\s+/g, " ") : null,
            message: i >= 0 ? txt.slice(i, i + 70) : null,
          };
        });
        console.log("  ", user.email, href, ": pas de badge à jauge —", JSON.stringify(dbg));
        continue;
      }
      // Effectifs de l'illustration : 3 enfants, 1 adulte (Dom 2026-09-06) — on ramène les
      // compteurs de la fiche de l'usager avec les boutons « − » du badge (brouillon).
      const TARGET = [3, 1];
      for (let i = 0; i < TARGET.length; i++) {
        for (let guard = 0; guard < 40; guard++) {
          const value = await page.evaluate((i) => {
            const inputs = document.querySelectorAll("[data-cap] .user-agenda-mine-badge input");
            return inputs[i] ? Number(inputs[i].value) : null;
          }, i);
          if (value === null || value <= TARGET[i]) break;
          const minus = await page.$$(
            "[data-cap] .user-agenda-mine-badge button[aria-label=Diminuer]",
          );
          await minus[i].click();
          await sleep(120);
        }
      }
      // Tout transparent SAUF le badge (et pas de souris dessus : pas de survol).
      await page.mouse.move(5, 5);
      await page.addStyleTag({
        content: `
          nextjs-portal{display:none !important}
          html, body, *:not(.user-agenda-mine-badge):not(.user-agenda-mine-badge *) {
            background: transparent !important; background-image: none !important;
            border-color: transparent !important; box-shadow: none !important;
            color: transparent !important;
          }
          [data-tip]::after, [data-tip]::before { display: none !important }
        `,
      });
      await sleep(300);
      const box = await page.evaluate(() => {
        const b = document.querySelector("[data-cap] .user-agenda-mine-badge.has-widgets");
        const r = b.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, text: b.textContent, cls: b.className };
      });
      const pad = 6;
      await page.screenshot({
        path: OUT,
        omitBackground: true,
        clip: { x: box.x - pad, y: box.y - pad, width: box.w + 2 * pad, height: box.h + 2 * pad },
      });
      console.log(
        "✓",
        OUT,
        `${Math.round(box.w)}×${Math.round(box.h)} css px`,
        "—",
        user.email,
        href,
        "—",
        box.text.replace(/\s+/g, " "),
        box.cls,
      );
      // Survol : souris au centre du badge. Un BROUILLON ne porte pas encore le macaron
      // « A » (absence déclarable seulement sur une réservation enregistrée) : on insère le
      // même bouton, rendu par la même CSS (.slot-btn-absence), pour montrer le badge tel
      // que l'usager le verra sur sa réservation.
      await page.evaluate(() => {
        const b = document.querySelector("[data-cap] .user-agenda-mine-badge.has-widgets");
        if (!b.querySelector(".slot-btn-absence")) {
          const a = document.createElement("button");
          a.type = "button";
          a.className = "slot-btn-absence";
          a.textContent = "A";
          b.insertBefore(a, b.querySelector(".slot-drag-handle"));
        }
      });
      await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2);
      await sleep(400);
      await page.screenshot({
        path: OUT_HOVER,
        omitBackground: true,
        clip: { x: box.x - pad, y: box.y - pad, width: box.w + 2 * pad, height: box.h + 2 * pad },
      });
      console.log("✓", OUT_HOVER, "(survolé)");
      await ctx.close();
      await browser.close();
      process.exit(0);
    }
    await ctx.close();
  }
  console.log("aucun créneau à jauge trouvé");
} finally {
  await browser.close();
}
