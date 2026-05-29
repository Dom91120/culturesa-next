"use client";

import { useActionState } from "react";
import { initialActionState } from "@/lib/action-state";
import { createServiceAction } from "./actions";

export function CreateServiceForm() {
  const [state, action, pending] = useActionState(createServiceAction, initialActionState);

  return (
    <form action={action} style={{ display: "flex", gap: ".5rem", alignItems: "center", flexWrap: "wrap" }}>
      <input name="label" required placeholder="Nouveau service…" style={{ minWidth: 200 }} />
      <button type="submit" disabled={pending} className="btn btn-primary" style={{ whiteSpace: "nowrap" }}>
        {pending ? "Création…" : "+ Ajouter"}
      </button>
      {state?.error && (
        <span className="field-error" style={{ display: "inline" }}>
          {state.error}
        </span>
      )}
    </form>
  );
}
