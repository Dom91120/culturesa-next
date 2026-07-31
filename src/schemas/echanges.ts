import { z } from "zod";

/**
 * Frontières de saisie de l'écran « Échanges » (constat S3).
 *
 * ── Ce que ce module corrige ──
 * Les mêmes règles vivaient en DEUX exemplaires, écrites à la main dans
 * `createMailTypeAction` et `updateMailTypeAction` : `trim()` au fil de l'eau,
 * plafonds recopiés (100 / 300 / 200). Aucune faille — mais une duplication de
 * limites est une divergence en attente : il suffit d'en relever une seule pour
 * qu'un libellé enregistré à la création devienne non ré-enregistrable à la
 * modification. C'est exactement ce qui était arrivé aux plafonds d'identité
 * avant l'audit du 17 juillet (cf. `schemas/user.ts`).
 *
 * ── Ce que ce module ne fait PAS, et pourquoi ──
 * Le constat recommandait « un schéma Zod par frontière d'action, sans
 * exception ». Les prédicats de domaine existants — `isBookingTrigger`,
 * `isBookingKind`, `isMailRecipientKind` — ne sont PAS convertis : ce sont déjà
 * des validations, adossées aux constantes qui font autorité. Les redire en
 * `z.enum([...])` créerait une seconde source de vérité à tenir synchronisée,
 * soit précisément le défaut que ce constat dénonce. Uniformiser la FORME au prix
 * d'un doublon serait un recul déguisé en rangement.
 */

// ── Métadonnées d'un type d'e-mail ──
// Plafonds inchangés (100 / 300 / 200) : le but est de les écrire UNE fois, pas de
// les durcir. Modifier une limite ici la modifie partout, ce qui était le problème.
export const mailTypeMetaSchema = z.object({
  label: z.string().trim().min(1, "Libellé requis.").max(100, "Champ trop long."),
  description: z.string().trim().max(300, "Champ trop long.").default(""),
  recipient: z.string().trim().max(200, "Champ trop long.").default(""),
});

// ── Contenu d'un gabarit ──
// `typeof subject !== "string"` était un contrôle d'exécution répétant une promesse
// déjà faite par le typage — utile face à un appel forgé, mais écrit à la main.
// L'assainissement du HTML reste à part (BAC1/S1) : ceci borne la TAILLE, pas le
// contenu ; les deux contrôles répondent à des menaces différentes.
export const mailTemplateSchema = z.object({
  subject: z.string().max(500, "Contenu trop long."),
  html: z.string().max(50_000, "Contenu trop long."),
});

/**
 * Liste d'adresses fixes destinataires, saisie séparée par des virgules.
 *
 * L'ancienne règle gardait toute entrée contenant un « @ » et **jetait les autres
 * en silence**. Une faute de frappe disparaissait donc sans un mot, et
 * l'administrateur croyait avoir enregistré une adresse qui ne recevrait jamais
 * rien — un défaut de notification ne se remarque pas, contrairement à un refus.
 *
 * Désormais : chaque entrée est validée, et une entrée invalide fait ÉCHOUER
 * l'enregistrement en la nommant. Plus strict à la saisie, mais c'est le seul
 * moment où l'erreur est encore corrigeable.
 *
 * Les configurations déjà enregistrées ne sont pas revalidées : la règle ne
 * s'applique qu'aux modifications.
 */
export const adressesFixesSchema = z
  .string()
  .transform((s) =>
    s
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean),
  )
  .pipe(
    z.array(z.email("Adresse e-mail invalide.")).min(1, "Renseignez au moins une adresse e-mail."),
  )
  .transform((liste) => liste.join(", "));
