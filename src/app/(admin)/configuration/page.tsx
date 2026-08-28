import { getConfigMany } from "@/server/config";
import { prisma } from "@/server/db";
import { requireRole } from "@/server/guards";
import { countSchoolHolidays } from "@/server/services/holidays";
import { listNiveaux } from "@/server/services/niveaux";
import { listServicesForCurrentAdmin } from "@/server/services/services";
import { listStructures } from "@/server/services/structures";
import { ConfigurationPanel } from "./configuration-panel";
import { DemandeursReferentiel } from "./demandeurs-referentiel";
import { NiveauxReferentiel } from "./niveaux-referentiel";
import { ServicesReferentiel } from "./services-referentiel";
import { StructuresReferentiel } from "./structures-referentiel";

export default async function ConfigurationPage() {
  // Administration réservée aux administrateurs (les gestionnaires n'y ont pas accès).
  await requireRole("administrateur");
  const cfg = await getConfigMany([
    "school.zone",
    "reservations.autoRefreshSeconds",
    "agenda.autoRefreshSeconds",
    "debug.mode",
    "app.url",
  ]);
  const zone = cfg["school.zone"] || "A";
  const parseSeconds = (v: string, fallback: number) => {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : fallback;
  };
  const refreshSeconds = parseSeconds(cfg["reservations.autoRefreshSeconds"], 60);
  const agendaRefreshSeconds = parseSeconds(cfg["agenda.autoRefreshSeconds"], 60);
  const debugMode = cfg["debug.mode"] === "1";
  const appUrl = cfg["app.url"] || "";

  // Référentiels affichés en modale (mêmes données que les anciens onglets).
  const [holidayCount, demandeurs, servicesRaw, structuresRaw, niveauxRaw] = await Promise.all([
    countSchoolHolidays(zone),
    prisma.demandeur.findMany({
      orderBy: { label: "asc" },
      select: { id: true, label: true, openOnSchoolHolidays: true, structureLibre: true },
    }),
    listServicesForCurrentAdmin(),
    listStructures(),
    listNiveaux(),
  ]);
  const demandeurOptions = demandeurs.map((d) => ({ id: d.id, label: d.label }));
  const services = servicesRaw.map((s) => ({ id: s.id, label: s.label, icon: s.icon }));
  const structures = structuresRaw.map((s) => ({
    id: s.id,
    label: s.label,
    demandeurId: s.demandeurId,
    users: s._count.users,
  }));
  const niveaux = niveauxRaw.map((n) => ({
    id: n.id,
    label: n.label,
    demandeurId: n.demandeurId,
    position: n.position,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <ConfigurationPanel
        zone={zone}
        holidayCount={holidayCount}
        refreshSeconds={refreshSeconds}
        agendaRefreshSeconds={agendaRefreshSeconds}
        debugMode={debugMode}
        appUrl={appUrl}
      />

      <div className="panel">
        <div className="panel-title">
          <span className="dot" />
          Référentiels
        </div>
        <p style={{ fontSize: ".85rem", color: "var(--muted)", marginBottom: "1rem" }}>
          Paramètres généraux et référentiels.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: ".5rem", maxWidth: 480 }}>
          <ServicesReferentiel services={services} />
          <DemandeursReferentiel demandeurs={demandeurs} />
          <StructuresReferentiel structures={structures} demandeurs={demandeurOptions} />
          <NiveauxReferentiel niveaux={niveaux} demandeurs={demandeurOptions} />
        </div>
      </div>
    </div>
  );
}
