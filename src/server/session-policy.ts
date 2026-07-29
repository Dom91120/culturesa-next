import type { Role } from "@/generated/prisma/client";

// ════════════════════════════════════════════════════════════════════════════
//  Politique de session — SOURCE UNIQUE (partagée par server/auth.ts et
//  server/guards.ts). Logique pure : aucune I/O, testable isolément.
//
//  Deux limites indépendantes, appliquées PAR RÔLE :
//    - INACTIVITÉ : temps écoulé depuis la dernière action réelle de l'usager ;
//    - ABSOLUE    : âge total de la session, activité ou non (une session
//                   entretenue en continu ne doit pas vivre indéfiniment).
//
//  ── Pourquoi l'application ne délègue PAS l'inactivité à Better Auth ──
//  Better Auth fait glisser `expiresAt` de lui-même (`session.expiresIn` /
//  `updateAge`), mais deux comportements rendent ce mécanisme inexploitable
//  comme délai d'inactivité :
//
//   1. Le plugin `nextCookies()` DÉSACTIVE le renouvellement sur les requêtes
//      RSC (en-tête `RSC: 1` sans `next-action`, cf. integrations/next-js.mjs) :
//      il ne peut pas poser de cookie pendant le rendu d'un Server Component.
//      Une navigation client via <Link> ne prolongerait donc PAS la session —
//      un gestionnaire qui consulte sans rien modifier serait déconnecté en
//      pleine activité.
//   2. À l'inverse, le sondage automatique des grilles (/api/agenda-version)
//      est un simple fetch : il renouvellerait la session indéfiniment, y
//      compris devant un poste inoccupé — exactement ce que l'inactivité doit
//      détecter. (Cf. `getSessionNoTouch` dans server/guards.ts.)
//
//  L'application marque donc elle-même l'activité (colonne `session.updatedAt`)
//  et arbitre ici. `SESSION_EXPIRES_IN` ne sert plus qu'à la durée de vie du
//  cookie porteur : c'est le serveur qui décide de la validité.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Durée de vie du cookie de session et de la ligne `session` côté Better Auth.
 * Doit rester ≥ au plus grand plafond absolu ci-dessous : c'est la politique
 * applicative qui tranche, jamais l'expiration du porteur.
 */
export const SESSION_EXPIRES_IN = 24 * 60 * 60; // 24 h

/** Périodicité du renouvellement interne de Better Auth (bookkeeping du cookie). */
export const SESSION_UPDATE_AGE = 60 * 60; // 1 h

/**
 * Seuil de « session fraîche ». Better Auth s'en sert pour les opérations
 * sensibles ; base du durcissement des actions destructrices (constat BAC3).
 */
export const SESSION_FRESH_AGE = 15 * 60; // 15 min

/**
 * L'activité n'est écrite en base qu'une fois par tranche : borne les écritures
 * à ~1/min par session active. Fixe aussi la GRANULARITÉ du délai d'inactivité —
 * l'inactivité réelle tolérée vaut donc `MAX_IDLE - TOUCH_THROTTLE` au pire.
 */
export const TOUCH_THROTTLE_MS = 60_000; // 1 min

/** Inactivité maximale tolérée, par rôle. */
export const MAX_IDLE_MS: Record<Role, number> = {
  utilisateur: 2 * 60 * 60 * 1000, // 2 h
  gestionnaire: 15 * 60 * 1000, // 15 min
  administrateur: 15 * 60 * 1000, // 15 min — mêmes privilèges d'écriture
};

/** Durée de vie maximale d'une session, quelle que soit l'activité. */
export const MAX_ABSOLUTE_MS: Record<Role, number> = {
  utilisateur: 24 * 60 * 60 * 1000, // 24 h
  gestionnaire: 8 * 60 * 60 * 1000, // 8 h — une journée de travail
  administrateur: 8 * 60 * 60 * 1000,
};

/** Rôle par défaut si la session n'en porte pas (le moins privilégié gagne). */
const FALLBACK_ROLE: Role = "utilisateur";

/** Rôle effectif : repli sur le MOINS privilégié si absent ou inconnu. */
function effectiveRole(role: Role | undefined): Role {
  return role && role in MAX_IDLE_MS ? role : FALLBACK_ROLE;
}

export type SessionVerdict = "ok" | "idle" | "absolute";

/**
 * Une session doit-elle être révoquée ?
 *  - `idle`     : trop longtemps sans action de l'usager ;
 *  - `absolute` : ouverte depuis trop longtemps, même entretenue ;
 *  - `ok`       : valide.
 *
 * `lastSeenAt` = dernière activité constatée (session.updatedAt) ;
 * `createdAt`  = ouverture de la session.
 */
export function checkSessionPolicy(
  role: Role | undefined,
  lastSeenAt: Date,
  createdAt: Date,
  now: number = Date.now(),
): SessionVerdict {
  const r = effectiveRole(role);
  if (now - createdAt.getTime() > MAX_ABSOLUTE_MS[r]) return "absolute";
  if (now - lastSeenAt.getTime() > MAX_IDLE_MS[r]) return "idle";
  return "ok";
}

/**
 * Échéance de la session (epoch ms) : la plus PROCHE des deux limites.
 *
 * Transmise au client (components/session-watchdog.tsx) pour programmer le retour
 * sur l'écran de connexion. Ce n'est qu'un HORAIRE DE RÉVEIL, pas une décision :
 * à l'échéance le client interroge /api/session-status, seul juge de la validité.
 * Une échéance légèrement décalée (activité écrite avec le throttle) ne provoque
 * donc jamais de déconnexion à tort.
 */
export function sessionDeadlineAt(
  role: Role | undefined,
  lastSeenAt: Date,
  createdAt: Date,
): number {
  const r = effectiveRole(role);
  return Math.min(lastSeenAt.getTime() + MAX_IDLE_MS[r], createdAt.getTime() + MAX_ABSOLUTE_MS[r]);
}

/** L'activité doit-elle être réécrite en base ? (throttle des écritures) */
export function shouldTouch(lastSeenAt: Date, now: number = Date.now()): boolean {
  return now - lastSeenAt.getTime() >= TOUCH_THROTTLE_MS;
}
