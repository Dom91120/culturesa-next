"use client";

import { useActionState } from "react";
import { initialActionState } from "@/lib/action-state";
import { btnPrimary, inputClass } from "@/components/ui";
import { createDemandeurAction } from "./actions";

export function CreateDemandeurForm() {
  const [state, action, pending] = useActionState(createDemandeurAction, initialActionState);

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="flex-1 min-w-48">
        <label htmlFor="label" className="mb-1 block text-sm font-medium">
          Nouveau demandeur
        </label>
        <input id="label" name="label" required placeholder="Libellé" className={inputClass} />
      </div>
      <label className="flex items-center gap-2 pb-2 text-sm">
        <input type="checkbox" name="openOnSchoolHolidays" defaultChecked />
        Ouvert pendant les vacances scolaires
      </label>
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "Ajout…" : "Ajouter"}
      </button>
      {state?.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
