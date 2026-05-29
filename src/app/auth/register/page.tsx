"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { btnPrimary, inputClass } from "@/components/ui";
import { signUp } from "@/lib/auth-client";

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = new FormData(e.currentTarget);
    const prenom = String(form.get("prenom")).trim();
    const nom = String(form.get("nom")).trim();
    const email = String(form.get("email")).trim();
    const password = String(form.get("password"));
    const rgpdOk = form.get("rgpdOk") === "on";

    if (!rgpdOk) {
      setError("Vous devez accepter la politique de confidentialité (RGPD).");
      return;
    }
    if (password.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }

    setPending(true);
    const { error } = await signUp.email({
      email,
      password,
      name: `${prenom} ${nom}`.trim(),
      // Champs métier additionnels (cf. better-auth additionalFields)
      prenom,
      nom,
      tel: String(form.get("tel") ?? "").trim(),
      rgpdOk,
    });
    setPending(false);

    if (error) {
      setError(
        error.status === 422
          ? "Un compte existe déjà avec cette adresse e-mail."
          : "Inscription impossible. Réessayez plus tard.",
      );
      return;
    }
    router.push(`/auth/verify?email=${encodeURIComponent(email)}`);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h1 className="text-lg font-semibold">Créer un compte</h1>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="prenom" className="mb-1 block text-sm font-medium">
            Prénom
          </label>
          <input id="prenom" name="prenom" required className={inputClass} />
        </div>
        <div>
          <label htmlFor="nom" className="mb-1 block text-sm font-medium">
            Nom
          </label>
          <input id="nom" name="nom" required className={inputClass} />
        </div>
      </div>
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          E-mail
        </label>
        <input id="email" name="email" type="email" required autoComplete="email" className={inputClass} />
      </div>
      <div>
        <label htmlFor="tel" className="mb-1 block text-sm font-medium">
          Téléphone
        </label>
        <input id="tel" name="tel" type="tel" autoComplete="tel" className={inputClass} />
      </div>
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
      <label className="flex items-start gap-2 text-sm text-neutral-600 dark:text-neutral-300">
        <input type="checkbox" name="rgpdOk" className="mt-0.5" />
        <span>
          J&apos;accepte que mes données soient traitées conformément à la politique de
          confidentialité (RGPD).
        </span>
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className={`${btnPrimary} w-full`}>
        {pending ? "Création…" : "Créer mon compte"}
      </button>
      <p className="text-center text-sm text-neutral-500">
        Déjà inscrit ?{" "}
        <Link href="/auth/login" className="hover:text-brand-700">
          Se connecter
        </Link>
      </p>
    </form>
  );
}
