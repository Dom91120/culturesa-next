"use client";

import { useActionState } from "react";
import { initialActionState } from "@/lib/action-state";
import { updateProfileAction } from "./actions";

type Profile = { prenom: string; nom: string; tel: string; email: string };

export function ProfileForm({ profile }: { profile: Profile }) {
  const [state, action, pending] = useActionState(updateProfileAction, initialActionState);

  return (
    <div className="panel">
      <div className="panel-title">
        <span className="dot" />
        Mon profil
      </div>
      <form action={action}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="p-nom">Nom</label>
            <input id="p-nom" name="nom" defaultValue={profile.nom} placeholder="Dupont" />
          </div>
          <div className="field">
            <label htmlFor="p-prenom">Prénom</label>
            <input id="p-prenom" name="prenom" defaultValue={profile.prenom} placeholder="Marie" />
          </div>
          <div className="field">
            <label htmlFor="p-email">E-mail</label>
            <input
              id="p-email"
              value={profile.email}
              disabled
              style={{ opacity: 0.6 }}
              title="Le changement d'e-mail viendra plus tard"
            />
          </div>
          <div className="field">
            <label htmlFor="p-tel">Téléphone</label>
            <input id="p-tel" name="tel" defaultValue={profile.tel} placeholder="06 12 34 56 78" />
          </div>
        </div>
        <div className="btn-row">
          {state?.ok && (
            <span style={{ fontSize: ".8rem", color: "var(--accent)" }}>Enregistré ✓</span>
          )}
          {state?.error && (
            <span className="field-error" style={{ display: "inline" }}>
              {state.error}
            </span>
          )}
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? "Enregistrement…" : "💾 Enregistrer"}
          </button>
        </div>
      </form>
    </div>
  );
}
