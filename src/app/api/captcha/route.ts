import { NextResponse } from "next/server";
import { createCaptcha } from "@/server/captcha";
import { rateLimit } from "@/server/rate-limit";

// Génération côté Node (svg-captcha + node:crypto) et jamais mise en cache : chaque
// requête doit produire un nouveau défi.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  // Bride la génération (svg-captcha + crypto) pour éviter l'abus par appels en boucle.
  // Clé = IP transmise par le reverse-proxy (Caddy) ; à défaut, un seau global partagé.
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown";
  if (!rateLimit(`captcha:${ip}`, 30, 60_000)) {
    return NextResponse.json({ error: "Trop de requêtes." }, { status: 429 });
  }
  const { svg, token } = createCaptcha();
  return NextResponse.json(
    { svg, token },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
  );
}
