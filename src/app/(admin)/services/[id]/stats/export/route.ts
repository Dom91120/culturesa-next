import { csvResponse } from "@/lib/csv";
import { prisma } from "@/server/db";
import { requireServiceManager } from "@/server/guards";
import { getServiceStats } from "@/server/services/stats";
import { parseStatsDate, parseStatsType } from "../params";

/** Export CSV des statistiques d'un service (mêmes filtres que l'écran). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireServiceManager(id);

  const sp = new URL(req.url).searchParams;
  const type = parseStatsType(sp.get("type"));
  const dateFrom = parseStatsDate(sp.get("from"));
  const dateTo = parseStatsDate(sp.get("to"));

  const [service, stats] = await Promise.all([
    prisma.service.findUnique({ where: { id }, select: { label: true } }),
    getServiceStats(id, { type, dateFrom, dateTo }),
  ]);
  if (!service) return new Response("Service introuvable", { status: 404 });

  const lines: string[][] = [];
  lines.push(["Statistiques", service.label]);
  lines.push(["Filtre", `type=${type}`, `du=${dateFrom ?? ""}`, `au=${dateTo ?? ""}`]);
  lines.push([]);
  lines.push(["Indicateur", "Valeur"]);
  lines.push(["Séances", String(stats.total)]);
  lines.push(["Inscrits distincts", String(stats.distinctUsers)]);
  lines.push(["Demandes en attente", String(stats.pending)]);
  lines.push(["Enfants distincts (1 fois par inscrit)", String(stats.enfants)]);
  lines.push(["Fréquentation enfants (cumul des séances)", String(stats.enfantsCumul)]);
  lines.push(["Accompagnants (effectif estimé, 1 fois par inscrit)", String(stats.accompagnants)]);
  lines.push([]);
  lines.push(["Prévu / Réalisé (séances passées)", "Valeur"]);
  lines.push(["Prévu", String(stats.prevu)]);
  lines.push(["Présents", String(stats.presents)]);
  lines.push(["Absents", String(stats.absents)]);
  lines.push(["Non pointés", String(stats.nonPointes)]);
  lines.push([
    "Taux de présence (%)",
    stats.tauxPresence != null ? String(stats.tauxPresence) : "",
  ]);
  lines.push(["Taux d'absence (%)", stats.tauxAbsence != null ? String(stats.tauxAbsence) : ""]);
  lines.push([
    "Taux de réalisation (%)",
    stats.tauxRealisation != null ? String(stats.tauxRealisation) : "",
  ]);

  const section = (title: string, valLabel: string, rows: { label: string; value: number }[]) => {
    lines.push([]);
    lines.push([title, valLabel]);
    for (const r of rows) lines.push([r.label, String(r.value)]);
  };
  section("Par jour", "Réservations", stats.byDay);
  section("Par mois", "Réservations", stats.byMonth);
  section("Top structures", "Réservations", stats.topStructures);
  section("Top niveaux", "Réservations", stats.topNiveaux);
  section("Par thème", "Réservations", stats.topThemes);
  section("Remplissage moyen par mois (%)", "%", stats.fillByMonth);
  section("Remplissage moyen par structure (%)", "%", stats.fillByStructure);
  // Deux lectures par exercice : Total = cumul des séances, Distincts = 1 fois par inscrit.
  lines.push([]);
  lines.push(["Effectifs (enfants) par exercice", "Total", "Distincts"]);
  for (const r of stats.effectifsByExercice) {
    lines.push([r.label, String(r.total), String(r.distincts)]);
  }

  return csvResponse(lines, `stats-${id}.csv`);
}
