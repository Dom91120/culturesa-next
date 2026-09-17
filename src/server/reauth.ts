import { verifyPassword } from "better-auth/crypto";
import { prisma } from "@/server/db";
import { getSession } from "@/server/guards";
import { rateLimit } from "@/server/rate-limit";

// ════════════════════════════════════════════════════════════════════════════
//  Ré-authentification avant les actes destructeurs (constat BAC3).
//
//  Ces opérations — remplacer la base, supprimer un service et ses réservations,
//  anonymiser en masse, changer un rôle, modifier les identifiants SMTP — sont
//  irréversibles ou quasi. Un simple cookie de session suffisait à les déclencher :
//  un poste laissé ouvert, une session volée, et l'affaire était jouée.
//
//  ── Pourquoi le mot de passe à chaque fois, et non une « session fraîche » ──
//  Une fenêtre de fraîcheur (« authentifié il y a moins de 15 min ») supposerait
//  de mémoriser un état de ré-authentification, donc une colonne de plus et un
//  raisonnement sur son expiration — davantage de pièces mobiles pour une
//  protection plus faible. Ces actes sont RARES : redemander le mot de passe à
//  chaque fois ne coûte presque rien à l'usage, et ne laisse aucune fenêtre.
//
//  ── Ce que cela protège, et ce que cela ne protège pas ──
//  Cela arrête une session volée ou un poste laissé sans surveillance — la
//  raison d'être du constat. Cela n'arrête PAS un administrateur dont le mot de
//  passe est connu de l'attaquant : c'est le rôle du second facteur (A6), qui
//  couvre justement ce cas pour les administrateurs.
// ════════════════════════════════════════════════════════════════════════════

/** Refus motivé, distinct d'une erreur métier : l'appelant l'affiche tel quel. */
export class ReauthError extends Error {}

// ── Freinage des tentatives (constat S1 de l'audit 2026-09-17) ──
// La ré-authentification ne passe PAS par /sign-in : ni le quota par IP de Better
// Auth ni le freinage par compte (login-throttle) ne la voient. Une session volée
// pouvait donc essayer des mots de passe à volonté contre son propre titulaire,
// exactement là où le mot de passe protège les actes les plus graves.
//
// Un seau par UTILISATEUR (pas par IP : c'est bien ce compte-là qu'on protège),
// à fenêtre fixe, en base (rate-limit.ts) : atomique, partagé entre réplicas, et
// ÉCHEC FERMÉ — base muette, refus. Le seau est vidé à chaque succès : seuls les
// échecs CONSÉCUTIFS comptent, comme pour la connexion.
/** Tentatives tolérées par fenêtre. Un administrateur qui se trompe cinq fois d'affilée attend. */
export const REAUTH_MAX_ATTEMPTS = 5;
/** Largeur de la fenêtre. */
export const REAUTH_WINDOW_MS = 15 * 60_000;
/** Message unique du refus par quota. */
export const REAUTH_THROTTLED_MSG = "Trop de tentatives, réessayez plus tard.";

/** Clé du seau de freinage d'un utilisateur. */
export function reauthThrottleKey(userId: string): string {
  return `reauth:${userId}`;
}

/**
 * Vérifie le mot de passe de l'usager CONNECTÉ avant un acte destructeur.
 * Lève `ReauthError` si la vérification échoue.
 *
 * La comparaison est déléguée à Better Auth (`verifyPassword`) : elle applique
 * le même scrypt et les mêmes paramètres que la connexion. Réimplémenter cette
 * vérification serait le meilleur moyen de la rendre subtilement fausse.
 */
export async function requireReauth(password: unknown): Promise<void> {
  if (typeof password !== "string" || password === "") {
    throw new ReauthError("Saisissez votre mot de passe pour confirmer.");
  }

  const session = await getSession();
  if (!session) throw new ReauthError("Session expirée. Reconnectez-vous.");

  // Le quota se consomme AVANT la comparaison : une fois franchi, la réponse est la
  // même que le mot de passe soit juste ou faux. Vérifier d'abord puis refuser
  // laisserait le temps de réponse (scrypt) trahir la validité de l'essai.
  const cle = reauthThrottleKey(session.user.id);
  if (!(await rateLimit(cle, REAUTH_MAX_ATTEMPTS, REAUTH_WINDOW_MS))) {
    throw new ReauthError(REAUTH_THROTTLED_MSG);
  }

  // Compte « credential » = couple e-mail/mot de passe. Un compte qui n'en a pas
  // (créé par un fournisseur externe, hypothétique ici) ne peut pas confirmer
  // ainsi : on refuse plutôt que de laisser passer faute de mot de passe à
  // comparer — l'absence de moyen de vérification n'est pas une vérification.
  const compte = await prisma.account.findFirst({
    where: { userId: session.user.id, providerId: "credential" },
    select: { password: true },
  });
  if (!compte?.password) {
    throw new ReauthError("Ce compte ne peut pas confirmer par mot de passe.");
  }

  const ok = await verifyPassword({ hash: compte.password, password });
  if (!ok) throw new ReauthError("Mot de passe incorrect.");

  // Succès : le seau est vidé, best-effort. Un échec ici ne doit pas refuser une
  // confirmation par ailleurs valide — au pire, le compteur garde quelques essais
  // de plus jusqu'à l'expiration de la fenêtre.
  try {
    await prisma.throttleBucket.deleteMany({ where: { key: cle } });
  } catch (e) {
    console.error("[reauth] remise à zéro du freinage impossible:", e);
  }
}

/**
 * Enveloppe pratique pour les server actions, qui renvoient toutes un
 * `{ ok, error? }` : convertit le refus en résultat au lieu d'une exception.
 * Renvoie `null` si la ré-authentification a réussi.
 */
export async function reauthOrError(
  password: unknown,
): Promise<{ ok: false; error: string } | null> {
  try {
    await requireReauth(password);
    return null;
  } catch (e) {
    if (e instanceof ReauthError) return { ok: false, error: e.message };
    console.error("[reauth] échec inattendu:", e);
    return { ok: false, error: "Vérification impossible. Réessayez." };
  }
}
