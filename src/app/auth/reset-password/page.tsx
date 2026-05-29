"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { btnPrimary, inputClass } from "@/components/ui";
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
      <div className="space-y-4 text-center">
        <h1 className="text-lg font-semibold">Lien invalide ou expiré</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          Demandez un nouveau lien de réinitialisation.
        </p>
        <Link href="/auth/forgot-password" className="inline-block text-sm text-brand-700 hover:underline">
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
    const { error } = await authClient.resetPassword({ newPassword: password, token: token! });
    setPending(false);
    if (error) {
      setError("Échec de la réinitialisation. Le lien a peut-être expiré.");
      return;
    }
    router.push("/auth/login");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h1 className="text-lg font-semibold">Nouveau mot de passe</h1>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          Mot de passe
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="confirm" className="mb-1 block text-sm font-medium">
          Confirmation
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={inputClass}
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className={`${btnPrimary} w-full`}>
        {pending ? "Enregistrement…" : "Réinitialiser"}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<p className="text-sm text-neutral-500">Chargement…</p>}>
      <ResetForm />
    </Suspense>
  );
}
