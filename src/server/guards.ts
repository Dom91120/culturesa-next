import { auth } from "@/server/auth";
import type { Role } from "@prisma/client";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

/** Hiérarchie des rôles : un administrateur satisfait aussi un guard gestionnaire. */
const RANK: Record<Role, number> = {
  utilisateur: 0,
  gestionnaire: 1,
  administrateur: 2,
};

/** Renvoie la session courante ou null. */
export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

/** Exige un utilisateur connecté, sinon redirige vers la page de connexion. */
export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/auth/login");
  return session;
}

/** Exige au moins le rôle demandé, sinon redirige. */
export async function requireRole(min: Role) {
  const session = await requireUser();
  const role = (session.user as { role?: Role }).role ?? "utilisateur";
  if (RANK[role] < RANK[min]) redirect("/");
  return session;
}
