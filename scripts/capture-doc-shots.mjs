// Capture des écrans de documentation (captures @2x, mêmes gabarits que docs/img).
// Usage : le serveur dev (ou prod locale) tourne sur http://localhost:3000, base SEEDÉE
// (comptes de démo du seed), puis :
//   npx tsx --env-file=.env scripts/capture-blur-list.ts   # personnes réelles à flouter
//   node scripts/capture-doc-shots.mjs                      # toutes les captures
//   CAPTURE_ONLY=utilisateurs node scripts/capture-doc-shots.mjs   # une seule (clé ci-dessous)
// Produit les 15 figures du guide (docs/img/01… à 15…) et deux captures d'onboarding
// (public/onboarding/pointage-mode.png, validation-mode.png).
// Après validation des images : `pnpm gen:docs && pnpm gen:docs:word` (artefacts).
import fs from "node:fs";
import puppeteer from "puppeteer";

const BASE = process.env.CAPTURE_BASE_URL ?? "http://localhost:3000";
// Identifiants de DÉMO du seed (prisma/seed.ts) — fixtures du dépôt, pas des secrets.
const ADMIN = { email: "informatique@chatillon92.fr", password: "Admin123456!" };
// Usager AVEC réservations sur l'exercice en cours et un niveau renseigné : le bloc
// catégorie / structure / niveau s'affiche FIGÉ, sur une ligne, au-dessus du bouton
// Enregistrer (disposition 2026-09-04) — c'est le cas courant à documenter.
const USAGER = { email: "paul.elementaire@test.fr", password: "Test0123456!" };
// Usager avec des réservations sur la Maison des Arts (agenda usager, fenêtre de bienvenue).
const USAGER_AGENDA = { email: "marie.maternelle@test.fr", password: "Test0123456!" };
const SVC_AGENDA_USAGER = "svc_002"; // Maison des Arts
const SVC_ADMIN = "svc_003"; // Médiathèque (liste d'attente active, 3 périodes)
// Gabarit des captures existantes : fenêtre 1380×940 rendue en ×2 (2760×1880).
const VIEWPORT = { width: 1380, height: 940, deviceScaleFactor: 2 };
const ONLY = process.env.CAPTURE_ONLY ?? "";
const want = (name) => !ONLY || ONLY === name;
const produced = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Masque l'indicateur des devtools Next.js (pastille « N ») quand la capture est
// prise sur un serveur de dev — sans objet en prod.
const hideDevtools = (page) =>
  page.addStyleTag({ content: "nextjs-portal{display:none !important}" });

// Personnes RÉELLES floutées (Dom 2026-09-08) : jetons produits par capture-blur-list.ts
// (noms, prénoms, e-mails des comptes hors démonstration). Tout élément « feuille » dont
// le texte contient un jeton est flouté, ainsi que les avatars à initiales voisins.
const BLUR_TOKENS = fs.existsSync(".capture-blur.json")
  ? JSON.parse(fs.readFileSync(".capture-blur.json", "utf8"))
  : [];
if (BLUR_TOKENS.length === 0) {
  console.warn("⚠ .capture-blur.json absent ou vide : aucune personne ne sera floutée");
}
const blurRealPeople = (page) =>
  page.evaluate((tokens) => {
    if (tokens.length === 0) return 0;
    // Mot entier, sans casse (« Dom » ne floute pas « domaine »).
    const escape = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const res = tokens.map(
      (t) => new RegExp("(^|[^\\p{L}\\p{N}])" + escape(t) + "(?=$|[^\\p{L}\\p{N}])", "iu"),
    );
    let n = 0;
    for (const el of document.body.querySelectorAll("*")) {
      if (el.children.length > 0) continue;
      const txt = el.textContent ?? "";
      if (!txt.trim() || !res.some((re) => re.test(txt))) continue;
      el.style.filter = "blur(5px)";
      n++;
      // Avatar à initiales (Comptes / Connectés) : frère aîné du bloc nom + e-mail.
      const who = el.closest(".acct-who");
      const avatar = who?.querySelector(".acct-avatar");
      if (avatar) avatar.style.filter = "blur(5px)";
    }
    return n;
  }, BLUR_TOKENS);

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

/** Page connectée prête à capturer : contexte neuf, connexion, navigation, devtools masqués. */
async function openAs(browser, creds, path, waitFor) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(VIEWPORT);
  if (creds) await login(page, creds);
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle0" });
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 30000 });
  await hideDevtools(page);
  return { ctx, page };
}

