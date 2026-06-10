import { createCaptcha } from "@/server/captcha";
import { NextResponse } from "next/server";

// Génération côté Node (svg-captcha + node:crypto) et jamais mise en cache : chaque
// requête doit produire un nouveau défi.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const { svg, token } = createCaptcha();
  return NextResponse.json(
    { svg, token },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
  );
}
