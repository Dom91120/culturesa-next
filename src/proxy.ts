import { type NextRequest, NextResponse } from "next/server";

/**
 * Durcissement du rate-limit d'authentification (anti-bruteforce).
 *
 * Better Auth cle son rate-limit sur l'IP extraite de `x-forwarded-for`, mais il
 * prend l'entree la plus a GAUCHE (`value.split(",")[0]`), librement forgeable par
 * le client : en variant cet en-tete a chaque requete, un attaquant obtenait un
 * seau de quota neuf a chaque essai (bruteforce de mot de passe non bride).
 *
 * On normalise donc ici, AVANT que Better Auth ne la lise, la valeur transmise aux
 * routes /api/auth/* : seule l'entree la plus a DROITE est conservee — c'est celle
 * AJOUTEE par le reverse-proxy de confiance (l'IP reelle du client vue par lui),
 * les entrees a gauche etant fournies par le client. Meme contre-mesure que le
 * captcha (src/app/api/captcha/route.ts, audit 2026-07-17).
 *
 * Sans en-tete `x-forwarded-for` (acces direct sans proxy, dev), on ne touche a
 * rien : Better Auth applique alors son propre repli (127.0.0.1 en dev).
 */
export default function proxy(request: NextRequest) {
  const fwd = request.headers.get("x-forwarded-for");
  const trusted = fwd?.split(",").at(-1)?.trim();
  if (!trusted || trusted === fwd) return NextResponse.next();

  const headers = new Headers(request.headers);
  headers.set("x-forwarded-for", trusted);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: "/api/auth/:path*",
};
