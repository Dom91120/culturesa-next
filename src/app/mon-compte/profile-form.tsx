"use client";

import { useActionState, useState } from "react";
import { initialActionState } from "@/lib/action-state";
import { upperCaseOnInput } from "@/lib/format";
import { STRUCTURE_LIBRE_MAX } from "@/schemas/user";
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

type DemandeurOpt = {
  id: number;
  label: string;
  /** Catégorie fourre-tout : la structure se SAISIT au lieu de se choisir (la page ne
   * livre d'ailleurs pas ses structures au navigateur, comme à l'inscription). */
  structureLibre: boolean;
  structures: { id: number; label: string }[];
};

/**
 * Catégorie + structure en LECTURE SEULE (usager ayant déjà réservé sur l'exercice en
 * cours) : affichées avec les autres champs gérés par l'administration, AU-DESSUS du
 * bouton Enregistrer, avec la mention explicative (retour Dom 2026-09-04).
 */
function AffiliationReadonly({ profile }: { profile: Profile }) {
  const dash = <span style={{ color: "var(--muted)" }}>—</span>;
  return (
    <>
      <ReadonlyField label="Catégorie">{profile.categorie || dash}</ReadonlyField>
      <ReadonlyField label="Structure">{profile.structure || dash}</ReadonlyField>
    </>
  );
}

/**
 * Catégorie + structure SAISISSABLES (usager sans réservation sur un exercice en
 * cours) : deux champs du formulaire d'identité, enregistrés AVEC lui par
 * `updateProfileAction` — un seul « Enregistrer » (Dom 2026-09-05). Seule la cascade
 * catégorie → structure est locale ; le serveur refuse tout couple incohérent.
 */
function AffiliationEditable({
  profile,
  demandeurs,
}: {
  profile: Profile;
  demandeurs: DemandeurOpt[];
}) {
  const [demandeurId, setDemandeurId] = useState(
    profile.demandeurId != null ? String(profile.demandeurId) : "",
  );
  const [structureId, setStructureId] = useState(
    profile.structureId != null ? String(profile.structureId) : "",
  );
  // Libellé saisi quand la catégorie choisie est en SAISIE LIBRE — pré-rempli avec la
  // structure actuelle de l'usager (c'est la sienne : pas de fuite), vidé au changement.
  const [structureTexte, setStructureTexte] = useState(profile.structure ?? "");

  // Cascade : la structure suit la catégorie choisie (une structure appartient à une
  // seule catégorie).
  const demandeurChoisi = demandeurs.find((d) => String(d.id) === demandeurId);
  const structures = demandeurChoisi?.structures ?? [];
  // Catégorie en saisie libre → champ TEXTE obligatoire à la place du sélecteur,
  // comme à l'inscription (le serveur rapproche/crée via resolveStructureLibre).
  const saisieLibre = demandeurChoisi?.structureLibre ?? false;

  return (
    <>
      <div className="field">
        <label htmlFor="p-demandeur">Catégorie</label>
        <select
          id="p-demandeur"
          name="demandeurId"
          value={demandeurId}
          onChange={(e) => {
            setDemandeurId(e.target.value);
            // La structure dépend de la catégorie → la re-sélection/saisie est requise.
            setStructureId("");
            setStructureTexte("");
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
        <label htmlFor={saisieLibre ? "p-structure-libre" : "p-structure"}>
          Structure{saisieLibre && <span className="required-star">*</span>}
        </label>
        {saisieLibre ? (
          <input
            id="p-structure-libre"
            name="structureTexte"
            required
            maxLength={STRUCTURE_LIBRE_MAX}
            placeholder="Nom de votre structure"
            value={structureTexte}
            onChange={(e) => setStructureTexte(e.target.value)}
          />
        ) : (
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
        )}
      </div>
    </>
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

        {/* Affiliation (catégorie, structure, niveau) et services gérés : DANS le même
            formulaire que l'identité, un seul « Enregistrer » (Dom 2026-09-05).
            Catégorie et structure sont saisissables tant que l'usager n'a rien réservé
            sur l'exercice en cours, figées sinon. Masqué pour un administrateur — le
            rôle est affiché à côté du titre. */}
        {(isUser || isManager) && (
          <div
            style={{
              marginTop: "1.25rem",
              paddingTop: "1rem",
              borderTop: "1px solid var(--border)",
            }}
          >
            <div
              className="form-grid"
              // Catégorie, structure et niveau sur UNE ligne : 3/8, 3/8, 1/4 (retour
              // Dom 2026-09-04). Sinon la grille standard à deux colonnes.
              style={isUser && profile.niveau ? { gridTemplateColumns: "3fr 3fr 2fr" } : undefined}
            >
              {isUser &&
                (affiliationModifiable ? (
                  <AffiliationEditable profile={profile} demandeurs={demandeurs} />
                ) : (
                  <AffiliationReadonly profile={profile} />
                ))}
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
            {isUser && !affiliationModifiable && (
              <span
                style={{
                  display: "block",
                  marginTop: ".5rem",
                  fontSize: ".72rem",
                  color: "var(--muted)",
                  lineHeight: 1.5,
                }}
              >
                Vous avez des réservations sur l'exercice en cours : votre catégorie et votre
                structure ne sont plus modifiables ici — contactez le service.
              </span>
            )}
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
