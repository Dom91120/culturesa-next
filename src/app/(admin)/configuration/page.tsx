import { DatabaseGlyph } from "@/components/ui-glyphs";
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

// Page Configuration — refonte Dom 2026-09-09 : réglages en lignes (pictogramme, libellé,
// description, contrôle à droite), référentiels en tuiles avec effectif et signalement.
export default async function ConfigurationPage() {
  // Administration réservée aux administrateurs (les gestionnaires n'y ont pas accès).
  await requireRole("administrateur");
  const cfg = await getConfigMany([
    "school.zone",
    "school.holidaysImportedAt",
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
  const [holidayCount, demandeurs, servicesRaw, structuresRaw, niveauxRaw, managerCounts] =
    await Promise.all([
      countSchoolHolidays(zone),
      prisma.demandeur.findMany({
        orderBy: { label: "asc" },
        select: { id: true, label: true, openOnSchoolHolidays: true, structureLibre: true },
      }),
      listServicesForCurrentAdmin(),
      listStructures(),
      listNiveaux(),
      // Comptes gestionnaire par service : sans e-mail de contact, ce sont eux qui
      // reçoivent les e-mails du service (colonne « Gestionnaires » de la modale).
      prisma.serviceManager.groupBy({ by: ["serviceId"], _count: { _all: true } }),
    ]);
  const managersByService = new Map(managerCounts.map((m) => [m.serviceId, m._count._all]));
  const demandeurOptions = demandeurs.map((d) => ({ id: d.id, label: d.label }));
  const services = servicesRaw.map((s) => ({
    id: s.id,
    label: s.label,
    icon: s.icon,
    contactEmail: s.contactEmail,
    managers: managersByService.get(s.id) ?? 0,
  }));
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
        holidaysImportedAt={cfg["school.holidaysImportedAt"] || null}
        refreshSeconds={refreshSeconds}
        agendaRefreshSeconds={agendaRefreshSeconds}
        debugMode={debugMode}
        appUrl={appUrl}
      />

      <div className="panel">
        <div className="panel-title" style={{ marginBottom: ".75rem" }}>
          <span style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
            <span className="rg-ico is-ok">
              <DatabaseGlyph size={16} />
            </span>
            Référentiels
          </span>
        </div>
        <div className="cf-tiles">
          <ServicesReferentiel services={services} />
          <DemandeursReferentiel demandeurs={demandeurs} />
          <StructuresReferentiel structures={structures} demandeurs={demandeurOptions} />
          <NiveauxReferentiel niveaux={niveaux} demandeurs={demandeurOptions} />
        </div>
        <div className="rg-foot">
          <span style={{ lineHeight: 1.45 }}>
            Une tuile ouvre l&apos;éditeur du référentiel. La ligne sous le titre signale ce qui
            mérite un coup d&apos;œil : un service sans e-mail de contact reçoit les e-mails du
            service sur les comptes de ses gestionnaires ; un demandeur ouvert pendant les vacances
            autorise ses usagers à réserver ces jours-là si le service l&apos;est aussi.
          </span>
        </div>
      </div>
    </div>
  );
}
