"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { signUp } from "@/lib/auth-client";
import { PWD_RULES } from "@/lib/password";
import { useFormSubmit } from "@/lib/use-form-submit";
import { type CaptchaHandle, CaptchaImage } from "../captcha-image";

type Structure = { id: number; label: string };
type Demandeur = { id: number; label: string; structures: Structure[] };
type Niveau = { id: number; label: string; demandeurId: number | null };

export function RegisterForm({
  demandeurs,
  niveaux,
}: {
  demandeurs: Demandeur[];
  niveaux: Niveau[];
}) {
  const router = useRouter();
  const { pending, error, onSubmit } = useFormSubmit();

  const [demandeurId, setDemandeurId] = useState("");
  const [structureId, setStructureId] = useState("");
  const [niveau, setNiveau] = useState("");
  const [niveauOpen, setNiveauOpen] = useState(false);
  const comboRef = useRef<HTMLDivElement>(null);

  const structures = demandeurs.find((d) => String(d.id) === demandeurId)?.structures ?? [];

  // Niveaux applicables — port du legacy _niveauFilteredList :
  // - demandeur choisi → ses niveaux + les niveaux globaux (demandeurId null) ;
  // - repli sur la liste complète si le filtre est vide (jamais de menu vide) ;
  // - filtrage live par le texte saisi (sauf quand il correspond à un niveau exact).
  const niveauBase = (() => {
    let base = demandeurId
      ? niveaux.filter((n) => n.demandeurId == null || String(n.demandeurId) === demandeurId)
      : niveaux;
    if (base.length === 0 && niveaux.length > 0) base = niveaux;
    return base;
  })();
  const niveauQuery = niveau.trim().toLowerCase();
  const niveauExact = niveauBase.some((n) => n.label.toLowerCase() === niveauQuery);
  const niveauOptions =
    niveauQuery && !niveauExact
      ? niveauBase.filter((n) => n.label.toLowerCase().includes(niveauQuery))
      : niveauBase;

  const [pwd, setPwd] = useState("");
  const pwdValid = PWD_RULES.every((r) => r.test(pwd));

  const [captcha, setCaptcha] = useState({ token: "", answer: "" });
  const captchaRef = useRef<CaptchaHandle>(null);
  const onCaptchaChange = useCallback((s: { token: string; answer: string }) => setCaptcha(s), []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) setNiveauOpen(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  // useFormSubmit gère pending / error / preventDefault / try-catch ; le handler reçoit le
  // FormData et renvoie un message d'erreur (string) ou rien (succès → navigation).
  const submit = onSubmit(async (form) => {
    const prenom = String(form.get("prenom")).trim();
    const nom = String(form.get("nom")).trim();
    const email = String(form.get("email")).trim();
    const password2 = String(form.get("password2"));
    const enfants = Number(form.get("enfants"));
    const accompagnants = Number(form.get("accompagnants"));

    if (!Number.isInteger(enfants) || enfants < 1) return "Indiquez au moins 1 enfant.";
    if (!Number.isInteger(accompagnants) || accompagnants < 1)
      return "Indiquez au moins 1 accompagnant.";
    if (!pwdValid) return "Le mot de passe ne respecte pas toutes les règles.";
    if (pwd !== password2) return "Les mots de passe ne correspondent pas.";
    if (form.get("rgpd") !== "on")
      return "Vous devez accepter l'utilisation de vos données (RGPD).";
    if (!captcha.token || !captcha.answer.trim()) return "Merci de recopier le code de l'image.";

    const res = await signUp.email({
      email,
      password: pwd,
      name: `${prenom} ${nom}`.trim(),
      prenom,
      nom,
      tel: String(form.get("tel") ?? "").trim(),
      niveau,
      enfants,
      accompagnants,
      ...(demandeurId ? { demandeurId: Number(demandeurId) } : {}),
      ...(structureId ? { structureId: Number(structureId) } : {}),
      // Le défi captcha (token signé + saisie) est transmis au middleware serveur
      // via des en-têtes, hors du corps validé par Better Auth.
      fetchOptions: {
        headers: {
          "x-captcha-token": captcha.token,
          "x-captcha-answer": captcha.answer,
        },
      },
    });

    if (res.error) {
      // Le défi captcha est consommé/expiré après une tentative : on en charge un
      // nouveau pour permettre une nouvelle saisie.
      captchaRef.current?.refresh();
      return res.error.status === 422
        ? "Un compte existe déjà avec cette adresse e-mail."
        : "Inscription impossible. Réessayez plus tard.";
    }
    router.push(`/auth/verify?email=${encodeURIComponent(email)}`);
  });

  return (
    <form onSubmit={submit} style={{ width: "80%", maxWidth: "100%", margin: "0 auto" }}>
      <div className="mode-toggle">
        Déjà inscrit ?{" "}
        <Link
          href="/auth/login"
          style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "underline" }}
        >
          Se connecter
        </Link>
      </div>
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
                const newDem = e.target.value;
                setDemandeurId(newDem);
                setStructureId("");
                // Efface le niveau s'il s'agit d'un niveau CONNU non applicable au
                // nouveau demandeur ; un texte libre ou un niveau encore valide est
                // conservé (port du legacy _refreshNiveauForDemandeur).
                const known = niveaux.some((n) => n.label === niveau);
                const stillValid = niveaux.some(
                  (n) =>
                    n.label === niveau &&
                    (n.demandeurId == null || String(n.demandeurId) === newDem),
                );
                if (known && !stillValid) setNiveau("");
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
              <option value="">
                {demandeurId ? "— choisir —" : "— Sélectionner d'abord une catégorie —"}
              </option>
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
                    <div className="niveau-combo-empty">
                      Aucun niveau prédéfini — tapez librement
                    </div>
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
              <label htmlFor="c-enfants">
                Nb enfants <span className="required-star">*</span>
              </label>
              <input
                id="c-enfants"
                name="enfants"
                type="number"
                required
                min={1}
                max={99}
                placeholder="1"
              />
            </div>
            <div>
              <label htmlFor="c-accompagnants">
                Nb accompagnants <span className="required-star">*</span>
              </label>
              <input
                id="c-accompagnants"
                name="accompagnants"
                type="number"
                required
                min={1}
                max={99}
                placeholder="1"
              />
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
            <input
              id="c-pwd2"
              name="password2"
              type="password"
              required
              placeholder="••••••••"
              autoComplete="new-password"
            />
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
          <button
            type="button"
            onClick={(e) => e.preventDefault()}
            style={{
              color: "inherit",
              textDecoration: "underline",
              background: "none",
              border: "none",
              padding: 0,
              font: "inherit",
              cursor: "pointer",
            }}
          >
            Politique de confidentialité
          </button>
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

      <CaptchaImage ref={captchaRef} onChange={onCaptchaChange} />

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
    </form>
  );
}
