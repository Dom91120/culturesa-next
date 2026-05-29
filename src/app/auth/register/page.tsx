"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { signUp } from "@/lib/auth-client";

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = new FormData(e.currentTarget);
    const prenom = String(form.get("prenom")).trim();
    const nom = String(form.get("nom")).trim();
    const email = String(form.get("email")).trim();
    const password = String(form.get("password"));
    const password2 = String(form.get("password2"));
    const rgpdOk = form.get("rgpd") === "on";

    if (password.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    if (password !== password2) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }
    if (!rgpdOk) {
      setError("Vous devez accepter l'utilisation de vos données (RGPD).");
      return;
    }

    setPending(true);
    const res = await signUp.email({
      email,
      password,
      name: `${prenom} ${nom}`.trim(),
      prenom,
      nom,
      tel: String(form.get("tel") ?? "").trim(),
      rgpdOk,
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
            <label htmlFor="c-pwd">
              Mot de passe <span className="required-star">*</span>
            </label>
            <input id="c-pwd" name="password" type="password" required placeholder="••••••••" minLength={8} autoComplete="new-password" />
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
          Vos données sont traitées pour gérer vos demandes de réservation et vous informer sur les
          activités culturelles.
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
