"use client";

import { useActionState } from "react";
import { initialActionState } from "@/lib/action-state";
import { btnPrimary, inputClass } from "@/components/ui";
import { createServiceAction } from "./actions";

export function CreateServiceForm() {
  const [state, action, pending] = useActionState(createServiceAction, initialActionState);

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="flex-1 min-w-48">
        <label htmlFor="label" className="mb-1 block text-sm font-medium">
          Nouveau service
        </label>
        <input id="label" name="label" required placeholder="Libellé" className={inputClass} />
      </div>
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "Création…" : "Créer et configurer"}
      </button>
      {state?.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
