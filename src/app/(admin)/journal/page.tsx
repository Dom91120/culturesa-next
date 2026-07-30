import { DATETIME_FMT_FR as dtFmt } from "@/lib/format";
import { prisma } from "@/server/db";
import { requireRole } from "@/server/guards";
import { type JournalEntry, JournalTable } from "./journal-table";

export const dynamic = "force-dynamic";

/**
 * Journal des actions privilégiées (constat BAC4, audit 2026-07-29).
 *
 * Réservé aux administrateurs : il nomme qui a fait quoi, et donne donc une
 * lecture de l'activité des gestionnaires qui n'a pas à circuler plus largement.
 *
 * Distinct de l'onglet RGPD, qui reste le registre à finalité juridique (exports
 * et anonymisations, art. 15 et 17). Ici, ce sont les actes d'exploitation.
 */
const MAX_ENTRIES = 2000;

/** Résumé court des `details` JSON, lisible dans une cellule de tableau. */
function summarize(details: unknown): string | null {
  if (!details || typeof details !== "object") return null;
  const parts = Object.entries(details as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k} : ${Array.isArray(v) ? v.length : String(v)}`);
  return parts.length ? parts.join(", ") : null;
}

export default async function JournalPage() {
  await requireRole("administrateur");

  // Plafonné : le journal est conservé deux ans, tout charger finirait par peser.
  // La recherche et l'export portent sur ce qui est chargé — suffisant pour une
  // analyse d'incident, qui regarde le passé récent.
  const rows = await prisma.auditLog.findMany({
    orderBy: { at: "desc" },
    take: MAX_ENTRIES,
  });

  const entries: JournalEntry[] = rows.map((r) => ({
    id: r.id,
    dateLabel: dtFmt.format(r.at),
    action: r.action,
    actorLabel: r.actorLabel,
    actorRole: r.actorRole,
    target: r.target,
    details: summarize(r.details),
    ip: r.ip,
  }));

  return (
    <>
      <JournalTable entries={entries} />
      <p
        style={{
          fontSize: ".72rem",
          color: "var(--muted)",
          marginTop: ".75rem",
          lineHeight: 1.6,
        }}
      >
        Les {MAX_ENTRIES} entrées les plus récentes sont affichées. Le journal est conservé deux
        ans, puis purgé par la tâche de rétention. Les exports et anonymisations RGPD figurent dans
        l&apos;onglet <strong>RGPD</strong>, qui tient le registre des droits des personnes.
      </p>
    </>
  );
}
