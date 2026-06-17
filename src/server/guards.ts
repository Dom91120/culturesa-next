import { auth } from "@/server/auth";
import { prisma } from "@/server/db";
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

/**
 * Exige que l'usager puisse ADMINISTRER ce service : administrateur (tous les services)
 * ou gestionnaire dont la liste `ServiceManager` contient ce service. Liste vide =
 * aucun accès (deny par défaut, cf. legacy `require_manager_service`). Redirige vers la
 * liste des services si l'accès est refusé (même logique que `requireRole`).
 */
export async function requireServiceManager(serviceId: string) {
  const session = await requireRole("gestionnaire");
  const role = (session.user as { role?: Role }).role ?? "utilisateur";
  if (role === "administrateur") return session;
  const mgr = await prisma.serviceManager.findUnique({
    where: { userId_serviceId: { userId: session.user.id, serviceId } },
    select: { serviceId: true },
  });
  if (!mgr) redirect("/configuration");
  return session;
}

/**
 * Variante NON bloquante de `requireServiceManager` : renvoie true si l'usager peut
 * administrer ce service (administrateur, ou gestionnaire rattaché). Pour décider d'un
 * affichage conditionnel (ex. bouton réservé aux gestionnaires) sans redirection.
 */
export async function isServiceManager(
  serviceId: string,
  userId: string,
  role?: Role,
): Promise<boolean> {
  if (role === "administrateur") return true;
  if (role !== "gestionnaire") return false;
  const mgr = await prisma.serviceManager.findUnique({
    where: { userId_serviceId: { userId, serviceId } },
    select: { serviceId: true },
  });
  return !!mgr;
}
