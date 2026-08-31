import puppeteer from "puppeteer";
import { escapeHtml } from "@/lib/email-theme";
import { prisma } from "@/server/db";
import { reponseApi, requireServiceManagerApi } from "@/server/guards-api";
import { argsChromium } from "@/server/pdf-browser";

// PDF serveur des éditions (Puppeteer). On réutilise la page d'édition existante en média
// « print » (tout le CSS @media print s'applique : liste complète, paysage, en-têtes de
// tableau répétés) et Puppeteer ajoute l'EN-TÊTE COURANT (titre) et le PIED COURANT
// (« Page X / N ») — ce que le navigateur seul ne sait pas faire.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const KIND_TITLES: Record<string, string> = {
  liste: "Liste des réservations",
  planning: "Planning",
  pointages: "Pointages",
  inscrits: "Liste des inscrits",
  creneaux: "Liste des créneaux ouverts",
};

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return reponseApi(async () => {
    await requireServiceManagerApi(id, "/services/[id]/editions/pdf");

    const reqUrl = new URL(req.url);
    const kind = reqUrl.searchParams.get("kind") ?? "liste";
    if (!(kind in KIND_TITLES)) return new Response("Édition inconnue", { status: 400 });

    const service = await prisma.service.findUnique({ where: { id }, select: { label: true } });
    if (!service) return new Response("Service introuvable", { status: 404 });
    const title = `${KIND_TITLES[kind]} — ${service.label}`;

    // URL cible = la page d'édition (même origine), avec les paramètres transmis (mode,
    // exercice, ruptures, tri…) sauf `kind`. Origine surchargeable pour un déploiement où le
    // conteneur ne joint pas l'URL publique.
    const base = process.env.PUPPETEER_BASE_URL ?? reqUrl.origin;
    const target = new URL(`/services/${id}/editions/${kind}`, base);
    reqUrl.searchParams.forEach((v, k) => {
      if (k !== "kind") target.searchParams.set(k, v);
    });

    const cookie = req.headers.get("cookie") ?? "";

    const browser = await puppeteer.launch({
      headless: true,
      // Drapeaux et arbitrage du bac à sable : server/pdf-browser.ts (constat D3), qui
      // documente les mesures ayant conduit à écarter CAP_SYS_ADMIN.
      // PUPPETEER_EXECUTABLE_PATH permet d'utiliser le Chromium système au lieu du bundlé.
      args: argsChromium(),
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    });
    try {
      const page = await browser.newPage();
      // Cookie de session rejoué UNIQUEMENT vers l'origine cible (interception) :
      // setExtraHTTPHeaders l'attachait à TOUTES les requêtes émises par la page — une
      // sous-ressource externe ajoutée un jour aux éditions aurait exfiltré la session
      // du gestionnaire (audit 2026-07-17). L'en-tête brut est conservé (compatible
      // cookies Secure rejoués vers une cible interne http via PUPPETEER_BASE_URL).
      if (cookie) {
        await page.setRequestInterception(true);
        page.on("request", (r) => {
          const sameOrigin = r.url().startsWith(`${target.origin}/`) || r.url() === target.origin;
          r.continue(sameOrigin ? { headers: { ...r.headers(), cookie } } : undefined);
        });
      }
      await page.goto(target.toString(), { waitUntil: "networkidle0", timeout: 45000 });
      await page.emulateMediaType("print");

      const headerFootStyle =
        "font-family:'Instrument Sans',Arial,sans-serif;width:100%;box-sizing:border-box;padding:0 8mm;color:#444;";
      const pdf = await page.pdf({
        // Tableaux larges (liste, planning, pointages) en paysage ; la liste des
        // inscrits (5 colonnes de contact) et celle des créneaux ouverts (6 colonnes
        // courtes) tiennent en portrait.
        landscape: !["inscrits", "creneaux"].includes(kind),
        printBackground: true,
        preferCSSPageSize: false,
        margin: { top: "16mm", bottom: "14mm", left: "8mm", right: "8mm" },
        displayHeaderFooter: true,
        headerTemplate: `<div style="${headerFootStyle}font-size:9px;text-align:center;">${escapeHtml(title)}</div>`,
        footerTemplate: `<div style="${headerFootStyle}font-size:8px;text-align:right;color:#666;">Page <span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
      });

      const safe = service.label.replace(/[^a-zA-Z0-9-_]+/g, "_").slice(0, 40) || "service";
      return new Response(pdf as unknown as BodyInit, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${kind}_${safe}.pdf"`,
          "Cache-Control": "no-store",
        },
      });
    } finally {
      await browser.close();
    }
  });
}
