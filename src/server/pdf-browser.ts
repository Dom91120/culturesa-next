/**
 * Options de lancement de Chromium pour la génération des PDF (constat D3).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  Pourquoi `--no-sandbox` reste le défaut, et pourquoi ce n'est PAS un renoncement
 * ─────────────────────────────────────────────────────────────────────────────
 * Le bac à sable de Chromium est sa principale barrière. Il était désactivé par un
 * simple commentaire « requis en conteneur / root », inexact : le conteneur tourne
 * en `nextjs` (uid 1001), pas en root.
 *
 * La cause réelle a été MESURÉE (image Alpine identique, 2026-07-30) :
 *
 *   chrome-sandbox est bien setuid root ......................... présent
 *   bac à sable, profil seccomp Docker par défaut ............... ÉCHEC
 *     « Failed to move to new namespace: … Operation not permitted »
 *   bac à sable + CAP_SYS_ADMIN ................................. OK
 *   bac à sable + seccomp=unconfined ............................ OK
 *
 * Autrement dit : le profil seccomp par défaut de Docker interdit la création
 * d'espaces de noms utilisateur, dont le bac à sable a besoin.
 *
 * ── Les deux moyens de le rétablir ont été ÉCARTÉS, chacun pour sa raison ──
 *
 * `--cap-add=SYS_ADMIN` : la capacité s'applique à TOUT le conteneur, donc aussi
 * au processus Node qui sert l'intégralité du trafic HTTP — une surface d'attaque
 * sans commune mesure avec celle du moteur de rendu. On échangerait un risque
 * étroit (faille Chromium déclenchée par du texte échappé dans une page interne)
 * contre l'amplification de TOUS les autres. `SYS_ADMIN` est proche de root.
 *
 * `seccomp=unconfined` : retire le filtrage d'appels système du conteneur entier.
 * Même raisonnement, en pire.
 *
 * ── Ce qui est fait à la place : réduire ce qu'une évasion rapporterait ──
 * Le conteneur applicatif tourne désormais sans AUCUNE capacité (`cap_drop: ALL`)
 * et sans possibilité d'élévation (`no-new-privileges`) — cf. docker-compose.yml.
 * Le filtrage seccomp par défaut reste actif. Un moteur de rendu compromis
 * s'exécute donc sous un compte non privilégié, dépourvu de capacités et incapable
 * d'en acquérir.
 *
 * Cela ne remplace pas le bac à sable. La mesure qui le remplacerait vraiment est
 * l'isolement de la génération PDF dans un conteneur dédié, sans accès à la base
 * ni aux secrets — consignée comme reste ouvert du constat.
 *
 * ── Rétablir le bac à sable, si l'hôte le permet un jour ──
 * `PUPPETEER_SANDBOX=true` suffit CÔTÉ APPLICATION, mais ne fonctionnera qu'avec un
 * profil seccomp autorisant les espaces de noms utilisateur, ET en retirant
 * `no-new-privileges` du conteneur — qui empêche par construction le binaire setuid
 * `chrome-sandbox` de s'élever. Les deux vont ensemble : activer la variable seule
 * ferait échouer toute génération de PDF.
 */

/** Bac à sable actif ? Explicite, jamais déduit — cf. le défaut corrigé en A5. */
export function sandboxActif(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PUPPETEER_SANDBOX === "true";
}

export function argsChromium(env: NodeJS.ProcessEnv = process.env): string[] {
  return [
    // Sans bac à sable : les deux drapeaux vont ensemble, en désactiver un seul
    // laisse Chromium tenter l'autre voie et échouer au démarrage.
    ...(sandboxActif(env) ? [] : ["--no-sandbox", "--disable-setuid-sandbox"]),

    // /dev/shm vaut 64 Mo par défaut dans un conteneur : Chromium y écrit ses
    // tampons de rendu et s'y écrase sur les gros documents. Ce drapeau le fait
    // basculer sur /tmp. Autant une correction de robustesse qu'un durcissement —
    // une édition volumineuse échouait sans message clair.
    "--disable-dev-shm-usage",

    // Aucune carte graphique dans le conteneur : le code d'accélération est du
    // code exposé qui ne sert à rien ici.
    "--disable-gpu",

    // Aucune extension n'est installée ; le sous-système qui les charge reste
    // néanmoins actif. On le retire.
    "--disable-extensions",
  ];
}
