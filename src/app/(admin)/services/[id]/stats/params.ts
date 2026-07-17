import { DATE_RE } from "@/schemas/slot";
import type { StatsType } from "@/server/services/stats";

/**
 * Parseurs des filtres de statistiques — CONTRAT PARTAGÉ écran ↔ export CSV :
 * l'export doit accepter exactement ce que l'écran émet (cf. exportHref). Avant
 * l'audit 2026-07-17, les deux copies verbatim (page.tsx / export/route.ts)
 * pouvaient diverger silencieusement et casser la parité des filtres.
 */
export function parseStatsType(v: string | null | undefined): StatsType {
  return v === "rec" || v === "uniq" ? v : "all";
}

export function parseStatsDate(v: string | null | undefined): string | null {
  return v && DATE_RE.test(v) ? v : null;
}
