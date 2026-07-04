import puppeteer from "puppeteer";
import { prisma } from "@/server/db";
import { requireServiceManager } from "@/server/guards";

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
};

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireServiceManager(id);

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
    // --no-sandbox : requis en conteneur / root (Docker). PUPPETEER_EXECUTABLE_PATH permet
    // d'utiliser le Chromium système au lieu de celui bundlé.
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });
  try {
    const page = await browser.newPage();
    if (cookie) await page.setExtraHTTPHeaders({ cookie });
    await page.goto(target.toString(), { waitUntil: "networkidle0", timeout: 45000 });
    await page.emulateMediaType("print");

    const headerFootStyle =
      "font-family:'Instrument Sans',Arial,sans-serif;width:100%;box-sizing:border-box;padding:0 8mm;color:#444;";
    const pdf = await page.pdf({
      landscape: true,
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
}
