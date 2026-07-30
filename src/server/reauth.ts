import { verifyPassword } from "better-auth/crypto";
import { prisma } from "@/server/db";
import { getSession } from "@/server/guards";

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
