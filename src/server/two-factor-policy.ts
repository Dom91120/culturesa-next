import type { Role } from "@/generated/prisma/client";

// ════════════════════════════════════════════════════════════════════════════
//  Où le second facteur est exigé (constat A6). Source unique, partagée par le
//  garde d'accès et l'écran d'enrôlement.
//
//  ── Exigé pour qui, et pourquoi ──
//  Les ADMINISTRATEURS seuls. Ce sont les comptes qui cumulent tout : export de
//  la base nominative complète, restauration de sauvegarde, changement de rôle,
//  accès aux identifiants SMTP. Un mot de passe seul ne protège pas cela — A1
//  ayant fermé la porte du bruteforce, l'intérêt d'un attaquant se déplace vers
//  l'hameçonnage et le vol de session, contre quoi le second facteur est la
//  seule parade réelle.
//
//  Les GESTIONNAIRES en sont exemptés : ce sont des agents de terrain, dont le
//  périmètre est borné aux services qu'ils administrent (cf. ServiceManager).
//  Leur imposer une application d'authentification pour saisir des réservations
//  au quotidien pèserait sur l'usage sans réduire proportionnellement le risque.
//  Ils peuvent l'activer volontairement.
//
//  Les USAGERS non plus : leur compte ne donne accès qu'à leurs propres
//  réservations, et l'exiger de familles pour réserver une séance serait
//  disproportionné.
//
//  ⚠️ Ce choix laisse une marche : un gestionnaire compromis garde accès aux
//  données nominatives de SES services. C'est un arbitrage assumé entre sécurité
//  et adoption, à revoir si le périmètre des gestionnaires s'élargissait.
//
//  ── Exiger sans jamais verrouiller dehors ──
//  L'exigence n'est PAS appliquée à la connexion : elle l'est à l'entrée des
//  écrans d'administration, sous forme de REDIRECTION vers l'enrôlement. Les
//  comptes existants n'ont aucun secret TOTP au moment du déploiement ; bloquer
//  la connexion aurait mis dehors tous les administrateurs à la seconde où le
//  correctif est parti en production — y compris celui qui aurait dû réparer.
//
//  Chacun peut donc toujours se connecter, et s'enrôler lui-même. Ce n'est
//  qu'ensuite que l'administration s'ouvre.
// ════════════════════════════════════════════════════════════════════════════

/** Rôles pour lesquels le second facteur conditionne l'accès à l'administration. */
export const ROLES_2FA_REQUIS: ReadonlySet<Role> = new Set<Role>(["administrateur"]);

/** Chemin de l'écran d'enrôlement — hors du périmètre du garde, par construction. */
export const CHEMIN_ENROLEMENT = "/mon-compte/securite";

/** Ce rôle doit-il disposer d'un second facteur pour accéder à l'administration ? */
export function exige2FA(role: Role | undefined): boolean {
  return !!role && ROLES_2FA_REQUIS.has(role);
}
