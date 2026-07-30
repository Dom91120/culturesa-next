import type { Prisma } from "@/generated/prisma/client";
import { hmacSign } from "@/server/crypto";
import { prisma } from "@/server/db";

// ════════════════════════════════════════════════════════════════════════════
//  Freinage des tentatives de connexion, PAR COMPTE (constat A1).
//
//  Le rate-limit de Better Auth est calé sur l'IP. Il ne voit donc pas le
//  *password spraying* — un mot de passe courant essayé sur beaucoup de comptes
//  différents : chaque tentative vise un compte distinct, et le quota par IP
//  n'est jamais atteint. C'est l'attaque la plus rentable contre un portail
//  municipal, où les adresses sont devinables.
//
//  ── Un délai qui croît, pas un verrou ──
//  Bloquer un compte après N échecs transforme la protection en arme : il suffit
//  d'échouer volontairement pour empêcher quelqu'un de se connecter. On impose
//  donc une ATTENTE qui double à chaque échec, plafonnée. L'attaquant est ramené
//  à quelques essais par heure ; l'usager qui se trompe attend au pire quelques
//  minutes, et retrouve l'accès seul.
//
//  ── Pourquoi une empreinte et non l'e-mail ──
//  La table est indexée sur un HMAC de l'adresse, jamais sur l'adresse :
//   1. le freinage s'applique à l'identique que le compte existe ou non — sans
//      quoi la différence de comportement révélerait quelles adresses sont
//      inscrites (énumération de comptes) ;
//   2. on n'accumule pas les adresses de gens qui se sont trompés de site, ce
//      qui serait une collecte de données personnelles sans finalité.
// ════════════════════════════════════════════════════════════════════════════

/** Échecs consécutifs tolérés avant que l'attente ne commence. */
export const FREE_ATTEMPTS = 5;

/** Attente après le premier échec au-delà du seuil. Double ensuite. */
export const BASE_DELAY_MS = 60_000; // 1 min

/**
 * Plafond de l'attente. Volontairement modeste : au-delà, on gêne surtout
 * l'usager légitime. 15 minutes ramènent déjà un attaquant à ~4 essais/heure
 * et par compte, ce qui rend le bruteforce sans objet.
 */
export const MAX_DELAY_MS = 15 * 60_000;

/**
 * Au-delà de ce délai sans échec, le compteur est considéré comme périmé et
 * repart de zéro : trois fautes de frappe étalées sur six mois ne doivent pas
 * se cumuler jusqu'au blocage.
 */
export const COUNTER_TTL_MS = 12 * 60 * 60_000; // 12 h

/**
 * Attente imposée après `failures` échecs consécutifs. `0` tant que le seuil
 * n'est pas franchi. Doublement plafonné (1, 2, 4, 8, 15, 15… minutes).
 */
export function delayForFailures(failures: number): number {
  if (failures <= FREE_ATTEMPTS) return 0;
  const steps = failures - FREE_ATTEMPTS - 1;
  return Math.min(BASE_DELAY_MS * 2 ** steps, MAX_DELAY_MS);
}

/** Le compteur est-il périmé (aucun échec depuis COUNTER_TTL_MS) ? */
export function isCounterStale(lastFailureAt: Date, now: number = Date.now()): boolean {
  return now - lastFailureAt.getTime() > COUNTER_TTL_MS;
}

/**
 * Secondes d'attente restantes, ou 0 si la connexion est permise.
 * Un compteur périmé n'oppose aucune attente, quel que soit son contenu.
 */
export function remainingLockSeconds(
  entry: { failures: number; lockedUntil: Date | null; lastFailureAt: Date } | null,
  now: number = Date.now(),
): number {
  if (!entry?.lockedUntil) return 0;
  if (isCounterStale(entry.lastFailureAt, now)) return 0;
  const remaining = entry.lockedUntil.getTime() - now;
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

/** Empreinte stable d'une adresse, sous une clé dédiée (cf. server/crypto). */
export function emailFingerprint(email: string): string {
  return hmacSign("login-throttle", email.trim().toLowerCase());
}

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Attente restante pour cette adresse, en secondes. 0 = connexion permise.
 * Best-effort : une erreur de base ne doit pas empêcher de se connecter — le
 * quota par IP de Better Auth reste en place comme second filet.
 */
export async function loginLockSeconds(email: string, db: Db = prisma): Promise<number> {
  try {
    const entry = await db.loginAttempt.findUnique({
      where: { emailHash: emailFingerprint(email) },
      select: { failures: true, lockedUntil: true, lastFailureAt: true },
    });
    return remainingLockSeconds(entry);
  } catch (e) {
    console.error("[login-throttle] lecture impossible:", e);
    return 0;
  }
}

/** Enregistre un échec et arme l'attente suivante. Best-effort. */
export async function recordLoginFailure(email: string, db: Db = prisma): Promise<void> {
  const emailHash = emailFingerprint(email);
  const now = new Date();
  try {
    const entry = await db.loginAttempt.findUnique({
      where: { emailHash },
      select: { failures: true, lastFailureAt: true },
    });
    // Compteur périmé → on repart de 1 plutôt que de poursuivre une série
    // vieille de plusieurs mois.
    const previous = entry && !isCounterStale(entry.lastFailureAt) ? entry.failures : 0;
    const failures = previous + 1;
    const delay = delayForFailures(failures);
    const data = {
      failures,
      lastFailureAt: now,
      lockedUntil: delay > 0 ? new Date(now.getTime() + delay) : null,
    };
    await db.loginAttempt.upsert({
      where: { emailHash },
      create: { emailHash, ...data },
      update: data,
    });
  } catch (e) {
    console.error("[login-throttle] enregistrement impossible:", e);
  }
}

/**
 * Efface le compteur après une connexion réussie : seuls les échecs CONSÉCUTIFS
 * comptent. Sans cela, un usager qui se trompe régulièrement finirait bloqué
 * alors qu'il se connecte correctement entre-temps.
 */
export async function clearLoginFailures(email: string, db: Db = prisma): Promise<void> {
  try {
    await db.loginAttempt.deleteMany({ where: { emailHash: emailFingerprint(email) } });
  } catch (e) {
    console.error("[login-throttle] réinitialisation impossible:", e);
  }
}

/**
 * Purge les compteurs périmés. Appelé par la tâche planifiée de rétention RGPD :
 * la table n'a pas vocation à croître indéfiniment.
 */
export async function purgeStaleLoginAttempts(db: Db = prisma): Promise<number> {
  const cutoff = new Date(Date.now() - COUNTER_TTL_MS);
  const { count } = await db.loginAttempt.deleteMany({ where: { lastFailureAt: { lt: cutoff } } });
  return count;
}
