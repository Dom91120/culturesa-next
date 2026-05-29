"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signUp } from "@/lib/auth-client";

type Structure = { id: number; label: string };
type Demandeur = { id: number; label: string; structures: Structure[] };
type Niveau = { id: number; label: string; demandeurId: number | null };

const PWD_RULES = [
  { key: "length", label: "12 caractères", test: (p: string) => p.length >= 12 },
  { key: "upper", label: "1 majuscule", test: (p: string) => /[A-Z]/.test(p) },
  { key: "lower", label: "1 minuscule", test: (p: string) => /[a-z]/.test(p) },
  { key: "digit", label: "1 chiffre", test: (p: string) => /[0-9]/.test(p) },
  { key: "special", label: "1 caractère spécial", test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

export function RegisterForm({
  demandeurs,
  niveaux,
}: {
  demandeurs: Demandeur[];
  niveaux: Niveau[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [demandeurId, setDemandeurId] = useState("");
  const [structureId, setStructureId] = useState("");
  const structures = demandeurs.find((d) => String(d.id) === demandeurId)?.structures ?? [];
  const niveauOptions = niveaux.filter((n) => !demandeurId || String(n.demandeurId) === demandeurId);

  const [niveau, setNiveau] = useState("");
  const [niveauOpen, setNiveauOpen] = useState(false);
  const comboRef = useRef<HTMLDivElement>(null);

  const [pwd, setPwd] = useState("");
  const pwdValid = PWD_RULES.every((r) => r.test(pwd));

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) setNiveauOpen(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = new FormData(e.currentTarget);
    const prenom = String(form.get("prenom")).trim();
    const nom = String(form.get("nom")).trim();
    const email = String(form.get("email")).trim();
    const password2 = String(form.get("password2"));

    if (!pwdValid) {
      setError("Le mot de passe ne respecte pas toutes les règles.");
      return;
    }
    if (pwd !== password2) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }
    if (form.get("rgpd") !== "on") {
      setError("Vous devez accepter l'utilisation de vos données (RGPD).");
      return;
    }

    setPending(true);
    const res = await signUp.email({
      email,
      password: pwd,
      name: `${prenom} ${nom}`.trim(),
      prenom,
      nom,
      tel: String(form.get("tel") ?? "").trim(),
      niveau,
      enfants: Number(form.get("enfants") || 0),
      accompagnants: Number(form.get("accompagnants") || 0),
      ...(demandeurId ? { demandeurId: Number(demandeurId) } : {}),
      ...(structureId ? { structureId: Number(structureId) } : {}),
    });
    setPending(false);

    if (res.error) {
      setError(
        res.error.status === 422
          ? "Un compte existe déjà avec cette adresse e-mail."
          : "Inscription impossible. Réessayez plus tard.",
      );
      return;
    }
    router.push(`/auth/verify?email=${encodeURIComponent(email)}`);
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="panel">
        <div className="panel-title">
          <span className="dot" />
          Créer un compte
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="c-nom">
              Nom <span className="required-star">*</span>
            </label>
            <input id="c-nom" name="nom" type="text" required placeholder="Dupont" />
          </div>
          <div className="field">
            <label htmlFor="c-prenom">
              Prénom <span className="required-star">*</span>
            </label>
            <input id="c-prenom" name="prenom" type="text" required placeholder="Marie" />
          </div>
          <div className="field">
            <label htmlFor="c-email">
              E-mail <span className="required-star">*</span>
            </label>
            <input id="c-email" name="email" type="email" required placeholder="marie@exemple.fr" />
          </div>
          <div className="field">
            <label htmlFor="c-tel">Téléphone</label>
            <input id="c-tel" name="tel" type="tel" placeholder="06 12 34 56 78" />
          </div>
          <div className="field">
            <label htmlFor="c-demandeur">Catégorie</label>
            <select
              id="c-demandeur"
              value={demandeurId}
              onChange={(e) => {
                setDemandeurId(e.target.value);
                setStructureId("");
              }}
            >
              <option value="">— choisir —</option>
              {demandeurs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="c-structure">Structure</label>
            <select
              id="c-structure"
              value={structureId}
              onChange={(e) => setStructureId(e.target.value)}
              disabled={!demandeurId}
            >
              <option value="">— choisir —</option>
              {structures.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field full uc-niveau-row">
            <div>
              <label htmlFor="c-niveau">Niveau</label>
              <div className="niveau-combo" ref={comboRef}>
                <input
                  id="c-niveau"
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
                  style={{ position: "absolute", top: "100%", left: 0, right: 0, width: "auto", marginTop: 2 }}
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
              <label htmlFor="c-enfants">Nb enfants</label>
              <input id="c-enfants" name="enfants" type="number" min={0} max={99} placeholder="25" />
            </div>
            <div>
              <label htmlFor="c-accompagnants">Nb accompagnants</label>
              <input id="c-accompagnants" name="accompagnants" type="number" min={0} max={99} placeholder="0" />
            </div>
          </div>

          <div className="field">
            <label htmlFor="c-pwd">
              Mot de passe <span className="required-star">*</span>
            </label>
            <input
              id="c-pwd"
              type="password"
              required
              placeholder="••••••••"
              autoComplete="new-password"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
            />
            <ul className="pwd-checklist">
              {PWD_RULES.map((r) => (
                <li key={r.key} className={r.test(pwd) ? "ok" : ""}>
                  {r.label}
                </li>
              ))}
            </ul>
          </div>
          <div className="field">
            <label htmlFor="c-pwd2">
              Confirmer <span className="required-star">*</span>
            </label>
            <input id="c-pwd2" name="password2" type="password" required placeholder="••••••••" autoComplete="new-password" />
          </div>
        </div>
      </div>

      <div className="rgpd-box">
        <div className="rgpd-header">🔒 Protection des données (RGPD)</div>
        <p className="rgpd-text">
          La Ville de Châtillon traite les données recueillies pour pouvoir gérer votre demande de
          réservation, et également afin de vous contacter en vue de bénéficier des services et des
          informations concernant les activités, évènements et fonctionnement des structures
          culturelles de la Ville.
        </p>
        <p className="rgpd-text" style={{ marginTop: ".5rem" }}>
          Pour en savoir plus sur la gestion de vos données personnelles et pour exercer vos droits,
          cliquez sur notre{" "}
          <a href="#" onClick={(e) => e.preventDefault()} style={{ color: "inherit", textDecoration: "underline" }}>
            Politique de confidentialité
          </a>
          .
        </p>
        <div className="check-row">
          <label className="custom-check">
            <input type="checkbox" name="rgpd" />
            <span className="checkmark" />
          </label>
          <span className="check-label">
            J&apos;accepte que mes données soient utilisées pour la gestion de mes réservations.
          </span>
        </div>
      </div>

      {error && (
        <p className="field-error" style={{ display: "block", marginBottom: ".5rem" }}>
          {error}
        </p>
      )}

      <div className="btn-row">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Création…" : "Créer mon compte →"}
        </button>
      </div>

      <div className="mode-toggle">
        Déjà inscrit ?{" "}
        <Link href="/auth/login" style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "underline" }}>
          Se connecter
        </Link>
      </div>
    </form>
  );
}
