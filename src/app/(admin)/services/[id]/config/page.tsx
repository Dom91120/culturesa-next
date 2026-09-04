import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { getServiceDemandeurSettings } from "@/server/services/demandeur-settings";
import { getService } from "@/server/services/services";
import { getServiceThemes } from "@/server/services/themes";
import { ParamsSubnav } from "../params-subnav";
import { ConfigPanel } from "./config-panel";

// Onglet « Configuration » : fusion des réglages Demandeurs (matrice service ×
// demandeur) et Thèmes (mode + liste) en un seul écran. Branché aux mêmes actions
// serveur que les onglets Demandeurs et Thèmes (qui restent en place pour l'instant).
export default async function ConfigPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = await getService(id);
  if (!service) notFound();

  const [initialRows, allDemandeurs, themesData] = await Promise.all([
    getServiceDemandeurSettings(id),
    prisma.demandeur.findMany({
      orderBy: { label: "asc" },
      select: { id: true, label: true },
    }),
    getServiceThemes(id),
  ]);

  return (
    <div>
      <ParamsSubnav serviceId={id} />
      <ConfigPanel
        serviceId={id}
        allDemandeurs={allDemandeurs}
        initialRows={initialRows}
        initialThemeMode={themesData.mode}
        initialThemes={themesData.themes}
        initialGaugeAccompagnants={service.gaugeAccompagnants}
        initialFullPeriodNotice={service.fullPeriodNotice}
        initialFullPeriodNoticeText={service.fullPeriodNoticeText ?? ""}
        initialAbsencePrevenue={service.absencePrevenue}
        validationBloquante={service.validationBloquante}
        autoValidationDelay={service.autoValidationDelay}
        mgrNoticeMode={service.mgrNoticeMode}
        mgrNoticeIntervalHours={service.mgrNoticeIntervalHours}
        mgrNoticeHour={service.mgrNoticeHour}
        mgrNoticeWeekday={service.mgrNoticeWeekday}
      />
    </div>
  );
}
