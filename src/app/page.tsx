import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-4xl font-bold tracking-tight text-brand-700">CultuRésa</h1>
      <p className="text-lg text-neutral-600 dark:text-neutral-400">
        Réservation d&apos;activités culturelles. Nouvelle version Next.js — en cours de
        construction.
      </p>
      <div className="flex gap-3">
        <Link
          href="/auth/login"
          className="rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700"
        >
          Se connecter
        </Link>
        <Link
          href="/auth/register"
          className="rounded-md border border-neutral-300 px-4 py-2 font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Créer un compte
        </Link>
      </div>
    </main>
  );
}
