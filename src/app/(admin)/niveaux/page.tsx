import { Card, PageTitle, btnDanger, btnGhost, inputClass } from "@/components/ui";
import { listDemandeurs } from "@/server/services/demandeurs";
import { listNiveaux } from "@/server/services/niveaux";
import { deleteNiveauAction, updateNiveauAction } from "./actions";
import { CreateNiveauForm } from "./create-form";

export default async function NiveauxPage() {
  const [niveaux, demandeurs] = await Promise.all([listNiveaux(), listDemandeurs()]);
  const options = demandeurs.map((d) => ({ id: d.id, label: d.label }));

  return (
    <div className="space-y-6">
      <PageTitle>Niveaux</PageTitle>

      <Card>
        <CreateNiveauForm demandeurs={options} />
      </Card>

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
              <th className="pb-2 font-medium">Libellé</th>
              <th className="pb-2 font-medium">Demandeur</th>
              <th className="pb-2 font-medium w-24">Position</th>
              <th className="pb-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {niveaux.map((n) => (
              <tr key={n.id} className="border-b border-neutral-100 dark:border-neutral-800/60">
                <td className="py-2 pr-3">
                  <form
                    action={updateNiveauAction}
                    id={`upd-niv-${n.id}`}
                    className="flex items-center gap-2"
                  >
                    <input type="hidden" name="id" value={n.id} />
                    <input name="label" defaultValue={n.label} className={inputClass} />
                  </form>
                </td>
                <td className="py-2 pr-3">
                  <select
                    name="demandeurId"
                    form={`upd-niv-${n.id}`}
                    defaultValue={n.demandeurId ?? ""}
                    className={inputClass}
                  >
                    <option value="">— aucun —</option>
                    {options.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 pr-3">
                  <input
                    name="position"
                    type="number"
                    min={0}
                    form={`upd-niv-${n.id}`}
                    defaultValue={n.position}
                    className={inputClass}
                  />
                </td>
                <td className="py-2">
                  <div className="flex justify-end gap-2">
                    <button type="submit" form={`upd-niv-${n.id}`} className={btnGhost}>
                      Enregistrer
                    </button>
                    <form action={deleteNiveauAction}>
                      <input type="hidden" name="id" value={n.id} />
                      <button type="submit" className={btnDanger}>
                        Supprimer
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
            {niveaux.length === 0 && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-neutral-400">
                  Aucun niveau.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