// Agenda usager : la fenêtre « Plus aucune place disponible » s'ouvre d'elle-même quand
// la période affichée est complète (Marie est au maximum) — on la referme avant la capture.
async function dismissFullNotice(page) {
  await sleep(600);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      /J'ai compris/.test(x.textContent ?? ""),
    );
    b?.click();
  });
  await sleep(400);
}

async function shot(page, file, opts = {}) {
  await blurRealPeople(page);
  await sleep(opts.settle ?? 500);
  await page.screenshot({ path: file, fullPage: opts.fullPage ?? false });
  console.log(`✓ ${file}`);
  produced.push(file);
}

const browser = await puppeteer.launch({ headless: true, args: ["--hide-scrollbars"] });
try {
  // ── 01. Page de connexion (déconnecté) ──────────────────────────────────────────────
  if (want("connexion")) {
    const { ctx, page } = await openAs(browser, null, "/auth/login", "input[type=password]");
    await shot(page, "docs/img/01-page-connexion.png");
    await ctx.close();
  }

  // ── 02. Création de compte (déconnecté) ─────────────────────────────────────────────
  if (want("creation-compte")) {
    const { ctx, page } = await openAs(browser, null, "/auth/register", "form");
    await shot(page, "docs/img/02-creation-compte.png");
    await ctx.close();
  }

  // ── 03. Mon compte, côté USAGER ─────────────────────────────────────────────────────
  if (want("compte")) {
    const { ctx, page } = await openAs(browser, USAGER, "/mon-compte");
    // Bloc catégorie / structure figé rendu (mention « ne sont plus modifiables ici »).
    await page.waitForFunction(() =>
      document.body.innerText.includes("ne sont plus modifiables ici"),
    );
    await shot(page, "docs/img/03-mon-compte.png", { fullPage: true });
    await ctx.close();
  }

  // ── 04. Fenêtre de bienvenue (présentation rejouée depuis le menu utilisateur) ──────
  if (want("bienvenue")) {
    const { ctx, page } = await openAs(
      browser,
      USAGER_AGENDA,
      `/reservations/${SVC_AGENDA_USAGER}`,
      ".agenda-grid, table",
    );
    await dismissFullNotice(page);
    await page.evaluate(() => window.dispatchEvent(new Event("culturesa:onboarding-replay")));
    await page.waitForFunction(() => document.body.innerText.includes("Bienvenue"), {
      timeout: 15000,
    });
    await shot(page, "docs/img/04-fenetre-bienvenue.png", { settle: 800 });
    await ctx.close();
  }

  // ── 05. Agenda usager (Maison des Arts, réservations existantes) ────────────────────
  if (want("agenda-usager")) {
    const { ctx, page } = await openAs(
      browser,
      USAGER_AGENDA,
      `/reservations/${SVC_AGENDA_USAGER}`,
      ".agenda-grid, table",
    );
    await dismissFullNotice(page);
    await shot(page, "docs/img/05-agenda-usager.png", { settle: 800 });
    await ctx.close();
  }

  // ── 06. Agenda admin (docs/img/06-agenda-admin.png) ────────────────────────────────
  if (want("agenda")) {
    const { ctx, page } = await openAs(browser, ADMIN, "/services/svc_001/agenda");
    // Exercice 2025-2026 : semaine de septembre avec réservations (badges + macaron).
    await page.waitForSelector('button[aria-label="Exercice précédent"]');
    await page.click('button[aria-label="Exercice précédent"]');
    await page.waitForSelector(".planning-name-tag", { timeout: 15000 });
    await shot(page, "docs/img/06-agenda-admin.png", { settle: 800 });

    // ── Barre d'options (public/onboarding) : « Mode pointage » coché, puis
    //    « Mode validation » coché — même cadrage (cases + boutons liste d'attente /
    //    Imprimer / Mode création). ──────────────────────────────────────────────────
    const optionsClip = async () => {
      const box = await page.evaluate(() => {
        const first = [...document.querySelectorAll("label")].find((l) =>
          /Mode pointage/.test(l.textContent ?? ""),
        );
        // Bouton à pictogramme : le libellé est dans aria-label (texte vide).
        const last = [...document.querySelectorAll("button")].find((b) =>
          /Mode création/.test(b.getAttribute("aria-label") ?? b.textContent ?? ""),
        );
        if (!first || !last) return null;
        const a = first.getBoundingClientRect();
        const b = last.getBoundingClientRect();
        const top = Math.min(a.top, b.top) - 8;
        const bottom = Math.max(a.bottom, b.bottom) + 8;
        return { x: a.left - 8, y: top, width: b.right - a.left + 16, height: bottom - top };
      });
      if (!box) throw new Error("barre d'options introuvable");
      return box;
    };
    const toggle = async (label) => {
      await page.evaluate((txt) => {
        const l = [...document.querySelectorAll("label")].find((x) =>
          new RegExp(txt).test(x.textContent ?? ""),
        );
        l?.querySelector("input")?.click();
      }, label);
      await sleep(400);
    };
    // Cadrage mesuré AVANT de cocher un mode : en mode pointage / validation, le bouton
    // « Mode création » disparaît (modes exclusifs) et ne peut plus servir de repère.
    const clip = await optionsClip();
    await toggle("Mode pointage");
    await page.screenshot({ path: "public/onboarding/pointage-mode.png", clip });
    console.log("✓ public/onboarding/pointage-mode.png");
    await toggle("Mode pointage");
    await toggle("Mode validation");
    await page.screenshot({ path: "public/onboarding/validation-mode.png", clip });
    console.log("✓ public/onboarding/validation-mode.png");
    produced.push("public/onboarding/pointage-mode.png", "public/onboarding/validation-mode.png");
    await ctx.close();
  }

  // ── 07. Éditions d'un service (index : éditions + panel Liste d'attente) ────────────
  if (want("editions")) {
    const { ctx, page } = await openAs(
      browser,
      ADMIN,
      `/services/${SVC_ADMIN}/editions`,
      "#editions-panel",
    );
    await shot(page, "docs/img/07-editions-liste.png", { fullPage: true });
    await ctx.close();
  }

  // ── 08. Statistiques d'un service ───────────────────────────────────────────────────
  if (want("statistiques")) {
    const { ctx, page } = await openAs(browser, ADMIN, `/services/${SVC_ADMIN}/stats`);
    await shot(page, "docs/img/08-statistiques.png", { settle: 800 });
    await ctx.close();
  }

  // ── 09 / 10 / 11. Paramètres du service : périodes, configuration, échanges ─────────
  if (want("periodes")) {
    const { ctx, page } = await openAs(browser, ADMIN, `/services/${SVC_ADMIN}/periodes`);
    await shot(page, "docs/img/09-parametres-periodes.png");
    await ctx.close();
  }
  if (want("config")) {
    const { ctx, page } = await openAs(browser, ADMIN, `/services/${SVC_ADMIN}/config`);
    await shot(page, "docs/img/10-parametres-configuration.png");
    await ctx.close();
  }
  if (want("echanges-service")) {
    const { ctx, page } = await openAs(browser, ADMIN, `/services/${SVC_ADMIN}/echanges`);
    await shot(page, "docs/img/11-parametres-echanges.png");
    await ctx.close();
  }

  // ── 12. Administration › Configuration (référentiels) ──────────────────────────────
  if (want("configuration")) {
    const { ctx, page } = await openAs(browser, ADMIN, "/configuration");
    await shot(page, "docs/img/12-configuration-referentiels.png");
    await ctx.close();
  }

  // ── 13. Administration › Utilisateurs › Comptes (tableau refondu 2026-09-08) ────────
  if (want("utilisateurs")) {
    const { ctx, page } = await openAs(browser, ADMIN, "/users/comptes", ".acct-table tbody tr");
    // 2e ligne survolée : compte non confirmé → 4 pictogrammes visibles, dont l'avion.
    const rows = await page.$$(".acct-table tbody tr");
    if (rows[1]) await rows[1].hover();
    await shot(page, "docs/img/13-utilisateurs.png", { settle: 600 });
    await ctx.close();
  }

  // ── 14. Administration › Messagerie ─────────────────────────────────────────────────
  if (want("messagerie")) {
    const { ctx, page } = await openAs(browser, ADMIN, "/messagerie");
    // Configuration SMTP réelle de la collectivité (adresses, serveur, identifiant) :
    // les valeurs saisies sont floutées (Dom 2026-09-08), les libellés restent lisibles.
    await page.evaluate(() => {
      for (const el of document.querySelectorAll(
        ".panel input[type=text], .panel input[type=email], .panel input[type=password]",
      )) {
        if (el.value) el.style.filter = "blur(5px)";
      }
    });
    await shot(page, "docs/img/14-messagerie.png");
    await ctx.close();
  }

  // ── 15. Administration › RGPD ───────────────────────────────────────────────────────
  if (want("rgpd")) {
    const { ctx, page } = await openAs(browser, ADMIN, "/rgpd");
    await shot(page, "docs/img/15-rgpd.png");
    await ctx.close();
  }
} finally {
  await browser.close();
}
for (const f of produced) {
  const { size } = fs.statSync(f);
  console.log(`  ${f} — ${Math.round(size / 1024)} Ko`);
}
