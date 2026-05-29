"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { authClient } from "@/lib/auth-client";

function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  const errorParam = params.get("error");

  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!token || errorParam) {
    return (
      <div className="panel" style={{ textAlign: "center", padding: "2rem 1.5rem" }}>
        <div className="panel-title" style={{ justifyContent: "center", marginBottom: ".5rem" }}>
          <span className="dot" />
          Lien invalide ou expiré
        </div>
        <p style={{ fontSize: ".88rem", color: "var(--muted)", marginBottom: "1.25rem" }}>
          Demandez un nouveau lien de réinitialisation.
        </p>
        <Link className="btn btn-ghost" href="/auth/forgot-password" style={{ fontSize: ".82rem", textDecoration: "none" }}>
          Mot de passe oublié
        </Link>
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password"));
    const confirm = String(form.get("confirm"));
    if (password.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    if (password !== confirm) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setPending(true);
    const res = await authClient.resetPassword({ newPassword: password, token: token! });
    setPending(false);
    if (res.error) {
      setError("Échec de la réinitialisation. Le lien a peut-être expiré.");
      return;
    }
    router.push("/auth/login");
  }

  return (
    <div className="panel">
      <div className="panel-title">
        <span className="dot" />
        Nouveau mot de passe
      </div>
      <form onSubmit={onSubmit}>
        <div className="form-grid">
          <div className="field full">
            <label htmlFor="password">
              Mot de passe <span className="required-star">*</span>
            </label>
            <input id="password" name="password" type="password" required minLength={8} placeholder="••••••••" autoComplete="new-password" />
          </div>
          <div className="field full">
            <label htmlFor="confirm">
              Confirmer <span className="required-star">*</span>
            </label>
            <input id="confirm" name="confirm" type="password" required minLength={8} placeholder="••••••••" autoComplete="new-password" />
            {error && (
              <span className="field-error" style={{ display: "block" }}>
                {error}
              </span>
            )}
          </div>
        </div>
        <div className="btn-row">
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? "Enregistrement…" : "Réinitialiser"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<p style={{ color: "var(--muted)" }}>Chargement…</p>}>
      <ResetForm />
    </Suspense>
  );
}
