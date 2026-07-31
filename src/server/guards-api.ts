import { NextResponse } from "next/server";
import type { Role } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { getSession } from "@/server/guards";
import { journal } from "@/server/log";
import { exige2FA } from "@/server/two-factor-policy";

/**
 * Gardes d'autorisation pour les routes `route.ts` (constat BAC2).
 *
 * ── Le défaut corrigé ──
 * `requireRole` et `requireServiceManager` appellent `redirect()`. Sur une page
 * c'est le bon geste ; sur une route qui produit du CSV ou du PDF, le refus
 * devient une **redirection 307 vers du HTML**. L'accès était bien refusé — ce
 * n'était pas une faille — mais un client qui attend un fichier reçoit une page,
 * sans code d'erreur exploitable. Les refus se noyaient donc dans les journaux au
 * milieu des navigations ordinaires, et un balayage d'autorisations y devenait
 * indiscernable d'un usage normal.
 *
 * ── Pourquoi LEVER plutôt que renvoyer une réponse ──
 * Une variante qui renverrait `null` en cas de refus obligerait l'appelant à
 * penser à tester : l'oublier laisserait passer. En levant, l'oubli produit une
 * erreur 500 — moche, mais REFUSÉE. *Le mode de défaillance d'un garde doit être
 * le refus, jamais le passage.*
 */

/** Refus d'autorisation destiné à une route API. */
export class ApiAuthError extends Error {
  constructor(
    readonly statut: 401 | 403,
    message: string,
  ) {
    super(message);
    this.name = "ApiAuthError";
  }
}

const RANG: Record<Role, number> = { utilisateur: 0, gestionnaire: 1, administrateur: 2 };

function refuser(statut: 401 | 403, motif: string, details: Record<string, unknown>): never {
  // Journalisé au niveau AVERTISSEMENT, jamais ERREUR : un refus est le
  // fonctionnement normal d'un garde. En faire une erreur remplirait les journaux
  // d'alertes sur des accès correctement bloqués (cf. A3).
  //
  // On journalise l'identifiant interne et le rôle, JAMAIS l'adresse e-mail :
  // un journal d'exploitation n'a pas à devenir un fichier nominatif.
  journal.avert("guards:api", motif, { statut, ...details });
  throw new ApiAuthError(statut, motif);
}

/** Exige au moins le rôle demandé. Lève `ApiAuthError` sinon. */
export async function requireRoleApi(min: Role, chemin: string) {
  const session = await getSession();
  if (!session) refuser(401, "Authentification requise.", { chemin });

  const role = (session.user as { role?: Role }).role ?? "utilisateur";
  if (RANG[role] < RANG[min]) {
    refuser(403, "Droits insuffisants.", { chemin, role, userId: session.user.id });
  }

  // Second facteur exigé des rôles privilégiés (A6). Sur une page, le garde
  // REDIRIGE vers l'enrôlement ; ici la redirection n'aurait aucun sens — un
  // client qui télécharge un CSV ne s'enrôle pas. On refuse en le disant.
  if (exige2FA(role) && !(session.user as { twoFactorEnabled?: boolean }).twoFactorEnabled) {
    refuser(403, "Double authentification requise : activez-la depuis Mon compte › Sécurité.", {
      chemin,
      role,
      userId: session.user.id,
    });
  }
  return session;
}

/** Exige le droit d'administrer CE service. Lève `ApiAuthError` sinon. */
export async function requireServiceManagerApi(serviceId: string, chemin: string) {
  const session = await requireRoleApi("gestionnaire", chemin);
  const role = (session.user as { role?: Role }).role ?? "utilisateur";
  if (role === "administrateur") return session;

  const mgr = await prisma.serviceManager.findUnique({
    where: { userId_serviceId: { userId: session.user.id, serviceId } },
    select: { serviceId: true },
  });
  // Même refus, que le service existe ou non : distinguer « pas le droit » de
  // « n'existe pas » renseignerait un gestionnaire sur les services des autres.
  if (!mgr) {
    refuser(403, "Ce service ne vous est pas rattaché.", {
      chemin,
      serviceId,
      userId: session.user.id,
    });
  }
  return session;
}

/**
 * Enveloppe d'une route API : convertit un refus en réponse HTTP explicite.
 *
 * Le corps reste volontairement pauvre — un statut et un message court. Il est lu
 * par un navigateur qui attendait un fichier, pas par une interface : y détailler
 * le rôle manquant renseignerait un visiteur sur la structure des droits.
 */
export async function reponseApi(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.statut });
    }
    throw e;
  }
}
