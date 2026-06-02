import { getServiceOpeningConfig, listServicePeriods } from "@/server/services/periods";
import { getService } from "@/server/services/services";
import { notFound } from "next/navigation";
import { ParamsSubnav } from "../params-subnav";
import { PeriodesPanel } from "./periodes-panel";

/** Date (colonne @db.Date) → « YYYY-MM-DD » en UTC ; null → "". */
function toISODate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export default async function PeriodesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const service = await getService(id);
  if (!service) notFound();

  const [{ periods, exercices }, opening] = await Promise.all([
    listServicePeriods(id),
    getServiceOpeningConfig(id),
  ]);

  const initialPeriods = periods.map((p) => ({
    id: p.id,
    label: p.label,
    etiquette: p.etiquette,
    dateStart: toISODate(p.dateStart),
    dateEnd: toISODate(p.dateEnd),
    color: p.color,
    state: p.state,
    exerciceId: p.exerciceId,
  }));

  return (
    <div>
      <ParamsSubnav serviceId={id} />
      <PeriodesPanel
        serviceId={id}
        initialPeriods={initialPeriods}
        exercices={exercices}
        opening={
          opening ?? {
            activeDays: [],
            openOnHolidays: false,
            morningStart: "09:00",
            morningEnd: "12:00",
            afternoonStart: "14:00",
            afternoonEnd: "18:00",
          }
        }
      />
    </div>
  );
}
