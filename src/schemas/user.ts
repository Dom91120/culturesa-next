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
export const nomSchema = z.string().trim().max(100);
export const telSchema = z.string().trim().max(30);

// ── Invariant « compte utilisateur » : au moins 1 enfant ET 1 accompagnant ──
// (Ne concerne pas les gestionnaires/administrateurs — le gate est chez l'appelant.)
export const PROFILE_MIN_ENFANTS_MSG = "Au moins 1 enfant est requis.";
export const PROFILE_MIN_ACCOMPAGNANTS_MSG = "Au moins 1 accompagnant est requis.";

/** Compteur de profil valide : entier ≥ 1. */
export const profileCountOk = (n: number): boolean => Number.isInteger(n) && n >= 1;
