"use client";

import { authClient } from "@/lib/auth-client";
import Link from "next/link";
import { useState } from "react";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const form = new FormData(e.currentTarget);
    await authClient.requestPasswordReset({
      email: String(form.get("email")),
      redirectTo: "/auth/reset-password",
    });
    setPending(false);
    setSent(true);
  }

  if (sent) {
    return (
      <div
        className="panel"
        style={{
          textAlign: "center",
          padding: "2rem 1.5rem",
          width: "60%",
          maxWidth: "100%",
          margin: "0 auto",
        }}
      >
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
    <div style={{ width: "60%", maxWidth: "100%", margin: "0 auto" }}>
      <div className="panel">
        <div className="panel-title">
          <span className="dot" />
          Mot de passe oublié
        </div>
        <p style={{ fontSize: ".82rem", color: "var(--muted)", marginBottom: "1rem" }}>
          Saisissez votre e-mail pour recevoir un lien de réinitialisation.
        </p>
        <form onSubmit={onSubmit}>
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
      <div className="mode-toggle">
        <Link href="/auth/login" style={{ color: "var(--muted)", textDecoration: "underline" }}>
          ← Retour à la connexion
        </Link>
      </div>
    </div>
  );
}
