import { randomBytes } from "node:crypto";

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

/** Référence courte, sans signification : elle ne sert qu'à relier écran et journal. */
function reference(): string {
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
export function messageClient(e: unknown, fallback: string, contexte: string): string {
  if (e instanceof UserFacingError) return e.message;
  const ref = reference();
  console.error(`[${contexte}] réf. ${ref} —`, e);
  return `${fallback} (référence ${ref})`;
}
