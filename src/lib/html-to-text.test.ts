import { describe, expect, it } from "vitest";
import { htmlToText } from "./html-to-text";

describe("htmlToText", () => {
  it("paragraphes, retours à la ligne et listes", () => {
    expect(
      htmlToText("<p>Bonjour,</p><p>Ligne 1<br/>Ligne 2</p><ul><li>un</li><li>deux</li></ul>"),
    ).toBe("Bonjour,\n\nLigne 1\nLigne 2\n\n- un\n- deux");
  });
  it("entités décodées APRÈS la suppression des balises", () => {
    expect(htmlToText("<p>5 &lt; 7 &amp; &quot;ok&quot; &#39;oui&#39;</p>")).toBe(
      "5 < 7 & \"ok\" 'oui'",
    );
  });
  it("balises imbriquées pour tromper un filtre : AUCUNE balise ne subsiste, le texte reste", () => {
    for (const piege of [
      "<scr<script>ipt>alert(1)</scr</script>ipt>",
      "a<<b>i>c",
      "<<a>script>x</script>",
    ]) {
      const out = htmlToText(piege);
      expect(out, piege).not.toMatch(/<[^>]+>/);
    }
    expect(htmlToText("<scr<script>ipt>alert(1)</scr</script>ipt>")).toContain("alert(1)");
  });
  it("plus de deux sauts de ligne consécutifs ramenés à deux", () => {
    expect(htmlToText("<p>a</p><p></p><p></p><p>b</p>")).toBe("a\n\nb");
  });
});
