/**
 * Construction de la Content-Security-Policy (constat S2).
 *
 * ── Pourquoi un nonce ──
 * La politique portait `script-src 'self' 'unsafe-inline'`. `'unsafe-inline'`
 * autorise TOUT script inline, donc exactement ce qu'injecte une XSS : la CSP
 * conservait sa valeur contre les cadres, les objets et l'exfiltration, mais
 * n'opposait plus rien à sa menace principale. Un nonce aléatoire par réponse
 * rend l'inline autorisé UNIQUEMENT s'il porte la valeur du jour — qu'un
 * attaquant ne peut pas deviner puisqu'elle change à chaque requête.
 *
 * ── Pourquoi 'strict-dynamic' ──
 * Sans lui, chaque script chargé par un script noncé devrait à son tour figurer
 * dans une liste d'URL. Next.js découpe son runtime en morceaux dont les noms
 * changent à chaque build : maintenir cette liste serait intenable, et une liste
 * intenable finit remplacée par `'unsafe-inline'`. `'strict-dynamic'` transfère
 * la confiance : ce qu'un script de confiance charge est de confiance.
 *
 * ── Pourquoi 'self' est conservé malgré 'strict-dynamic' ──
 * Les navigateurs qui comprennent `'strict-dynamic'` IGNORENT `'self'` : il n'a
 * donc aucun effet affaiblissant sur eux. Il sert de repli pour un navigateur
 * qui comprendrait les nonces sans comprendre `'strict-dynamic'` — lequel
 * appliquerait alors « nonce + même origine », ce qui reste solide. En revanche
 * `'unsafe-inline'`, que la recette classique ajoute comme repli pour les
 * navigateurs plus anciens encore, n'est PAS repris : c'est précisément ce que
 * ce constat vise à retirer, et le laisser rendrait l'en-tête indistinguable de
 * celui d'avant pour qui le relit.
 *
 * ── Ce que ceci ne couvre pas ──
 * `style-src` garde `'unsafe-inline'` : l'application pose massivement des
 * styles par attribut `style={{…}}`, que seul `'unsafe-inline'` autorise. Un
 * style injecté permet du défacement et de l'exfiltration par sélecteur, pas de
 * l'exécution de code. Le retirer supposerait de convertir tous ces attributs —
 * chantier sans rapport avec la sécurité, à ne pas mêler à celui-ci.
 */

/** Longueur du nonce : 128 bits, seuil recommandé par la spécification CSP. */
const NONCE_BYTES = 16;

/** Nonce à usage unique. `crypto` global : disponible en runtime Edge comme en Node. */
export function generateNonce(): string {
  const bytes = new Uint8Array(NONCE_BYTES);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export function buildCsp(nonce: string, dev = false): string {
  return [
    "default-src 'self'",
    // 'unsafe-eval' : requis par le rechargement à chaud de Turbopack, en DEV SEUL.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}
