"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
      <div style={{ width: "60%", maxWidth: "100%", margin: "0 auto" }}>
        <form onSubmit={handleCode}>
          <div className="panel">
            <div className="panel-title">
              <span className="dot" />
              Vérification en deux étapes
            </div>
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
                {error && (
                  <span className="field-error" style={{ display: "block" }}>
                    {error}
                  </span>
                )}
                <div style={{ marginTop: ".5rem", fontSize: ".75rem" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setCodeSecours(!codeSecours);
                      setCode("");
                    }}
                    style={{
                      background: "none",
                      border: 0,
                      padding: 0,
                      color: "var(--muted)",
                      textDecoration: "underline",
                      cursor: "pointer",
                      font: "inherit",
                    }}
                  >
                    {codeSecours
                      ? "Utiliser l'application d'authentification"
                      : "Téléphone perdu ? Utiliser un code de secours"}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="btn-row">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={pending || code.trim().length < 6}
            >
              {pending ? "Vérification…" : "Valider →"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <>
      <div className="mode-toggle">
        Pas encore de compte ?{" "}
        <Link
          href="/auth/register"
          style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "underline" }}
        >
          Créer un compte
        </Link>
      </div>

      <div style={{ width: "60%", maxWidth: "100%", margin: "0 auto" }}>
        <form onSubmit={handleSubmit}>
          <div className="panel">
            <div className="panel-title">
              <span className="dot" />
              Se connecter
            </div>
            {/* Déconnexion automatique (délai d'inactivité ou durée maximale de session,
                cf. server/session-policy.ts) : sans ce message, l'usager se retrouve
                devant le formulaire sans comprendre pourquoi. */}
            {expired && (
              <div
                role="status"
                style={{
                  margin: "0 0 1rem",
                  padding: ".7rem .9rem",
                  border: "1px solid var(--border)",
                  borderLeft: "3px solid var(--accent)",
                  borderRadius: 6,
                  fontSize: ".85rem",
                  lineHeight: 1.5,
                }}
              >
                Votre session a expiré après une période d&apos;inactivité. Merci de vous
                reconnecter.
              </div>
            )}
            <div className="form-grid">
              <div className="field full">
                <label htmlFor="l-email">
                  E-mail <span className="required-star">*</span>
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
                  placeholder="••••••••"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {error && (
                  <span className="field-error" style={{ display: "block" }}>
                    {error}
                  </span>
                )}
                <div style={{ marginTop: ".4rem", textAlign: "right" }}>
                  <Link
                    href="/auth/forgot-password"
                    style={{
                      fontSize: ".75rem",
                      color: "var(--muted)",
                      textDecoration: "underline",
                    }}
                  >
                    Mot de passe oublié ?
                  </Link>
                </div>
              </div>
            </div>
          </div>
          <div className="btn-row">
            <button type="submit" className="btn btn-primary" disabled={pending || !canSubmit}>
              {pending ? "Connexion…" : "Connexion →"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
