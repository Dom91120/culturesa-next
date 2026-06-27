"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { PWD_RULES } from "@/lib/password";

export function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, setPending] = useState(false);

  const valid = PWD_RULES.every((r) => r.test(next));

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setOk(false);
    if (!valid) {
      setError("Le nouveau mot de passe ne respecte pas toutes les règles.");
      return;
    }
    if (next !== confirm) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setPending(true);
    const res = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: true,
    });
    setPending(false);
    if (res.error) {
      setError(
        res.error.status === 400
          ? "Mot de passe actuel incorrect."
          : "Échec du changement de mot de passe.",
      );
      return;
    }
    setOk(true);
    setCurrent("");
    setNext("");
    setConfirm("");
  }

  return (
    <div className="panel">
      <div className="panel-title">
        <span className="dot" />
        Changer mon mot de passe
      </div>
      <form onSubmit={onSubmit}>
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
