import { LoginForm } from "./login-form";

/**
 * Écran de connexion. Le formulaire vit dans un composant CLIENT (état local, appel
 * Better Auth) ; cette page serveur ne lit que `?expired=1`, posé lorsqu'une session
 * a été révoquée pour dépassement de délai — par le garde `requireUser` (server/guards.ts)
 * ou par le composant de surveillance (components/session-watchdog.tsx).
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ expired?: string }>;
}) {
  const { expired } = await searchParams;
  return <LoginForm expired={expired === "1"} />;
}
