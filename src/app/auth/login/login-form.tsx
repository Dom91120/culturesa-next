"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { signIn } from "@/lib/auth-client";
import { useFormSubmit } from "@/lib/use-form-submit";

export function LoginForm({ expired = false }: { expired?: boolean }) {
  const router = useRouter();
  const { pending, error, onSubmit } = useFormSubmit();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

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
    // Redirection selon le rôle déléguée à « / » (gestionnaire → Administration,
    // sinon → réservation).
    router.push("/");
    router.refresh();
  });

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
