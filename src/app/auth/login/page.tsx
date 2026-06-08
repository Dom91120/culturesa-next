"use client";

import { signIn } from "@/lib/auth-client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const canSubmit = email.trim().length > 0 && password.length > 0;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const res = await signIn.email({ email, password });
    setPending(false);
    if (res.error) {
      // On ne déduit plus « e-mail non confirmé » de TOUT 403 : Better Auth renvoie
      // aussi 403 pour une origine non autorisée (ex. accès LAN). On se fie au code.
      const code = res.error.code;
      setError(
        code === "EMAIL_NOT_VERIFIED"
          ? "Adresse e-mail non confirmée. Vérifiez votre boîte mail."
          : code === "INVALID_EMAIL_OR_PASSWORD"
            ? "E-mail ou mot de passe incorrect."
            : res.error.message || "Connexion impossible. Réessayez.",
      );
      return;
    }
    // Redirection selon le rôle déléguée à « / » (gestionnaire → Administration,
    // sinon → réservation).
    router.push("/");
    router.refresh();
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
        <form onSubmit={onSubmit}>
          <div className="panel">
            <div className="panel-title">
              <span className="dot" />
              Se connecter
            </div>
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
