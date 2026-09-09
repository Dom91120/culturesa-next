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

/**
 * Valeur de détail rendue lisible : un objet imbriqué (affiliation = catégorie +
 * structure) devient « Catégorie · Structure », un tableau son effectif, le vide
 * un tiret. Avant : `String(obj)` donnait « [object Object] » dans le journal.
 */
function scalar(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return String(v.length);
  if (typeof v === "object") {
    const parts = Object.values(v as Record<string, unknown>)
      .filter((x) => x !== null && x !== undefined && x !== "")
      .map(String);
    return parts.length ? parts.join(" · ") : "—";
  }
  return String(v);
}

/** Résumé court des `details` JSON (tooltip, CSV). */
function summarize(details: unknown): string | null {
  if (!details || typeof details !== "object") return null;
  const parts = Object.entries(details as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k} : ${scalar(v)}`);
  return parts.length ? parts.join(", ") : null;
}

/** Couple « avant → après » quand les détails en portent un (rôle, affiliation). */
function change(details: unknown): { avant: string; apres: string } | null {
  if (!details || typeof details !== "object") return null;
  const d = details as Record<string, unknown>;
  if (!("avant" in d) || !("apres" in d)) return null;
  return { avant: scalar(d.avant), apres: scalar(d.apres) };
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

  // Nom de l'acteur tant que son compte existe (avatar à initiales, libellé) ;
  // l'adresse dénormalisée reste la référence si le compte a disparu.
  const actorIds = [...new Set(rows.map((r) => r.actorId).filter((id): id is string => !!id))];
  const actors = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, prenom: true, nom: true },
      })
    : [];
  const byId = new Map(actors.map((a) => [a.id, a]));

  const entries: JournalEntry[] = rows.map((r) => {
    const a = r.actorId ? byId.get(r.actorId) : undefined;
    return {
      id: r.id,
      at: r.at.toISOString(),
      dateLabel: dtFmt.format(r.at),
      action: r.action,
      actorLabel: r.actorLabel,
      actorRole: r.actorRole,
      actorPrenom: a?.prenom ?? "",
      actorNom: a?.nom ?? "",
      target: r.target,
      details: summarize(r.details),
      change: change(r.details),
      ip: r.ip,
    };
  });

  return (
    <JournalTable
      entries={entries}
      generatedAt={new Date().toISOString()}
      maxEntries={MAX_ENTRIES}
    />
  );
}
