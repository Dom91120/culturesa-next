"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { signIn } from "@/lib/auth-client";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const res = await signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setPending(false);
    if (res.error) {
      setError(
        res.error.status === 403
          ? "Adresse e-mail non confirmée. Vérifiez votre boîte mail."
          : "E-mail ou mot de passe incorrect.",
      );
      return;
    }
    router.push("/reserver");
    router.refresh();
  }

  return (
    <>
      <div className="panel">
        <div className="panel-title">
          <span className="dot" />
          Se connecter
        </div>
        <form onSubmit={onSubmit}>
          <div className="form-grid">
            <div className="field full">
              <label htmlFor="l-email">
                E-mail <span className="required-star">*</span>
              </label>
              <input id="l-email" name="email" type="text" required placeholder="marie@exemple.fr" autoComplete="email" />
            </div>
            <div className="field full">
              <label htmlFor="l-pwd">
                Mot de passe <span className="required-star">*</span>
              </label>
              <input id="l-pwd" name="password" type="password" required placeholder="••••••••" autoComplete="current-password" />
              {error && (
                <span className="field-error" style={{ display: "block" }}>
                  {error}
                </span>
              )}
              <div style={{ marginTop: ".4rem", textAlign: "right" }}>
                <Link
                  href="/auth/forgot-password"
                  style={{ fontSize: ".75rem", color: "var(--muted)", textDecoration: "underline" }}
                >
                  Mot de passe oublié ?
                </Link>
              </div>
            </div>
          </div>
          <div className="btn-row">
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Connexion…" : "Connexion →"}
            </button>
          </div>
        </form>
      </div>

      <div className="mode-toggle">
        Pas encore de compte ?{" "}
        <Link href="/auth/register" style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "underline" }}>
          Créer un compte
        </Link>
      </div>
    </>
  );
}
