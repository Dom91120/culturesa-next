"use client";

import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { useFormSubmit } from "@/lib/use-form-submit";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const { pending, onSubmit } = useFormSubmit();

  const handleSubmit = onSubmit(async (form) => {
    await authClient.requestPasswordReset({
      email: String(form.get("email")),
      redirectTo: "/auth/reset-password",
    });
    setSent(true);
  });

  if (sent) {
    return (
      <div className="panel auth-card" style={{ textAlign: "center" }}>
        <div style={{ fontSize: "2.5rem", marginBottom: ".75rem" }}>📧</div>
        <div className="panel-title" style={{ justifyContent: "center", marginBottom: ".5rem" }}>
          <span className="dot" />
          E-mail envoyé
        </div>
        <p
          style={{
            fontSize: ".88rem",
            color: "var(--muted)",
            lineHeight: 1.6,
            marginBottom: "1.25rem",
          }}
        >
          Si un compte existe pour cette adresse, un lien de réinitialisation vient d&apos;être
          envoyé (valable 1h).
        </p>
        <Link
          className="btn btn-ghost"
          href="/auth/login"
          style={{ fontSize: ".82rem", textDecoration: "none" }}
        >
          ← Retour à la connexion
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="panel auth-card">
        <div className="panel-title">
          <span className="dot" />
          Mot de passe oublié
        </div>
        <div className="panel-subtitle">
          Saisissez votre e-mail pour recevoir un lien de réinitialisation.
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="field full">
              <label htmlFor="email">
                E-mail <span className="required-star">*</span>
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                placeholder="marie@exemple.fr"
                autoComplete="email"
              />
            </div>
          </div>
          <div className="btn-row">
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Envoi…" : "Envoyer le lien"}
            </button>
          </div>
        </form>
      </div>
      <div className="auth-alt">
        <Link href="/auth/login" className="is-muted">
          ← Retour à la connexion
        </Link>
      </div>
    </>
  );
}
