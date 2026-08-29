"use client";

import { useActionState, useState } from "react";
import { initialActionState } from "@/lib/action-state";
import { upperCaseOnInput } from "@/lib/format";
import { updateAffiliationAction, updateProfileAction } from "./actions";

type Role = "utilisateur" | "gestionnaire" | "administrateur";

type Profile = {
  prenom: string;
  nom: string;
  tel: string;
  email: string;
  role: Role;
  categorie: string | null;
  structure: string | null;
  demandeurId: number | null;
  structureId: number | null;
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

type DemandeurOpt = { id: number; label: string; structures: { id: number; label: string }[] };

/**
 * Catégorie + structure, modifiables par l'usager tant qu'il n'a rien réservé sur un
 * exercice en cours (`modifiable`). Formulaire SÉPARÉ de l'identité : ces deux champs
 * déplacent l'accès aux services, ils méritent leur propre geste d'enregistrement
 * plutôt que de partir avec un changement de numéro de téléphone.
 */
function AffiliationFields({
  profile,
  demandeurs,
  modifiable,
}: {
  profile: Profile;
  demandeurs: DemandeurOpt[];
  modifiable: boolean;
}) {
  const [state, action, pending] = useActionState(updateAffiliationAction, initialActionState);
  const [demandeurId, setDemandeurId] = useState(
    profile.demandeurId != null ? String(profile.demandeurId) : "",
  );
  const [structureId, setStructureId] = useState(
    profile.structureId != null ? String(profile.structureId) : "",
  );
  const dash = <span style={{ color: "var(--muted)" }}>—</span>;

  if (!modifiable) {
    return (
      <>
        <div className="form-grid">
          <ReadonlyField label="Catégorie">{profile.categorie || dash}</ReadonlyField>
          <ReadonlyField label="Structure">{profile.structure || dash}</ReadonlyField>
        </div>
        <span style={{ fontSize: ".72rem", color: "var(--muted)", lineHeight: 1.5 }}>
          Vous avez des réservations sur l'exercice en cours : votre catégorie et votre structure ne
          sont plus modifiables ici — contactez le service.
        </span>
      </>
    );
  }

  // Cascade : la structure suit la catégorie choisie (une structure appartient à une
  // seule catégorie ; le serveur refuse tout couple incohérent).
  const structures = demandeurs.find((d) => String(d.id) === demandeurId)?.structures ?? [];

  return (
    <form action={action}>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="p-demandeur">Catégorie</label>
          <select
            id="p-demandeur"
            name="demandeurId"
            value={demandeurId}
            onChange={(e) => {
              setDemandeurId(e.target.value);
              // La structure dépend de la catégorie → la re-sélection est requise.
              setStructureId("");
            }}
          >
            <option value="">— Aucune —</option>
            {demandeurs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="p-structure">Structure</label>
          <select
            id="p-structure"
            name="structureId"
            value={structureId}
            disabled={!demandeurId || structures.length === 0}
            onChange={(e) => setStructureId(e.target.value)}
          >
            <option value="">
              {demandeurId ? "— Aucune —" : "— Choisissez d'abord une catégorie —"}
            </option>
            {structures.map((st) => (
              <option key={st.id} value={st.id}>
                {st.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {state?.error && (
        <p className="field-error" style={{ display: "block" }}>
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p style={{ fontSize: ".78rem", color: "var(--accent)" }}>✓ Affiliation enregistrée</p>
      )}
      <div className="btn-row" style={{ marginTop: ".4rem" }}>
        <button type="submit" className="btn btn-ghost" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer catégorie / structure"}
        </button>
      </div>
    </form>
  );
}

export function ProfileForm({
  profile,
  demandeurs,
  affiliationModifiable,
}: {
  profile: Profile;
  demandeurs: DemandeurOpt[];
  affiliationModifiable: boolean;
}) {
  const [state, action, pending] = useActionState(updateProfileAction, initialActionState);
  const roleMeta = ROLE_META[profile.role];
  const isUser = profile.role === "utilisateur";
  const isManager = profile.role === "gestionnaire";

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
            {/* Convention « NOM Prénom » : saisie forcée en majuscules. */}
            <input
              id="p-nom"
              name="nom"
              defaultValue={profile.nom}
              placeholder="DUPONT"
              onInput={upperCaseOnInput}
            />
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
              {isUser && profile.niveau && (
                <ReadonlyField label="Niveau">{profile.niveau}</ReadonlyField>
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

      {/* Catégorie / structure : HORS du formulaire d'identité — elles ont leur propre
          action, et un formulaire ne peut pas en contenir un autre (HTML : le
          navigateur supprime le formulaire imbriqué, et le bouton soumettait celui du
          dessus). Les deux gestes restent ainsi distincts : changer d'école n'est pas
          corriger son numéro de téléphone. */}
      {isUser && (
        <div
          style={{
            marginTop: "1.25rem",
            paddingTop: "1rem",
            borderTop: "1px solid var(--border)",
          }}
        >
          <AffiliationFields
            profile={profile}
            demandeurs={demandeurs}
            modifiable={affiliationModifiable}
          />
        </div>
      )}
    </div>
  );
}
