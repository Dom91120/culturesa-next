import type { ReactNode } from "react";
import { ArrowDownGlyph, ArrowsSortGlyph, ArrowUpGlyph } from "@/components/ui-glyphs";

/** En-tête de colonne triable : lien, flèche verte sur la colonne active, double flèche estompée sinon. */
export function SortTh({
  href,
  active,
  dir,
  width,
  align = "left",
  children,
}: {
  href: string;
  active: boolean;
  dir: "asc" | "desc";
  width?: number | string;
  align?: "left" | "center" | "right";
  children: ReactNode;
}) {
  return (
    <th className={active ? "is-on" : undefined} style={{ width, textAlign: align }}>
      <a href={href} className="ed-sort" title="Trier par cette colonne">
        {children}
        {active ? (
          dir === "asc" ? (
            <ArrowUpGlyph size={11} />
          ) : (
            <ArrowDownGlyph size={11} />
          )
        ) : (
          <ArrowsSortGlyph size={11} />
        )}
      </a>
    </th>
  );
}
