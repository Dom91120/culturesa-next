"use client";

import { useActionState } from "react";
import { initialActionState } from "@/lib/action-state";
import { btnPrimary, inputClass } from "@/components/ui";
import { createNiveauAction } from "./actions";

type Option = { id: number; label: string };

export function CreateNiveauForm({ demandeurs }: { demandeurs: Option[] }) {
  const [state, action, pending] = useActionState(createNiveauAction, initialActionState);

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="flex-1 min-w-40">
        <label htmlFor="label" className="mb-1 block text-sm font-medium">
          Nouveau niveau
        </label>
        <input id="label" name="label" required placeholder="Libellé" className={inputClass} />
      </div>
      <div className="min-w-44">
        <label htmlFor="demandeurId" className="mb-1 block text-sm font-medium">
          Demandeur (optionnel)
        </label>
        <select id="demandeurId" name="demandeurId" className={inputClass} defaultValue="">
          <option value="">— aucun —</option>
          {demandeurs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      </div>
      <div className="w-24">
        <label htmlFor="position" className="mb-1 block text-sm font-medium">
          Position
        </label>
        <input id="position" name="position" type="number" min={0} defaultValue={0} className={inputClass} />
      </div>
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "Ajout…" : "Ajouter"}
      </button>
      {state?.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
