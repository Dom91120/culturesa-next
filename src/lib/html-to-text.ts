/**
 * Version texte brut dérivée du HTML rendu d'un e-mail (délivrabilité + clients sans
 * HTML). Le résultat part en `text/plain` : ce n'est pas une barrière de sécurité (le
 * HTML est déjà assaini par sanitize-html), mais la suppression des balises est menée
 * JUSQU'À STABILITÉ — une seule passe laissait « <script> » à partir de
 * « <scr<script>ipt> » (CodeQL js/incomplete-multi-character-sanitization).
 */
export function htmlToText(html: string): string {
  let out = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li>/gi, "- ")
    .replace(/<\/p>/gi, "\n\n");
  let previous: string;
  do {
    previous = out;
    out = out.replace(/<[^>]+>/g, "");
  } while (out !== previous);
  return out
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
