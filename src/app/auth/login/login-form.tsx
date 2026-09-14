"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import iconPng from "@/app/icon.png";
import { signIn, twoFactor } from "@/lib/auth-client";
import { useFormSubmit } from "@/lib/use-form-submit";

export function LoginForm({ expired = false }: { expired?: boolean }) {
  const router = useRouter();
  const { pending, error, onSubmit } = useFormSubmit();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Le mot de passe est déjà validé quand on arrive ici : on reste sur la MÊME
  // page pour la saisie du code, plutôt que de rediriger. Une erreur de code
  // n'oblige alors pas à ressaisir le mot de passe (constat A6).
  const [etape, setEtape] = useState<"identifiants" | "code">("identifiants");
  const [code, setCode] = useState("");
  const [codeSecours, setCodeSecours] = useState(false);

  const canSubmit = email.trim().length > 0 && password.length > 0;

  const handleSubmit = onSubmit(async () => {
    const res = await signIn.email({ email, password });
    if (res.error) {
      // On ne déduit plus « e-mail non confirmé » de TOUT 403 : Better Auth renvoie
      // aussi 403 pour une origine non autorisée (ex. accès LAN). On se fie au code.
      const code = res.error.code;
      if (code === "EMAIL_NOT_VERIFIED")
        return "Adresse e-mail non confirmée. Vérifiez votre boîte mail.";
      if (code === "INVALID_EMAIL_OR_PASSWORD") return "E-mail ou mot de passe incorrect.";
      if (res.error.status === 429) return "Trop de tentatives. Réessayez dans une minute.";
      // Cas non identifié : message générique (on n'expose pas le libellé interne de la lib).
      return "Connexion impossible. Réessayez.";
    }
    // Second facteur actif : la connexion ne renvoie PAS de session mais
    // `twoFactorRedirect`. La session n'existera qu'après vérification du code.
    if ((res.data as { twoFactorRedirect?: boolean } | undefined)?.twoFactorRedirect) {
      setEtape("code");
      return;
    }
    // Redirection selon le rôle déléguée à « / » (gestionnaire → Administration,
    // sinon → réservation).
    router.push("/");
    router.refresh();
  });

  const handleCode = onSubmit(async () => {
    const valeur = code.trim();
    const res = codeSecours
      ? await twoFactor.verifyBackupCode({ code: valeur })
      : await twoFactor.verifyTotp({ code: valeur });
    if (res.error) {
      return codeSecours
        ? "Code de secours invalide ou déjà utilisé."
        : "Code incorrect. Vérifiez l'heure de votre téléphone, puis réessayez.";
    }
    router.push("/");
    router.refresh();
  });

  // ── Étape 2 : second facteur ──
  // Écran distinct plutôt qu'un champ ajouté au formulaire : à ce stade le mot de
  // passe est vérifié et n'a plus à être affiché ni renvoyé.
  if (etape === "code") {
    return (
      <div className="auth-si">
        <SiHead />
        <form onSubmit={handleCode} className="auth-si-card">
          <h1>Vérification en deux étapes</h1>
          <div className="form-grid">
            <div className="field full">
              <label htmlFor="l-code">
                {codeSecours ? "Code de secours" : "Code à 6 chiffres"}{" "}
                <span className="required-star">*</span>
              </label>
              <input
                id="l-code"
                type="text"
                required
                inputMode={codeSecours ? "text" : "numeric"}
                autoComplete="one-time-code"
                // Cas où la règle d'accessibilité s'inverse : cet écran apparaît APRÈS
                // une action délibérée (envoi du formulaire), le bouton qui portait le
                // focus a disparu, et ce champ est le seul de la page. Sans autoFocus,
                // un lecteur d'écran resterait sur un focus orphelin.
                // biome-ignore lint/a11y/noAutofocus: focus légitime après action utilisateur
                autoFocus
                placeholder={codeSecours ? "xxxxx-xxxxx" : "000000"}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
          </div>
          {error && <p className="field-error">{error}</p>}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={pending || code.trim().length < 6}
          >
            {pending ? "Vérification…" : "Valider"}
          </button>
          <p className="auth-si-foot">
            <button
              type="button"
              className="auth-link-btn"
              onClick={() => {
                setCodeSecours(!codeSecours);
                setCode("");
              }}
            >
              {codeSecours
                ? "Utiliser l'application d'authentification"
                : "Téléphone perdu ? Utiliser un code de secours"}
            </button>
          </p>
        </form>
      </div>
    );
  }

  return (
    <div className="auth-si">
      <SiHead />
      <form onSubmit={handleSubmit} className="auth-si-card">
        <h1>Connexion</h1>
        {/* Déconnexion automatique (délai d'inactivité ou durée maximale de session,
            cf. server/session-policy.ts) : sans ce message, l'usager se retrouve
            devant le formulaire sans comprendre pourquoi. */}
        {expired && (
          <p role="status" className="auth-notice">
            Votre session a expiré, reconnectez-vous.
          </p>
        )}
        <div className="form-grid">
          <div className="field full">
            <label htmlFor="l-email">
              Adresse e-mail <span className="required-star">*</span>
            </label>
            <input
              id="l-email"
              type="text"
              required
              placeholder="marie@exemple.fr"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field full">
            <label htmlFor="l-pwd">
              Mot de passe <span className="required-star">*</span>
            </label>
            <input
              id="l-pwd"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>
        {error && <p className="field-error">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={pending || !canSubmit}>
          {pending ? "Connexion…" : "Se connecter"}
        </button>
        <p className="auth-si-foot">
          <Link href="/auth/forgot-password">Mot de passe oublié ?</Link>
        </p>
      </form>
      <div className="auth-alt">
        Pas encore de compte ? <Link href="/auth/register">Créer un compte</Link>
      </div>
    </div>
  );
}

/** Pictogramme carré + nom + sous-titre au-dessus de la carte (essai SoftInventory). */
function SiHead() {
  return (
    <div className="auth-si-head">
      <img className="auth-si-mark" src={iconPng.src} width={48} height={48} alt="" />
      <div>
        <div className="logo">
          Cultu<em>Résa</em>
        </div>
        <div className="auth-si-sub">Réservation d&apos;activités culturelles</div>
      </div>
    </div>
  );
}
