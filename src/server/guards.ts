import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Role } from "@/generated/prisma/client";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db";
import { checkSessionPolicy, sessionDeadlineAt, shouldTouch } from "@/server/session-policy";
import { CHEMIN_ENROLEMENT, exige2FA } from "@/server/two-factor-policy";

/** Hiérarchie des rôles : un administrateur satisfait aussi un guard gestionnaire. */
const RANK: Record<Role, number> = {
  utilisateur: 0,
  gestionnaire: 1,
  administrateur: 2,
};

type SessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

/**
 * État PAR REQUÊTE (React.cache mémoïse par rendu) : mémorise qu'une session a été
 * révoquée pour dépassement de délai. Permet à `requireUser` de distinguer « session
 * expirée » (message à l'écran de connexion) de « jamais connecté » (page nue).
 */
const revocation = cache(() => ({ expired: false }));

/**
 * Lit la session, APPLIQUE la politique d'inactivité / de durée absolue
 * (server/session-policy.ts) et, si `touch`, horodate l'activité de l'usager.
 *
 * Une session hors politique est RÉVOQUÉE (ligne supprimée) avant de renvoyer
 * null : le cookie résiduel du navigateur ne désigne alors plus rien, et tous
 * les appelants — gardes, routes API — voient un usager déconnecté. La suppression
 * en base est volontairement préférée à `signOut` : Next.js interdit d'écrire un
 * cookie pendant le rendu d'un Server Component, où ces gardes sont appelées.
 */
async function readSession(touch: boolean): Promise<SessionResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  const role = (session.user as { role?: Role }).role;
  // `updatedAt` sert de marqueur de dernière activité : il est réécrit par le
  // `touch` ci-dessous (et, accessoirement, par le renouvellement natif de Better Auth).
  const lastSeenAt = session.session.updatedAt;
  const verdict = checkSessionPolicy(role, lastSeenAt, session.session.createdAt);

  if (verdict !== "ok") {
    // deleteMany : idempotent (aucune erreur si la session a déjà disparu, ex. deux
    // requêtes concurrentes franchissant le seuil en même temps).
    await prisma.session.deleteMany({ where: { id: session.session.id } });
    revocation().expired = true;
    return null;
  }

  // Horodatage de l'activité, au plus une fois par TOUCH_THROTTLE_MS. Écriture
  // best-effort : un échec ne doit pas casser le rendu de la page — au pire
  // l'activité est enregistrée à la requête suivante.
  if (touch && shouldTouch(lastSeenAt)) {
    try {
      await prisma.session.update({
        where: { id: session.session.id },
        data: { updatedAt: new Date() },
      });
    } catch (e) {
      console.error("[guards] horodatage d'activité échoué:", e);
    }
  }

  return session;
}

/**
 * Renvoie la session courante ou null. Mémoïsée PAR REQUÊTE via React.cache :
 * un même rendu (layout + page + services qui re-vérifient la session) ne paie
 * qu'un seul aller-retour Better Auth au lieu de 3-4.
 *
 * COMPTE comme activité de l'usager (repousse le délai d'inactivité).
 */
export const getSession = cache(async () => readSession(true));

/**
 * Variante qui NE COMPTE PAS comme activité — réservée aux appels AUTOMATIQUES,
 * émis par la page et non par un geste de l'usager : sondage de version des
 * grilles (/api/agenda-version). Sans elle, un onglet d'agenda laissé ouvert
 * devant un poste inoccupé maintiendrait la session vivante indéfiniment, ce qui
 * viderait le délai d'inactivité de son sens sur les écrans les plus utilisés.
 *
 * La politique reste APPLIQUÉE : le sondage cesse de répondre dès que la session
 * est hors délai, il se contente de ne pas la prolonger.
 */
export const getSessionNoTouch = cache(async () => readSession(false));

/** Exige un utilisateur connecté, sinon redirige vers la page de connexion. */
export async function requireUser() {
  const session = await getSession();
  // `?expired=1` : l'écran de connexion explique alors la déconnexion au lieu de
  // laisser l'usager face à un formulaire sans raison apparente.
  if (!session) redirect(revocation().expired ? "/auth/login?expired=1" : "/auth/login");
  return session;
}

/**
 * Échéance de la session courante (epoch ms), ou null si personne n'est connecté.
 * Destinée au composant client de surveillance (components/session-watchdog.tsx),
 * monté par les enveloppes authentifiées.
 */
export async function sessionDeadline(): Promise<number | null> {
  const session = await getSession();
  if (!session) return null;
  const role = (session.user as { role?: Role }).role;
  return sessionDeadlineAt(role, session.session.updatedAt, session.session.createdAt);
}

/** Exige au moins le rôle demandé, sinon redirige. */
export async function requireRole(min: Role) {
  const session = await requireUser();
  const role = (session.user as { role?: Role }).role ?? "utilisateur";
  if (RANK[role] < RANK[min]) redirect("/");

  // Second facteur exigé des rôles privilégiés (constat A6). REDIRECTION vers
  // l'enrôlement, jamais blocage : les comptes existants n'ont aucun secret TOTP
  // au moment du déploiement, et refuser la connexion aurait mis dehors tous les
  // administrateurs — y compris celui qui aurait dû réparer.
  //
  // Chacun peut donc toujours se connecter et s'enrôler lui-même ; seule
  // l'administration attend. La page d'enrôlement vit sous /mon-compte, qui
  // n'appelle que `requireUser` — elle échappe donc par construction à ce garde,
  // sans quoi la redirection boucherait sur elle-même.
  if (exige2FA(role) && !(session.user as { twoFactorEnabled?: boolean }).twoFactorEnabled) {
    redirect(CHEMIN_ENROLEMENT);
  }
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
