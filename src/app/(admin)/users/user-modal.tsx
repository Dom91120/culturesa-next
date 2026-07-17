"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ModalOverlay } from "@/components/agenda-shared";
import {
  PROFILE_MIN_ACCOMPAGNANTS_MSG,
  PROFILE_MIN_ENFANTS_MSG,
  profileCountOk,
} from "@/schemas/user";
import { createUserAction, sendPasswordResetAction, updateUserAction } from "./actions";
import type { Demandeur, NiveauRef, ServiceRef, StructureRef, UserRow } from "./users-table";

type Props = {
  mode: "create" | "edit";
  user: UserRow | null;
  demandeurs: Demandeur[];
  structures: StructureRef[];
  niveaux: NiveauRef[];
  services: ServiceRef[];
  onClose: () => void;
  onSaved: () => void;
};

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "utilisateur", label: "Utilisateur" },
  { value: "gestionnaire", label: "Gestionnaire" },
  { value: "administrateur", label: "Administrateur" },
];

export function UserModal({
  mode,
  user,
  demandeurs,
  structures,
  niveaux,
  services,
  onClose,
  onSaved,
}: Props) {
  const [nom, setNom] = useState(user?.nom ?? "");
  const [prenom, setPrenom] = useState(user?.prenom ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [tel, setTel] = useState(user?.tel ?? "");
  const [demandeurId, setDemandeurId] = useState<string>(
    user?.demandeurId != null ? String(user.demandeurId) : "",
  );
  const [structureId, setStructureId] = useState<string>(
    user?.structureId != null ? String(user.structureId) : "",
  );
  const [niveau, setNiveau] = useState(user?.niveau ?? "");
  const [niveauOpen, setNiveauOpen] = useState(false);
  const niveauComboRef = useRef<HTMLDivElement>(null);
  const [enfants, setEnfants] = useState<string>(user ? String(user.enfants) : "");
  const [accompagnants, setAccompagnants] = useState<string>(
    user ? String(user.accompagnants) : "",
  );
  const [role, setRole] = useState<string>(user?.role ?? "utilisateur");
  const [serviceIds, setServiceIds] = useState<string[]>(user?.serviceIds ?? []);
  const [error, setError] = useState<string | null>(null);
  const [resetInfo, setResetInfo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isManager = role === "gestionnaire";
  // Un compte « utilisateur » doit déclarer ≥ 1 enfant et ≥ 1 accompagnant, à la
  // création comme à l'édition ; pas d'exigence pour les gestionnaires/administrateurs.
  const requireKids = role === "utilisateur";

  // Cascade : ne montrer que les structures de la catégorie (demandeur) sélectionnée.
  const visibleStructures = useMemo(
    () => (demandeurId ? structures.filter((s) => String(s.demandeurId) === demandeurId) : []),
    [structures, demandeurId],
  );

  // Niveaux proposés dans le combobox : filtrés par catégorie (legacy _setNiveauField).
  // Un niveau global (demandeurId null) reste proposé pour toutes les catégories.
  const niveauOptions = useMemo(
    () =>
      niveaux.filter(
        (n) => n.demandeurId == null || (demandeurId && String(n.demandeurId) === demandeurId),
      ),
    [niveaux, demandeurId],
  );

  // (Les réinitialisations dérivées — structure liée à la catégorie, services liés au rôle
  // gestionnaire — sont faites directement dans les onChange concernés, pas via des
  // useEffect en cascade : évite des rendus en plus et tout risque de désynchronisation.)

  // Ferme la liste du combobox niveau au clic extérieur.
  useEffect(() => {
    if (!niveauOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      if (niveauComboRef.current && !niveauComboRef.current.contains(e.target as Node)) {
        setNiveauOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [niveauOpen]);

  function toggleService(id: string) {
    setServiceIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  function submit() {
    if (mode === "create" && !nom.trim()) {
      setError("Le nom est obligatoire.");
      return;
    }
    if (mode === "create" && !email.trim()) {
      setError("L'e-mail est obligatoire");
      return;
    }
    if (requireKids) {
      const nbEnfants = enfants === "" ? 0 : Number(enfants);
      const nbAccompagnants = accompagnants === "" ? 0 : Number(accompagnants);
      if (!profileCountOk(nbEnfants)) {
        setError(PROFILE_MIN_ENFANTS_MSG);
        return;
      }
      if (!profileCountOk(nbAccompagnants)) {
        setError(PROFILE_MIN_ACCOMPAGNANTS_MSG);
        return;
      }
    }
    if (isManager && serviceIds.length === 0) {
      setError("Sélectionnez au moins un service pour un gestionnaire.");
      return;
    }
    setError(null);
    const common = {
      prenom: prenom.trim(),
      nom: nom.trim(),
      tel: tel.trim(),
      niveau: niveau.trim(),
      enfants: enfants === "" ? 0 : Number(enfants),
      accompagnants: accompagnants === "" ? 0 : Number(accompagnants),
      role: role as "utilisateur" | "gestionnaire" | "administrateur",
      demandeurId: demandeurId ? Number(demandeurId) : null,
      structureId: structureId ? Number(structureId) : null,
      services: serviceIds,
    };
    startTransition(async () => {
      const res =
        mode === "edit" && user
          ? await updateUserAction({ id: user.id, ...common })
          : await createUserAction({ email: email.trim(), ...common });
      if (res && !res.ok) {
        setError(res.error ?? "Erreur");
        return;
      }
      onSaved();
    });
  }

  function sendReset() {
    if (!user) return;
    setError(null);
    setResetInfo(null);
    startTransition(async () => {
      const res = await sendPasswordResetAction(user.email);
      if (res && !res.ok) {
        setError(res.error ?? "Erreur");
        return;
      }
      setResetInfo("Lien de réinitialisation envoyé ✓");
    });
  }

  return (
    <ModalOverlay onClose={onClose} dismissOnBackdrop={false} boxStyle={{ maxWidth: 640 }}>
      <div className="modal-title">
        {mode === "edit"
          ? `✏️ ${`${prenom} ${nom}`.trim() || "Modifier le compte"}`
          : "＋ Ajouter un compte"}
      </div>

      <div className="form-grid">
        <div className="field">
          <label htmlFor="uc-nom">
            Nom {mode === "create" && <span className="required-star">*</span>}
          </label>
          <input
            id="uc-nom"
            type="text"
            value={nom}
            placeholder="Nom"
            autoComplete="off"
            onChange={(e) => setNom(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="uc-prenom">Prénom</label>
          <input
            id="uc-prenom"
            type="text"
            value={prenom}
            placeholder="Prénom"
            autoComplete="off"
            onChange={(e) => setPrenom(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="uc-email">
            E-mail {mode === "create" && <span className="required-star">*</span>}
            {mode === "edit" && (
              <span
                style={{
                  color: "var(--muted)",
                  fontSize: ".7rem",
                  textTransform: "none",
                  letterSpacing: 0,
                }}
              >
                {" "}
                (non modifiable)
              </span>
            )}
          </label>
          <input
            id="uc-email"
            type="email"
            value={email}
            autoComplete="off"
            disabled={mode === "edit"}
            style={mode === "edit" ? { opacity: 0.45 } : undefined}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="uc-tel">Téléphone</label>
          <input
            id="uc-tel"
            type="tel"
            value={tel}
            placeholder="06 12 34 56 78"
            autoComplete="off"
            onChange={(e) => setTel(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="uc-demandeur">Catégorie</label>
          <select
            id="uc-demandeur"
            value={demandeurId}
            autoComplete="off"
            onChange={(e) => {
              setDemandeurId(e.target.value);
              // La structure dépend de la catégorie → la re-sélection est requise.
              setStructureId("");
            }}
          >
            <option value="">— Catégorie —</option>
            {demandeurs.map((d) => (
              <option key={d.id} value={String(d.id)}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="uc-structure">Structure</label>
          <select
            id="uc-structure"
            value={structureId}
            disabled={!demandeurId}
            autoComplete="off"
            onChange={(e) => setStructureId(e.target.value)}
          >
            <option value="">
              {demandeurId ? "— Aucune —" : "— Sélectionner d'abord une catégorie —"}
            </option>
            {visibleStructures.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {/* Niveau (combobox texte libre) + Nb enfants + Nb accompagnants sur une ligne. */}
        <div className="field full uc-niveau-row">
          <div>
            <label htmlFor="uc-niveau">Niveau</label>
            <div className="niveau-combo" ref={niveauComboRef}>
              <input
                id="uc-niveau"
                type="text"
                autoComplete="off"
                placeholder="Choisir ou saisir..."
                value={niveau}
                onChange={(e) => {
                  setNiveau(e.target.value);
                  setNiveauOpen(true);
                }}
                onFocus={() => setNiveauOpen(true)}
              />
              <button
                type="button"
                className="niveau-combo-btn"
                tabIndex={-1}
                title="Voir les niveaux"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setNiveauOpen((o) => !o);
                }}
              >
                ▾
              </button>
              <div
                className={`niveau-combo-list${niveauOpen ? " open" : ""}`}
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  width: "auto",
                  marginTop: 2,
                }}
              >
                {niveauOptions.length === 0 ? (
                  <div className="niveau-combo-empty">Aucun niveau</div>
                ) : (
                  niveauOptions.map((n) => (
                    <div
                      key={n.id}
                      className="niveau-combo-list-item"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setNiveau(n.label);
                        setNiveauOpen(false);
                      }}
                    >
                      {n.label}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
          <div>
            <label htmlFor="uc-enfants">
              Nb enfants {requireKids && <span className="required-star">*</span>}
            </label>
            <input
              id="uc-enfants"
              type="number"
              min={requireKids ? 1 : 0}
              max={99}
              value={enfants}
              autoComplete="off"
              onChange={(e) => setEnfants(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="uc-accompagnants">
              Nb accompagnants {requireKids && <span className="required-star">*</span>}
            </label>
            <input
              id="uc-accompagnants"
              type="number"
              min={requireKids ? 1 : 0}
              max={99}
              value={accompagnants}
              autoComplete="off"
              onChange={(e) => setAccompagnants(e.target.value)}
            />
          </div>
        </div>

        <div className="field full">
          <label htmlFor="uc-role">Rôle</label>
          <select
            id="uc-role"
            value={role}
            onChange={(e) => {
              const r = e.target.value;
              setRole(r);
              // Hors rôle gestionnaire : pas de services rattachés.
              if (r !== "gestionnaire") setServiceIds([]);
            }}
          >
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field full">
          <label htmlFor="uc-services">
            Services {isManager && <span className="required-star">*</span>}
          </label>
          <div
            id="uc-services"
            className="uc-services-list"
            style={{
              opacity: isManager ? 1 : 0.5,
              pointerEvents: isManager ? "auto" : "none",
            }}
          >
            {services.length === 0 ? (
              <span style={{ color: "var(--muted)", fontSize: ".78rem" }}>
                Aucun service disponible
              </span>
            ) : (
              services.map((s) => (
                <label key={s.id} className="uc-service-row">
                  <span>{s.label}</span>
                  <input
                    type="checkbox"
                    checked={serviceIds.includes(s.id)}
                    disabled={!isManager}
                    onChange={() => toggleService(s.id)}
                  />
                </label>
              ))
            )}
          </div>
        </div>

        {/* Section "Mot de passe" : toujours visible (comme le legacy). Le bouton de
              réinitialisation est actif en édition, désactivé en création (pas encore
              de compte cible — l'admin pourra renvoyer le lien après création). */}
        <div className="field full">
          <span
            style={{
              fontSize: ".65rem",
              fontWeight: 600,
              letterSpacing: ".1em",
              textTransform: "uppercase",
              color: "var(--muted)",
              display: "block",
            }}
          >
            🔑 Mot de passe
          </span>
          <p
            style={{
              fontSize: ".78rem",
              color: "var(--muted)",
              lineHeight: 1.5,
              margin: ".25rem 0 .5rem",
            }}
          >
            Pour des raisons de confidentialité, l'administrateur ne définit pas le mot de passe. Un
            e-mail contenant un lien sécurisé (valable 1 heure) sera envoyé à l'utilisateur, qui
            choisira lui-même son nouveau mot de passe.
          </p>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={sendReset}
            disabled={pending || mode === "create"}
            style={{
              padding: ".4rem .9rem",
              fontSize: ".78rem",
              borderColor: "color-mix(in srgb, var(--accent) 40%, transparent)",
              color: "var(--accent)",
              whiteSpace: "nowrap",
            }}
          >
            📧 Envoyer un lien de réinitialisation
          </button>
          {resetInfo && (
            <span style={{ marginLeft: ".75rem", fontSize: ".8rem", color: "var(--accent)" }}>
              {resetInfo}
            </span>
          )}
        </div>
      </div>

      {error && (
        <span className="field-error" style={{ display: "block", marginTop: ".75rem" }}>
          {error}
        </span>
      )}

      <div className="btn-row" style={{ marginTop: "1.25rem" }}>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Annuler
        </button>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>
          Enregistrer
        </button>
      </div>

      <button type="button" className="modal-close" onClick={onClose}>
        ×
      </button>
    </ModalOverlay>
  );
}
