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

/**
 * Dérogation de DÉVELOPPEMENT (jamais en production).
 *
 * L'exigence prend la forme d'une redirection vers l'enrôlement : sur un poste de
 * développement, elle impose d'enregistrer un secret TOTP DE PLUS dans son
 * application d'authentification — distinct de celui du serveur, les bases et les
 * secrets différant — et de le refaire à chaque base repartie de zéro ou restaurée
 * depuis un dump.
 *
 * D'où cette échappatoire, taillée pour ne JAMAIS pouvoir s'ouvrir sur une
 * installation réelle. Deux conditions cumulées :
 *   - `NODE_ENV` différent de « production » : un build servi par `npm run start`
 *     l'ignore, y compris en local ;
 *   - `DEV_SKIP_2FA` valant EXACTEMENT « true ». Comme pour `ALLOW_INSECURE_COOKIES`
 *     (A5), ni « 1 » ni « TRUE » : une échappatoire trop accueillante finit ouverte
 *     par accident, et qui se trompe de valeur doit voir que ça n'a pas pris.
 *
 * Elle ne lève QUE l'exigence d'enrôlement. Un compte réellement enrôlé
 * (`twoFactorEnabled`) se voit toujours réclamer son code à la connexion : c'est
 * Better Auth qui l'impose, et cette fonction n'a aucune prise dessus.
 */
export function derogation2FADev(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== "production" && env.DEV_SKIP_2FA === "true";
}

/** Ce rôle doit-il disposer d'un second facteur pour accéder à l'administration ? */
export function exige2FA(role: Role | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!role || !ROLES_2FA_REQUIS.has(role)) return false;
  return !derogation2FADev(env);
}
