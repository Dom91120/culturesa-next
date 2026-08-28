import { z } from "zod";

/**
 * Profil de compte : règles UNIQUES partagées par l'inscription (hook Better Auth +
 * formulaire public), l'admin utilisateurs (action + modale) et « Mon compte ».
 * Avant l'audit 2026-07-17 : l'invariant « ≥1 enfant ET ≥1 accompagnant » vivait en
 * 4 exemplaires avec 3 formulations, et les plafonds d'identité divergeaient
 * (80 côté usager vs 100 côté admin — un prénom saisi par l'admin pouvait devenir
 * non ré-enregistrable par l'usager lui-même).
 */

// ── Identité (plafonds alignés : 100 / 100 / 30) ──
export const prenomSchema = z.string().trim().max(100);
// Convention « NOM Prénom » : le nom de famille est normalisé en MAJUSCULES au
// point d'entrée commun (inscription, admin, « Mon compte »), les champs de
// saisie se contentant de refléter la règle à la frappe. `.toUpperCase()` reste
// un ZodString : `nomSchema.min(1, …)` chaîne toujours côté création admin.
export const nomSchema = z.string().trim().toUpperCase().max(100);
export const telSchema = z.string().trim().max(30);

// ── Invariant « compte utilisateur » : au moins 1 enfant ET 1 accompagnant ──
// (Ne concerne pas les gestionnaires/administrateurs — le gate est chez l'appelant.)
export const PROFILE_MIN_ENFANTS_MSG = "Au moins 1 enfant est requis.";
export const PROFILE_MIN_ACCOMPAGNANTS_MSG = "Au moins 1 accompagnant est requis.";

/** Compteur de profil valide : entier ≥ 1. */
export const profileCountOk = (n: number): boolean => Number.isInteger(n) && n >= 1;

// ── Structure saisie librement (catégorie `structureLibre`, ex. « Autres ») ──
//
// Le libellé saisi devient une `Structure` de la catégorie : il n'est donc pas un
// simple texte de profil, mais une entrée de RÉFÉRENTIEL créée depuis un formulaire
// public. Deux conséquences, portées ici pour que le formulaire et le hook Better
// Auth appliquent exactement la même règle :
//   - une normalisation stricte des espaces, sans quoi « École  Verte » et
//     « École Verte » créeraient deux entrées que rien ne distinguerait à l'œil ;
//   - un plafond aligné sur celui du référentiel (`structureSchema`, 150), pour
//     qu'une saisie acceptée ici reste ré-enregistrable par l'administration.
export const STRUCTURE_LIBRE_MAX = 150;
export const STRUCTURE_LIBRE_MSG = "Indiquez le nom de votre structure.";

/** En-tête de transport du libellé saisi (même mécanique que le captcha). */
export const STRUCTURE_LIBRE_HEADER = "x-structure-libre";

/** Espaces normalisés, bornes appliquées. Renvoie "" si la saisie est vide. */
export function normaliserStructureLibre(valeur: unknown): string {
  if (typeof valeur !== "string") return "";
  return valeur.replace(/\s+/g, " ").trim().slice(0, STRUCTURE_LIBRE_MAX);
}
