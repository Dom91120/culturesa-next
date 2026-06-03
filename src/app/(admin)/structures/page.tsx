import { Card, PageTitle, btnDanger, btnGhost, inputClass } from "@/components/ui";
import { listDemandeurs } from "@/server/services/demandeurs";
import { listStructures } from "@/server/services/structures";
import { deleteStructureAction, updateStructureAction } from "./actions";
import { CreateStructureForm } from "./create-form";

export default async function StructuresPage() {
  const [structures, demandeurs] = await Promise.all([listStructures(), listDemandeurs()]);
  const options = demandeurs.map((d) => ({ id: d.id, label: d.label }));

  return (
    <div className="space-y-6">
      <PageTitle>Structures</PageTitle>

      <Card>
        <CreateStructureForm demandeurs={options} />
      </Card>

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
              <th className="pb-2 font-medium">Libellé</th>
              <th className="pb-2 font-medium">Demandeur</th>
              <th className="pb-2 font-medium">Utilisateurs</th>
              <th className="pb-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {structures.map((s) => (
              <tr key={s.id} className="border-b border-neutral-100 dark:border-neutral-800/60">
                <td className="py-2 pr-3">
                  <form
                    action={updateStructureAction}
                    id={`upd-str-${s.id}`}
                    className="flex items-center gap-2"
                  >
                    <input type="hidden" name="id" value={s.id} />
                    <input name="label" defaultValue={s.label} className={inputClass} />
                  </form>
                </td>
                <td className="py-2 pr-3">
                  <select
                    name="demandeurId"
                    form={`upd-str-${s.id}`}
                    defaultValue={s.demandeurId}
                    className={inputClass}
                  >
                    {options.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 pr-3 text-neutral-500">{s._count.users}</td>
                <td className="py-2">
                  <div className="flex justify-end gap-2">
                    <button type="submit" form={`upd-str-${s.id}`} className={btnGhost}>
                      Enregistrer
                    </button>
                    <form action={deleteStructureAction}>
                      <input type="hidden" name="id" value={s.id} />
                      <button type="submit" className={btnDanger}>
                        Supprimer
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
            {structures.length === 0 && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-neutral-400">
                  Aucune structure.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
