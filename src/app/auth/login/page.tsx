import { redirect } from "next/navigation";
import { getSessionNoTouch } from "@/server/guards";
import { LoginForm } from "./login-form";

/**
 * Écran de connexion. Le formulaire vit dans un composant CLIENT (état local, appel
 * Better Auth) ; cette page serveur lit `?expired=1`, posé lorsqu'une session a été
 * révoquée pour dépassement de délai — par le garde `requireUser` (server/guards.ts) ou
 * par le composant de surveillance (components/session-watchdog.tsx) — et RENVOIE À
 * L'ACCUEIL quiconque est déjà connecté (Dom 2026-09-07 : un favori sur cette page
 * faisait ressaisir les identifiants et empilait une session par passage). Lecture sans
 * « touch » : arriver ici n'est pas une action de l'utilisateur.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ expired?: string }>;
}) {
  const { expired } = await searchParams;
  if (await getSessionNoTouch()) redirect("/");
  return <LoginForm expired={expired === "1"} />;
}
