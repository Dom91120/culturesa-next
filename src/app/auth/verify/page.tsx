import Link from "next/link";

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

  return (
    <div className="space-y-4 text-center">
      <h1 className="text-lg font-semibold">Vérifiez votre boîte mail</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-300">
        Un e-mail de confirmation {email ? <>a été envoyé à <strong>{email}</strong></> : "vous a été envoyé"}.
        Cliquez sur le lien qu&apos;il contient pour activer votre compte, puis connectez-vous.
      </p>
      <Link href="/auth/login" className="inline-block text-sm text-brand-700 hover:underline">
        Retour à la connexion
      </Link>
    </div>
  );
}
