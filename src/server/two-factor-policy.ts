import type { Role } from "@/generated/prisma/client";

// ════════════════════════════════════════════════════════════════════════════
//  Où le second facteur est exigé (constat A6). Source unique, partagée par le
//  garde d'accès et l'écran d'enrôlement.
//
//  ── Exigé pour qui, et pourquoi ──
//  Les rôles listés ici peuvent exporter la base nominative complète — noms,
//  adresses, téléphones, structures, effectifs d'enfants. Un mot de passe seul
//  ne protège pas cela : A1 ayant fermé la porte du bruteforce, l'intérêt d'un
//  attaquant se déplace vers l'hameçonnage et le vol de session, contre quoi le
//  second facteur est la seule parade réelle.
//
//  Les usagers ne sont PAS concernés : leur compte ne donne accès qu'à leurs
//  propres réservations, et imposer une application d'authentification à des
//  familles pour réserver une séance serait disproportionné. Ils peuvent
//  l'activer s'ils le souhaitent.
//
//  ── Exiger sans jamais verrouiller dehors ──
//  L'exigence n'est PAS appliquée à la connexion : elle l'est à l'entrée des
//  écrans d'administration, sous forme de REDIRECTION vers l'enrôlement. Les
//  comptes existants n'ont aucun secret TOTP au moment du déploiement ; bloquer
//  la connexion aurait mis dehors tous les gestionnaires à la seconde où le
//  correctif est parti en production.
//
//  Chacun peut donc toujours se connecter, et s'enrôler lui-même. Ce n'est
//  qu'ensuite que l'administration s'ouvre.
// ════════════════════════════════════════════════════════════════════════════

/** Rôles pour lesquels le second facteur conditionne l'accès à l'administration. */
export const ROLES_2FA_REQUIS: ReadonlySet<Role> = new Set<Role>([
  "gestionnaire",
  "administrateur",
]);

/** Chemin de l'écran d'enrôlement — hors du périmètre du garde, par construction. */
export const CHEMIN_ENROLEMENT = "/mon-compte/securite";

/** Ce rôle doit-il disposer d'un second facteur pour accéder à l'administration ? */
export function exige2FA(role: Role | undefined): boolean {
  return !!role && ROLES_2FA_REQUIS.has(role);
}
