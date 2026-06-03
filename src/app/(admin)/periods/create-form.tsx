"use client";

import { btnPrimary, inputClass } from "@/components/ui";
import { initialActionState } from "@/lib/action-state";
import { useActionState } from "react";
import { createPeriodAction } from "./actions";

type Option = { id: string; label: string };

export function CreatePeriodForm({ services }: { services: Option[] }) {
  const [state, action, pending] = useActionState(createPeriodAction, initialActionState);

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label className="flex-1 min-w-40 text-sm">
        <span className="mb-1 block font-medium">Libellé</span>
        <input name="label" required placeholder="Période…" className={inputClass} />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium">Service</span>
        <select name="serviceId" defaultValue="" className={inputClass}>
          <option value="">Global (tous)</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium">Début</span>
        <input name="dateStart" type="date" className={inputClass} />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium">Fin</span>
        <input name="dateEnd" type="date" className={inputClass} />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium">Couleur</span>
        <input
          name="color"
          type="color"
          defaultValue="#6dceaa"
          className="h-9 w-12 rounded border border-neutral-300 dark:border-neutral-700"
        />
      </label>
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "Ajout…" : "Ajouter"}
      </button>
      {state?.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
