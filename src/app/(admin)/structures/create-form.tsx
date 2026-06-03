"use client";

import { btnPrimary, inputClass } from "@/components/ui";
import { initialActionState } from "@/lib/action-state";
import { useActionState } from "react";
import { createStructureAction } from "./actions";

type Option = { id: number; label: string };

export function CreateStructureForm({ demandeurs }: { demandeurs: Option[] }) {
  const [state, action, pending] = useActionState(createStructureAction, initialActionState);

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="min-w-48">
        <label htmlFor="demandeurId" className="mb-1 block text-sm font-medium">
          Demandeur
        </label>
        <select id="demandeurId" name="demandeurId" required className={inputClass}>
          <option value="">— choisir —</option>
          {demandeurs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex-1 min-w-48">
        <label htmlFor="label" className="mb-1 block text-sm font-medium">
          Nouvelle structure
        </label>
        <input id="label" name="label" required placeholder="Libellé" className={inputClass} />
      </div>
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "Ajout…" : "Ajouter"}
      </button>
      {state?.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
