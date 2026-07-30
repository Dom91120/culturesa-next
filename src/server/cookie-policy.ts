/**
 * Politique du cookie de session (constat A5).
 *
 * ── Le défaut corrigé ──
 * Better Auth déduisait l'attribut `Secure` du schéma de `baseURL` : présent si et
 * seulement si `BETTER_AUTH_URL` commence par « https:// ». Or le conteneur sert
 * l'application en HTTP sur 127.0.0.1:3000, derrière un proxy TLS externe. Renseigner
 * l'URL avec le schéma RÉELLEMENT servi par le conteneur n'est pas seulement une
 * erreur plausible : c'est le réflexe naturel. Et elle retirait `Secure` **sans
 * message, sans journal, sans échec** — le cookie de session serait parti en clair.
 *
 * Ce qui protège ne doit pas dépendre d'une variable d'environnement dont ce n'est
 * pas l'objet. La déduction est donc remplacée par une règle explicite.
 *
 * ── Pourquoi une échappatoire ──
 * Un `Secure` inconditionnel casserait toute connexion sur un déploiement servi en
 * HTTP : le navigateur refuse d'émettre un cookie `Secure` en clair, et l'usager
 * verrait un formulaire qui se recharge indéfiniment sans message d'erreur.
 * `TRUSTED_ORIGINS` documente justement un tel usage (accès LAN en http://…).
 *
 * Sûr par défaut, contournable EXPLICITEMENT, et jamais en silence — l'inverse exact
 * du défaut d'origine, où une variable mal renseignée suffisait à retirer la
 * protection sans que rien ne l'annonce. **Une échappatoire qui s'annonce vaut mieux
 * qu'une déduction qui se trompe sans le dire.**
 */
export function cookiesSecurises(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production" && env.ALLOW_INSECURE_COOKIES !== "true";
}

/** Vrai lorsque la protection est levée alors qu'on est en production : à signaler. */
export function alerteCookiesNonSecurises(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production" && !cookiesSecurises(env);
}

/**
 * Attributs figés, écrits même lorsqu'ils coïncident avec les défauts de la
 * bibliothèque : un défaut peut changer à la faveur d'une mise à jour, une valeur
 * écrite ne change que si quelqu'un la modifie — et cette modification se voit en
 * revue. C'est la même exigence que pour `Secure` : non pas « est-ce correct
 * aujourd'hui », mais « qu'est-ce qui le maintient correct demain ».
 */
export const ATTRIBUTS_COOKIE = {
  httpOnly: true,
  /**
   * `lax` et NON `strict`. Les liens de confirmation d'adresse et de réinitialisation
   * de mot de passe arrivent depuis un client de messagerie, donc en navigation
   * inter-site. Avec `strict`, le cookie ne serait pas transmis et l'usager
   * retomberait sur l'écran de connexion après avoir cliqué son lien — un parcours
   * cassé qu'on finirait par « réparer » en abaissant l'attribut, plus bas encore.
   */
  sameSite: "lax",
  path: "/",
} as const;
