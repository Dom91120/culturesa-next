"use client";

import { useActionState } from "react";
import { initialActionState } from "@/lib/action-state";
import { updateProfileAction } from "./actions";

type Role = "utilisateur" | "gestionnaire" | "administrateur";

type Profile = {
  prenom: string;
  nom: string;
  tel: string;
  email: string;
  role: Role;
  categorie: string | null;
  structure: string | null;
  niveau: string;
  enfants: number;
  accompagnants: number;
  managedServices: string[];
};

const ROLE_META: Record<Role, { cls: string; label: string }> = {
  administrateur: { cls: "role-admin", label: "Administrateur" },
  gestionnaire: { cls: "role-gestionnaire", label: "Gestionnaire" },
  utilisateur: { cls: "role-utilisateur", label: "Utilisateur" },
};

// Libellé de champ en lecture seule : un <span> stylé comme les <label> globaux
// (ces lignes ne pilotent aucun contrôle, donc pas de vrai <label>).
const readonlyLabelStyle: React.CSSProperties = {
  fontSize: ".65rem",
  fontWeight: 600,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  color: "var(--muted)",
};

function ReadonlyField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <span style={readonlyLabelStyle}>{label}</span>
      <div style={{ fontSize: ".9rem", padding: ".15rem 0", minHeight: "1.4rem" }}>{children}</div>
    </div>
  );
}

export function ProfileForm({ profile }: { profile: Profile }) {
  const [state, action, pending] = useActionState(updateProfileAction, initialActionState);
  const roleMeta = ROLE_META[profile.role];
  const isUser = profile.role === "utilisateur";
  const isManager = profile.role === "gestionnaire";
  const dash = <span style={{ color: "var(--muted)" }}>—</span>;

  return (
    <div className="panel">
      <div className="panel-title">
        <span className="dot" />
        Mon profil
        <span className={`role-pill ${roleMeta.cls}`} style={{ marginLeft: ".35rem" }}>
          {roleMeta.label}
        </span>
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
          {isUser && (
            <>
              <div className="field">
                <label htmlFor="p-enfants">
                  Nb enfants <span className="required-star">*</span>
                </label>
                <input
                  id="p-enfants"
                  name="enfants"
                  type="number"
                  min={1}
                  max={99}
                  defaultValue={profile.enfants}
                />
              </div>
              <div className="field">
                <label htmlFor="p-accompagnants">
                  Nb accompagnants <span className="required-star">*</span>
                </label>
                <input
                  id="p-accompagnants"
                  name="accompagnants"
                  type="number"
                  min={1}
                  max={99}
                  defaultValue={profile.accompagnants}
                />
              </div>
            </>
          )}
        </div>

        {/* Champs en lecture seule gérés par l'administration (catégorie, structure,
            niveau, services). Masqué pour un administrateur — le rôle est affiché à
            côté du titre. */}
        {(isUser || isManager) && (
          <div
            style={{
              marginTop: "1.25rem",
              paddingTop: "1rem",
              borderTop: "1px solid var(--border)",
            }}
          >
            <div className="form-grid">
              {isUser && (
                <>
                  <ReadonlyField label="Catégorie">{profile.categorie || dash}</ReadonlyField>
                  <ReadonlyField label="Structure">{profile.structure || dash}</ReadonlyField>
                  {profile.niveau && <ReadonlyField label="Niveau">{profile.niveau}</ReadonlyField>}
                </>
              )}

              {isManager && (
                <div className="field full">
                  <span style={readonlyLabelStyle}>Services gérés</span>
                  <div style={{ fontSize: ".9rem", padding: ".15rem 0" }}>
                    {profile.managedServices.length > 0 ? (
                      profile.managedServices.join(", ")
                    ) : (
                      <span style={{ color: "var(--muted)" }}>Aucun service</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

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
