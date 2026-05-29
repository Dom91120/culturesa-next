"use client";

import Link from "next/link";
import { useState } from "react";
import { btnPrimary, inputClass } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const form = new FormData(e.currentTarget);
    await authClient.forgetPassword({
      email: String(form.get("email")),
      redirectTo: "/auth/reset-password",
    });
    setPending(false);
    // Message identique qu'il existe ou non un compte (anti-énumération).
    setSent(true);
  }

  if (sent) {
    return (
      <div className="space-y-4 text-center">
        <h1 className="text-lg font-semibold">E-mail envoyé</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          Si un compte existe pour cette adresse, un lien de réinitialisation vient d&apos;être
          envoyé (valable 1h).
        </p>
        <Link href="/auth/login" className="inline-block text-sm text-brand-700 hover:underline">
          Retour à la connexion
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h1 className="text-lg font-semibold">Mot de passe oublié</h1>
      <p className="text-sm text-neutral-500">
        Saisissez votre e-mail pour recevoir un lien de réinitialisation.
      </p>
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          E-mail
        </label>
        <input id="email" name="email" type="email" required autoComplete="email" className={inputClass} />
      </div>
      <button type="submit" disabled={pending} className={`${btnPrimary} w-full`}>
        {pending ? "Envoi…" : "Envoyer le lien"}
      </button>
      <Link href="/auth/login" className="block text-center text-sm text-neutral-500 hover:text-brand-700">
        Retour à la connexion
      </Link>
    </form>
  );
}
