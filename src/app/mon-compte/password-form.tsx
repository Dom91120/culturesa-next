"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { PWD_RULES } from "@/lib/password";
import { useFormSubmit } from "@/lib/use-form-submit";

export function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [ok, setOk] = useState(false);
  const { pending, error, onSubmit } = useFormSubmit();

  const valid = PWD_RULES.every((r) => r.test(next));

  // Le handler renvoie un message d'erreur (string) ou rien (succès) ; useFormSubmit gère
  // pending / error / preventDefault / try-catch.
  const submit = onSubmit(async () => {
    setOk(false);
    if (!valid) return "Le nouveau mot de passe ne respecte pas toutes les règles.";
    if (next !== confirm) return "Les deux mots de passe ne correspondent pas.";
    const res = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: true,
    });
    if (res.error) {
      return res.error.status === 400
        ? "Mot de passe actuel incorrect."
        : "Échec du changement de mot de passe.";
    }
    setOk(true);
    setCurrent("");
    setNext("");
    setConfirm("");
  });

  return (
    <div className="panel">
      <div className="panel-title">
        <span className="dot" />
        Changer mon mot de passe
      </div>
      <form onSubmit={submit}>
        <div className="form-grid">
          <div className="field full">
            <label htmlFor="pc-current">
              Mot de passe actuel <span className="required-star">*</span>
            </label>
            <input
              id="pc-current"
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>
          <div className="field">
            <label htmlFor="pc-new">
              Nouveau <span className="required-star">*</span>
            </label>
            <input
              id="pc-new"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
              placeholder="••••••••"
              autoComplete="new-password"
            />
            <ul className="pwd-checklist">
              {PWD_RULES.map((r) => (
                <li key={r.key} className={r.test(next) ? "ok" : ""}>
                  {r.label}
                </li>
              ))}
            </ul>
          </div>
          <div className="field">
            <label htmlFor="pc-confirm">
              Confirmer <span className="required-star">*</span>
            </label>
            <input
              id="pc-confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </div>
        </div>
        <div className="btn-row">
          {ok && (
            <span style={{ fontSize: ".8rem", color: "var(--accent)" }}>
              Mot de passe mis à jour ✓
            </span>
          )}
          {error && (
            <span className="field-error" style={{ display: "inline" }}>
              {error}
            </span>
          )}
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? "Mise à jour…" : "🔑 Mettre à jour"}
          </button>
        </div>
      </form>
    </div>
  );
}
