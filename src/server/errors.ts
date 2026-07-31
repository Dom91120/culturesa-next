import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { journal } from "@/server/log";

/**
 * Erreurs destinées à être LUES PAR L'USAGER (constat D7).
 *
 * ── Le défaut corrigé ──
 * Les actions de sauvegarde renvoyaient `e.message` quel qu'il soit. Or `run()`
 * rejette avec la **sortie d'erreur brute de `pg_dump` / `psql`** : versions, chemins
 * absolus, noms de rôles, détails de schéma se retrouvaient dans l'interface.
 *
 * ── Pourquoi ne pas tout remplacer par un message générique ──
 * Parce que ce serait pire. Un administrateur qui restaure une sauvegarde DOIT savoir
 * pourquoi elle échoue : « mauvaise clé de chiffrement » et « fichier tronqué »
 * appellent des gestes opposés. Rendre l'opération la plus critique de l'application
 * indiagnosticable au nom de la discrétion échangerait un risque théorique — ces
 * écrans sont réservés aux administrateurs — contre une panne bien réelle.
 *
 * Le tri ne se fait donc pas sur la gravité mais sur l'INTENTION : un message écrit
 * pour être lu passe, un message produit par un outil ne passe pas.
 *
 * ── Ce que voit l'usager quand le message ne lui est pas destiné ──
 * Un libellé générique ET une **référence courte**, journalisée avec l'erreur
 * complète côté serveur. L'administrateur peut la citer à l'exploitant, qui retrouve
 * la trace exacte. Sans elle, « une erreur est survenue » serait indiagnosticable —
 * on aurait remplacé une fuite par un mur.
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

/**
 * Référence reliant l'écran au journal.
 *
 * On reprend l'IDENTIFIANT DE REQUÊTE posé par le middleware (constat D8) : la
 * référence citée par l'administrateur désigne alors *toute* la requête, donc
 * l'ensemble de ses lignes de journal — et non le seul instant de l'erreur. Elle
 * figure aussi dans l'en-tête `x-request-id` de la réponse.
 *
 * Repli sur un aléa local si l'en-tête manque (appel hors contexte de requête,
 * chemin non couvert par le middleware) : mieux vaut une référence isolée que pas
 * de référence du tout — sans elle, « une erreur est survenue » est indiagnosticable.
 */
async function reference(): Promise<string> {
  try {
    const id = (await headers()).get("x-request-id");
    if (id) return id;
  } catch {
    // Hors contexte de requête : `headers()` lève. Ce n'est pas une anomalie.
  }
  return randomBytes(3).toString("hex").toUpperCase();
}

/**
 * Message affichable pour une erreur interceptée.
 *
 * - `UserFacingError` (et ses sous-classes) → son message, tel quel ;
 * - tout le reste → `fallback` suivi d'une référence, l'erreur complète partant au
 *   journal serveur sous la même référence.
 *
 * `contexte` préfixe la ligne de journal (ex. « backup:restore ») : sans lui, une
 * pile d'exception sans origine oblige à deviner d'où elle vient.
 */
export async function messageClient(
  e: unknown,
  fallback: string,
  contexte: string,
): Promise<string> {
  if (e instanceof UserFacingError) return e.message;
  const ref = await reference();
  journal.erreur(contexte, fallback, { req: ref, erreur: e });
  return `${fallback} (référence ${ref})`;
}
