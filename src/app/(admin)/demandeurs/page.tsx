import { btnDanger, btnGhost, Card, inputClass, PageTitle } from "@/components/ui";
import { listDemandeurs } from "@/server/services/demandeurs";
import { deleteDemandeurAction, updateDemandeurAction } from "./actions";
import { CreateDemandeurForm } from "./create-form";

export default async function DemandeursPage() {
  const demandeurs = await listDemandeurs();

  return (
    <div className="space-y-6">
      <PageTitle>Demandeurs</PageTitle>

      <Card>
        <CreateDemandeurForm />
      </Card>

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
              <th className="pb-2 font-medium">Libellé</th>
              <th className="pb-2 font-medium">Vacances scol.</th>
              <th className="pb-2 font-medium">Rattachés</th>
              <th className="pb-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {demandeurs.map((d) => (
              <tr key={d.id} className="border-b border-neutral-100 dark:border-neutral-800/60">
                <td className="py-2 pr-3">
                  <form
                    action={updateDemandeurAction}
                    id={`upd-${d.id}`}
                    className="flex items-center gap-2"
                  >
                    <input type="hidden" name="id" value={d.id} />
                    <input name="label" defaultValue={d.label} className={inputClass} />
                  </form>
                </td>
                <td className="py-2 pr-3">
                  <input
                    type="checkbox"
                    name="openOnSchoolHolidays"
                    form={`upd-${d.id}`}
                    defaultChecked={d.openOnSchoolHolidays}
                  />
                </td>
                <td className="py-2 pr-3 text-neutral-500">
                  {d._count.structures} struct. · {d._count.niveaux} niv. · {d._count.users} util.
                </td>
                <td className="py-2">
                  <div className="flex justify-end gap-2">
                    <button type="submit" form={`upd-${d.id}`} className={btnGhost}>
                      Enregistrer
                    </button>
                    <form action={deleteDemandeurAction}>
                      <input type="hidden" name="id" value={d.id} />
                      <button type="submit" className={btnDanger}>
                        Supprimer
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
            {demandeurs.length === 0 && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-neutral-400">
                  Aucun demandeur.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
