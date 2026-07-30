import { type NextRequest, NextResponse } from "next/server";
import { buildCsp, generateNonce } from "@/lib/csp";

/**
 * Middleware — deux responsabilités sans rapport entre elles, réunies ici parce
 * que Next.js n'admet qu'un seul middleware par application.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  1. CSP par nonce (constat S2)
 * ─────────────────────────────────────────────────────────────────────────────
 * La politique était posée en en-tête statique dans `next.config.ts`, ce qui
 * imposait `'unsafe-inline'` : un en-tête figé ne peut pas porter de valeur
 * aléatoire par réponse. Elle est donc calculée ICI, seul endroit qui voie
 * chaque requête.
 *
 * Le nonce est transmis DEUX FOIS sur la requête, et les deux sont nécessaires :
 *  - `x-nonce` → lu par le layout racine, qui le pose sur le script anti-FOUC ;
 *  - `Content-Security-Policy` → Next.js y lit lui-même le nonce et l'appose sur
 *    les balises de son propre runtime. Sans cet en-tête DE REQUÊTE, les scripts
 *    de Next partent sans nonce et la page reste blanche.
 * Puis une troisième fois sur la RÉPONSE : c'est l'en-tête réellement appliqué
 * par le navigateur.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  2. Durcissement du rate-limit d'authentification (anti-bruteforce)
 * ─────────────────────────────────────────────────────────────────────────────
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
  const headers = new Headers(request.headers);

  // ── 1. Normalisation x-forwarded-for, sur les seules routes d'authentification ──
  // Restreinte à /api/auth : ailleurs, écraser cet en-tête priverait les journaux
  // et d'éventuels contrôles en aval de la chaîne complète des relais.
  if (request.nextUrl.pathname.startsWith("/api/auth")) {
    const fwd = request.headers.get("x-forwarded-for");
    const trusted = fwd?.split(",").at(-1)?.trim();
    if (trusted && trusted !== fwd) headers.set("x-forwarded-for", trusted);
  }

  // ── 2. CSP par nonce ──
  const nonce = generateNonce();
  const csp = buildCsp(nonce, process.env.NODE_ENV !== "production");
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Tout ce qui peut rendre un document, plus les routes d'authentification.
    //
    // EXCLUS : les fichiers servis tels quels (`_next/static`, `_next/image`, et
    // tout chemin comportant une extension). Un nonce y serait sans objet — ces
    // réponses ne sont pas des documents — et le calculer à chaque requête
    // grèverait des ressources servies en cache immuable.
    //
    // Ces chemins conservent les autres en-têtes de sécurité posés par
    // `next.config.ts`, dont `X-Content-Type-Options: nosniff` : c'est LUI, et non
    // la CSP, qui empêche qu'une réponse non-HTML soit interprétée comme un
    // document. L'exclusion ne laisse donc pas de trou.
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.[^/]+$).*)",
    "/api/auth/:path*",
  ],
};
