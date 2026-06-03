/**
 * Politique de mot de passe (source unique, partagée client + serveur) :
 * 12 caractères minimum, dont au moins une majuscule, une minuscule, un chiffre
 * et un caractère spécial. Utilisée par :
 *  - les formulaires (inscription, réinitialisation) pour le retour visuel ;
 *  - le hook Better Auth (`auth.ts`) pour l'enforcement serveur (anti-bypass).
 */
export const PWD_RULES = [
  { key: "length", label: "12 caractères", test: (p: string) => p.length >= 12 },
  { key: "upper", label: "1 majuscule", test: (p: string) => /[A-Z]/.test(p) },
  { key: "lower", label: "1 minuscule", test: (p: string) => /[a-z]/.test(p) },
  { key: "digit", label: "1 chiffre", test: (p: string) => /[0-9]/.test(p) },
  { key: "special", label: "1 caractère spécial", test: (p: string) => /[^A-Za-z0-9]/.test(p) },
] as const;

/** Le mot de passe respecte-t-il TOUTES les règles de la politique ? */
export function isPasswordValid(password: string): boolean {
  return PWD_RULES.every((rule) => rule.test(password));
}

/** Message d'erreur affiché quand la politique n'est pas respectée. */
export const PASSWORD_POLICY_MESSAGE =
  "Le mot de passe doit contenir au moins 12 caractères, dont une majuscule, une minuscule, un chiffre et un caractère spécial.";
