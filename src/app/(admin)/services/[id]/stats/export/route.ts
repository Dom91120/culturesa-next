import { csvResponse } from "@/lib/csv";
import { prisma } from "@/server/db";
import { reponseApi, requireServiceAccessApi } from "@/server/guards-api";
import { getServiceStats } from "@/server/services/stats";
import { parseStatsDate, parseStatsType } from "../params";

/** Export CSV des statistiques d'un service (mêmes filtres que l'écran). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return reponseApi(async () => {
    await requireServiceAccessApi(id, "/services/[id]/stats/export");

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
    lines.push([
      "Accompagnants (effectif estimé, 1 fois par inscrit)",
      String(stats.accompagnants),
    ]);
    lines.push([
      "Remplissage moyen, toutes séances proposées (%)",
      stats.avgFill != null ? String(stats.avgFill) : "",
    ]);
    lines.push([
      "Remplissage moyen, séances réservées (%)",
      stats.avgFillReserves != null ? String(stats.avgFillReserves) : "",
    ]);
    lines.push([]);
    lines.push(["Prévu / Réalisé (séances passées)", "Valeur"]);
    lines.push(["Prévu", String(stats.prevu)]);
    lines.push(["Présents", String(stats.presents)]);
    lines.push(["Absents", String(stats.absents)]);
    lines.push(["Absents dont prévenus à l'avance", String(stats.absentsPrevenus)]);
    lines.push(["Non pointés", String(stats.nonPointes)]);
    lines.push(["Absences prévenues (toutes séances)", String(stats.absencesPrevenues)]);
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
    // Créneaux (offre) : toujours exporté — l'écran ne l'affiche que si créneaux ≠ séances.
    const sl = stats.slots;
    lines.push([]);
    lines.push(["Créneaux (offre)", "Valeur"]);
    lines.push(["Créneaux proposés", String(sl.creneaux)]);
    lines.push(["Créneaux réservés (au moins une séance)", String(sl.creneauxReserves)]);
    lines.push(["Créneaux libres", String(sl.creneauxLibres)]);
    lines.push(["Créneaux libres déjà passés", String(sl.creneauxLibresPasses)]);
    lines.push([
      "Taux de créneaux réservés (%)",
      sl.tauxOccupation != null ? String(sl.tauxOccupation) : "",
    ]);
    lines.push([]);
    lines.push(["Créneaux par mois", "Proposés", "Réservés", "Libres", "Séances"]);
    for (const r of sl.byMonth) {
      lines.push([
        r.label,
        String(r.creneaux),
        String(r.reserves),
        String(r.creneaux - r.reserves),
        String(r.seances),
      ]);
    }
    section("Remplissage moyen par mois (%)", "%", stats.fillByMonth);
    // Deux lectures par exercice : Total = cumul des séances, Distincts = 1 fois par inscrit.
    lines.push([]);
    lines.push(["Effectifs (enfants) par exercice", "Total", "Distincts"]);
    for (const r of stats.effectifsByExercice) {
      lines.push([r.label, String(r.total), String(r.distincts)]);
    }

    // Liste d'attente (filtre de dates sur la date d'inscription).
    if (stats.waitlist) {
      const w = stats.waitlist;
      lines.push([]);
      lines.push(["Liste d'attente", "Valeur"]);
      lines.push(["En attente aujourd'hui", String(w.waitingNow)]);
      lines.push([
        "Ancienneté moyenne en attente (jours)",
        w.waitingAvgDays != null ? String(w.waitingAvgDays) : "",
      ]);
      lines.push(["Placés depuis la liste", String(w.placed)]);
      lines.push([
        "Délai moyen avant une place (jours)",
        w.placedAvgDays != null ? String(w.placedAvgDays) : "",
      ]);
      lines.push(["Sans place (périodes échues, retraits)", String(w.noPlace)]);
      section("Issue des inscriptions", "Inscriptions", w.outcomes);
      section("Sans place : détail", "Inscriptions", w.noPlaceDetail);
      section("Sans place par catégorie", "Inscriptions", w.noPlaceByDemandeur);
      section("Sans place par structure", "Inscriptions", w.noPlaceByStructure);
      section("Inscriptions en liste d'attente par mois", "Inscriptions", w.byMonth);
    }

    return csvResponse(lines, `stats-${id}.csv`);
  });
}
