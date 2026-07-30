import { NextResponse } from "next/server";
import { createCaptcha } from "@/server/captcha";
import { rateLimit } from "@/server/rate-limit";

// Génération côté Node (svg-captcha + node:crypto) et jamais mise en cache : chaque
// requête doit produire un nouveau défi.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Bride la génération (svg-captcha + crypto) pour éviter l'abus par appels en boucle.
  // Clé = IP transmise par le reverse-proxy externe. On prend l'entrée la plus À DROITE
  // de x-forwarded-for : c'est celle AJOUTÉE par le proxy de confiance (l'IP réelle du
  // client vue par lui) — la plus à gauche est librement forgeable par le client et
  // permettait de contourner le quota (audit 2026-07-17). À défaut, seau global partagé.
  const fwd = request.headers.get("x-forwarded-for");
  const ip =
    fwd?.split(",").at(-1)?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
  if (!(await rateLimit(`captcha:${ip}`, 30, 60_000))) {
    return NextResponse.json({ error: "Trop de requêtes." }, { status: 429 });
  }
  const { svg, token } = createCaptcha();
  return NextResponse.json(
    { svg, token },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
  );
}
