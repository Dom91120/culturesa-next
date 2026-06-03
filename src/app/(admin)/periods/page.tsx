import { Card, PageTitle, btnDanger, btnGhost, inputClass } from "@/components/ui";
import { toDateInput } from "@/lib/format";
import { listPeriods } from "@/server/services/periods";
import { listServices } from "@/server/services/services";
import { deletePeriodAction, updatePeriodAction } from "./actions";
import { CreatePeriodForm } from "./create-form";

export default async function PeriodsPage() {
  const [periods, services] = await Promise.all([listPeriods(), listServices()]);
  const serviceOptions = services.map((s) => ({ id: s.id, label: s.label }));

  return (
    <div className="space-y-6">
      <PageTitle>Périodes</PageTitle>

      <Card>
        <CreatePeriodForm services={serviceOptions} />
      </Card>

      <Card>
        <div className="space-y-3">
          {periods.map((p) => (
            <div
              key={p.id}
              className="flex flex-wrap items-end gap-3 rounded-md border border-neutral-100 p-3 dark:border-neutral-800"
            >
              <span
                className="mb-2 inline-block h-5 w-5 shrink-0 rounded-full"
                style={{ backgroundColor: p.color }}
              />
              <form action={updatePeriodAction} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="id" value={p.id} />
                <label className="text-xs">
                  <span className="mb-1 block font-medium text-neutral-500">Libellé</span>
                  <input name="label" defaultValue={p.label} className={inputClass} />
                </label>
                <label className="text-xs">
                  <span className="mb-1 block font-medium text-neutral-500">Service</span>
                  <select name="serviceId" defaultValue={p.serviceId ?? ""} className={inputClass}>
                    <option value="">Global</option>
                    {serviceOptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs">
                  <span className="mb-1 block font-medium text-neutral-500">Début</span>
                  <input
                    name="dateStart"
                    type="date"
                    defaultValue={toDateInput(p.dateStart)}
                    className={inputClass}
                  />
                </label>
                <label className="text-xs">
                  <span className="mb-1 block font-medium text-neutral-500">Fin</span>
                  <input
                    name="dateEnd"
                    type="date"
                    defaultValue={toDateInput(p.dateEnd)}
                    className={inputClass}
                  />
                </label>
                <label className="text-xs">
                  <span className="mb-1 block font-medium text-neutral-500">Couleur</span>
                  <input
                    name="color"
                    type="color"
                    defaultValue={p.color}
                    className="h-9 w-12 rounded border border-neutral-300 dark:border-neutral-700"
                  />
                </label>
                <label className="text-xs">
                  <span className="mb-1 block font-medium text-neutral-500">État</span>
                  <select name="state" defaultValue={p.state} className={inputClass}>
                    <option value="actif">Actif</option>
                    <option value="desactive">Désactivé</option>
                    <option value="archive">Archivé</option>
                  </select>
                </label>
                <button type="submit" className={btnGhost}>
                  Enregistrer
                </button>
              </form>
              <form action={deletePeriodAction}>
                <input type="hidden" name="id" value={p.id} />
                <button type="submit" className={btnDanger}>
                  Supprimer
                </button>
              </form>
            </div>
          ))}
          {periods.length === 0 && <p className="text-sm text-neutral-400">Aucune période.</p>}
        </div>
      </Card>
    </div>
  );
}
