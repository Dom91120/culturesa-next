import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { emailButton } from "@/lib/email-theme";
import { greeting } from "@/lib/mail-render";
import { isPasswordValid, PASSWORD_POLICY_MESSAGE } from "@/lib/password";
import {
  PROFILE_MIN_ACCOMPAGNANTS_MSG,
  PROFILE_MIN_ENFANTS_MSG,
  profileCountOk,
} from "@/schemas/user";
import { verifyCaptcha } from "@/server/captcha";
import {
  ATTRIBUTS_COOKIE,
  alerteCookiesNonSecurises,
  cookiesSecurises,
} from "@/server/cookie-policy";
import { prisma } from "@/server/db";
import { clearLoginFailures, loginLockSeconds, recordLoginFailure } from "@/server/login-throttle";
import { sendTemplatedMail } from "@/server/services/mail-send";
import { SESSION_EXPIRES_IN, SESSION_FRESH_AGE, SESSION_UPDATE_AGE } from "@/server/session-policy";

// Endpoints Better Auth qui définissent/changent un mot de passe : on y impose la
// politique de complexité (Better Auth ne valide nativement que la longueur min).
const PASSWORD_ENDPOINTS = new Set(["/sign-up/email", "/reset-password", "/change-password"]);

/**
 * Envoie un e-mail de compte/sécurité (vérification d'adresse, réinitialisation de
 * mot de passe) à partir du gabarit éditable (onglet Échanges), habillé du thème.
 */
/**
 * Alerte « votre mot de passe a été modifié » (constat A7).
 *
 * Envoyée APRÈS coup, sur les DEUX chemins : réinitialisation par lien et
 * changement depuis le compte. Un attaquant qui prend un compte change le mot de
 * passe ; sans ce courriel, le titulaire légitime ne l'apprend qu'en découvrant
 * qu'il ne peut plus entrer — souvent bien plus tard.
 *
 * BEST-EFFORT, et c'est délibéré : un relais SMTP indisponible ne doit pas faire
 * échouer le changement de mot de passe. Refuser l'opération pour cause de
 * courriel non parti laisserait l'usager avec son ancien mot de passe, celui
 * qu'il cherche justement à remplacer.
 */
async function notifierMotDePasseModifie(userId: string, email: string): Promise<void> {
  try {
    const prenom =
      (
        await prisma.user.findUnique({ where: { id: userId }, select: { prenom: true } })
      )?.prenom?.trim() ?? "";
    // Heure de Paris explicite : le conteneur tourne en UTC, et une heure fausse
    // dans une alerte de sécurité fait douter de l'alerte, pas de l'heure.
    const date = new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "Europe/Paris",
    }).format(new Date());
    await sendTemplatedMail({
      to: email,
      kind: "password_changed",
      vars: { salutation: greeting(prenom), prenom, date },
      mode: "direct",
    });
  } catch (e) {
    console.error("[auth] alerte de changement de mot de passe non envoyée:", e);
  }
}

async function sendAccountMail(
  userId: string,
  email: string,
  kind: "email_verification" | "password_reset",
  url: string,
  buttonLabel: string,
) {
  const prenom =
    (
      await prisma.user.findUnique({ where: { id: userId }, select: { prenom: true } })
    )?.prenom?.trim() ?? "";
  const vars = { salutation: greeting(prenom), prenom, url };
  await sendTemplatedMail({
    to: email,
    kind,
    vars,
    rawVars: { bouton: emailButton(url, buttonLabel) },
    mode: "direct",
  });
}

/**
 * Configuration Better Auth.
 * - email/password avec vérification d'email obligatoire (comme l'ancien flux confirm.php)
 * - réinitialisation de mot de passe par email
 * - rate-limiting activé (remplace l'ancienne table auth_attempts)
 * - champs métier exposés sur le modèle User (cf. prisma/schema.prisma)
 */
// Protection levée en production → on le dit, fort. Le silence était le défaut d'A5.
if (alerteCookiesNonSecurises()) {
  console.warn(
    "[auth] ⚠️ ALLOW_INSECURE_COOKIES=true : le cookie de session part SANS l'attribut " +
      "Secure. À réserver à un accès en HTTP sur réseau de confiance ; sur une " +
      "installation exposée, toute interception du réseau donne accès à la session.",
  );
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,

  // Origines de confiance (anti-CSRF). Better Auth fait toujours confiance à
  // `baseURL` ; on AJOUTE ici :
  //   - en prod : la liste explicite de `TRUSTED_ORIGINS` (séparée par des virgules),
  //     ex. « http://192.168.1.102:3000 » pour un accès LAN derrière `npm run start` ;
  //   - en dev : l'origine de la requête est reflétée (confort de test multi-appareils).
  trustedOrigins: (request?: Request) => {
    const list = (process.env.TRUSTED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (process.env.NODE_ENV === "development") {
      const origin = request?.headers.get("origin");
      if (origin && !list.includes(origin)) list.push(origin);
    }
    return list;
  },

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 12,

    // ── Constat A7 ──────────────────────────────────────────────────────────────
    // Reprendre la main sur son mot de passe ne suffisait pas à reprendre la main
    // sur son COMPTE : un attaquant déjà connecté gardait sa session intacte. La
    // victime croyait avoir refermé la porte alors qu'il était toujours à
    // l'intérieur — et c'est précisément le scénario où quelqu'un change son mot
    // de passe : parce qu'il soupçonne quelque chose.
    revokeSessionsOnPasswordReset: true,

    // Notification APRÈS coup. C'est le seul signal qui permette à un usager de
    // découvrir une prise de contrôle : un attaquant qui change le mot de passe
    // n'a aucune raison de le lui dire.
    onPasswordReset: async ({ user }) => {
      await notifierMotDePasseModifie(user.id, user.email);
    },

    sendResetPassword: async ({ user, url }) => {
      await sendAccountMail(
        user.id,
        user.email,
        "password_reset",
        url,
        "Réinitialiser mon mot de passe",
      );
    },
  },

  // Durée de vie du COOKIE porteur et de la ligne `session`. Les délais réels
  // (inactivité 15 min gestionnaire/administrateur, 2 h usager ; plafonds absolus)
  // sont appliqués PAR RÔLE côté application — cf. server/session-policy.ts, qui
  // explique pourquoi le glissement natif de Better Auth ne peut pas tenir ce rôle.
  session: {
    expiresIn: SESSION_EXPIRES_IN,
    updateAge: SESSION_UPDATE_AGE,
    freshAge: SESSION_FRESH_AGE,
  },

  // Attributs du cookie de session, FIGÉS plutôt que déduits du schéma de `baseURL`
  // (constat A5). Règle, justification et échappatoire : server/cookie-policy.ts.
  advanced: {
    useSecureCookies: cookiesSecurises(),
    defaultCookieAttributes: ATTRIBUTS_COOKIE,
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendAccountMail(
        user.id,
        user.email,
        "email_verification",
        url,
        "Confirmer mon adresse e-mail",
      );
    },
  },

  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // Révocation des AUTRES sessions au changement de mot de passe (constat A7).
      //
      // Better Auth expose `revokeOtherSessions` dans le CORPS de la requête : il
      // dépend donc du client, qui pourrait l'omettre — un paramètre de sécurité
      // laissé à l'appelant n'est pas une garantie. On le force ici, côté serveur.
      //
      // On force le drapeau plutôt que de supprimer les sessions nous-mêmes : la
      // bibliothèque révoque, RECRÉE une session pour l'appelant et repose son
      // cookie. Le faire à la main déconnecterait celui qui vient de changer son
      // mot de passe — punir le geste qu'on veut encourager.
      if (ctx.path === "/change-password" && ctx.body && typeof ctx.body === "object") {
        (ctx.body as { revokeOtherSessions?: boolean }).revokeOtherSessions = true;
      }

      // Freinage PAR COMPTE (constat A1) : le quota de Better Auth étant calé sur
      // l'IP, il ne voit pas le password spraying — un mot de passe courant essayé
      // sur beaucoup de comptes, chaque tentative visant un compte différent.
      // Refus AVANT toute vérification de mot de passe : une tentative freinée ne
      // doit pas non plus consommer de temps de calcul scrypt.
      // Le freinage s'applique à l'identique que le compte existe ou non
      // (cf. login-throttle.ts) : le message ne révèle donc rien.
      if (ctx.path === "/sign-in/email" && ctx.request) {
        const email = (ctx.body as { email?: unknown } | undefined)?.email;
        if (typeof email === "string" && email) {
          const wait = await loginLockSeconds(email);
          if (wait > 0) {
            const minutes = Math.ceil(wait / 60);
            throw new APIError("TOO_MANY_REQUESTS", {
              message: `Trop de tentatives de connexion. Réessayez dans ${
                minutes <= 1 ? "une minute" : `${minutes} minutes`
              }.`,
            });
          }
        }
      }

      // CAPTCHA image auto-hébergé sur l'inscription (port de captcha_img.php du
      // legacy) : on vérifie le token signé + la saisie, transmis par en-têtes,
      // AVANT toute création de compte. Désactivable via CAPTCHA_DISABLED=true
      // (utile en tests/seed). Cf. src/server/captcha.ts.
      // `ctx.request` n'existe que pour les requêtes HTTP publiques : les appels
      // serveur internes (auth.api.signUpEmail par un administrateur, cf.
      // users/actions.ts) n'ont pas de captcha à présenter et en sont exemptés.
      if (ctx.path === "/sign-up/email" && ctx.request && process.env.CAPTCHA_DISABLED !== "true") {
        const ok = await verifyCaptcha(
          ctx.headers?.get("x-captcha-token"),
          ctx.headers?.get("x-captcha-answer"),
        );
        if (!ok) {
          throw new APIError("BAD_REQUEST", {
            message: "Code de vérification invalide ou expiré. Merci de recommencer.",
          });
        }
      }

      // À l'inscription publique (requête HTTP), la catégorie (demandeur) est
      // obligatoire, ainsi qu'une structure lui appartenant si la catégorie en a.
      // Enforcement serveur en plus du formulaire. La création par un administrateur
      // (appel interne sans Request) renseigne ces champs après coup : exemptée.
      if (ctx.path === "/sign-up/email" && ctx.request) {
        const b = (ctx.body ?? {}) as { demandeurId?: unknown; structureId?: unknown };
        const demandeurId = Number(b.demandeurId);
        if (!Number.isInteger(demandeurId) || demandeurId < 1) {
          throw new APIError("BAD_REQUEST", { message: "Choisissez une catégorie." });
        }
        // Existence vérifiée : un id inexistant (sans structure) partait sinon en
        // violation de FK à l'insert → 500 au lieu d'un 400 propre (audit 2026-07-19).
        const demandeur = await prisma.demandeur.findUnique({
          where: { id: demandeurId },
          select: { id: true },
        });
        if (!demandeur) {
          throw new APIError("BAD_REQUEST", { message: "Choisissez une catégorie." });
        }
        const structures = await prisma.structure.findMany({
          where: { demandeurId },
          select: { id: true },
        });
        if (structures.length > 0) {
          const structureId = Number(b.structureId);
          if (!structures.some((s) => s.id === structureId)) {
            throw new APIError("BAD_REQUEST", {
              message: "Choisissez une structure pour cette catégorie.",
            });
          }
        }
      }

      // À l'inscription publique, au moins 1 enfant ET 1 accompagnant sont
      // obligatoires. Enforcement serveur (en plus des contraintes du formulaire)
      // pour rejeter une requête qui contournerait la validation côté client.
      // La création par un administrateur (auth.api.signUpEmail, cf. users/actions.ts)
      // ne transmet pas ces champs et les renseigne ensuite : on n'impose donc le
      // minimum que lorsqu'ils sont effectivement fournis dans la requête.
      if (ctx.path === "/sign-up/email") {
        const b = (ctx.body ?? {}) as { enfants?: unknown; accompagnants?: unknown };
        if (b.enfants !== undefined || b.accompagnants !== undefined) {
          // Invariant + messages : source unique schemas/user (partagée avec le
          // formulaire d'inscription et l'admin utilisateurs).
          if (!profileCountOk(Number(b.enfants))) {
            throw new APIError("BAD_REQUEST", { message: PROFILE_MIN_ENFANTS_MSG });
          }
          if (!profileCountOk(Number(b.accompagnants))) {
            throw new APIError("BAD_REQUEST", { message: PROFILE_MIN_ACCOMPAGNANTS_MSG });
          }
        }
      }

      // Verrou sur /update-user : Better Auth expose cet endpoint authentifié qui
      // écrit dans la table `user` tout champ additionnel dépourvu de `input:false`.
      // Or `input:false` ne peut pas être posé sur demandeurId/structureId/enfants/
      // accompagnants — ils DOIVENT rester saisissables à l'inscription (body du
      // /sign-up/email). On interdit donc leur ré-écriture ICI : ce sont des champs
      // métier/sécurité (le demandeur effectif pilote le cloisonnement usager, la
      // jauge dépend de enfants/accompagnants) et l'app ne modifie le profil que via
      // ses propres server actions (mon-compte/updateProfileAction, users admin), pas
      // via /update-user. `role` est déjà couvert par input:false (defense in depth).
      if (ctx.path === "/update-user") {
        const b = (ctx.body ?? {}) as Record<string, unknown>;
        const locked = ["demandeurId", "structureId", "enfants", "accompagnants", "role", "rgpdOk"];
        if (locked.some((k) => k in b)) {
          throw new APIError("BAD_REQUEST", { message: "Champ non modifiable." });
        }
      }

      // Enforcement serveur de la politique de mot de passe (complexité), en plus du
      // minPasswordLength. Rejette tout mot de passe non conforme, y compris une
      // requête qui contournerait la validation côté formulaire.
      if (!PASSWORD_ENDPOINTS.has(ctx.path)) return;
      const body = (ctx.body ?? {}) as { password?: unknown; newPassword?: unknown };
      const pw = typeof body.password === "string" ? body.password : body.newPassword;
      if (typeof pw !== "string") return;
      if (!isPasswordValid(pw)) {
        throw new APIError("BAD_REQUEST", { message: PASSWORD_POLICY_MESSAGE });
      }
    }),

    // Comptage des échecs de connexion (constat A1). Les hooks `after` sont bien
    // exécutés quand l'endpoint échoue : l'erreur est capturée par le dispatcher
    // et déposée dans `ctx.context.returned` (cf. better-auth/dist/api/dispatch).
    after: createAuthMiddleware(async (ctx) => {
      // Changement de mot de passe depuis le compte : alerter le titulaire
      // (constat A7). La réinitialisation par lien passe, elle, par
      // `onPasswordReset` — deux chemins distincts dans Better Auth, une seule
      // alerte à écrire.
      if (ctx.path === "/change-password" && !(ctx.context.returned instanceof APIError)) {
        const u = (ctx.context.returned as { user?: { id?: string; email?: string } } | undefined)
          ?.user;
        if (u?.id && u.email) await notifierMotDePasseModifie(u.id, u.email);
        return;
      }

      if (ctx.path !== "/sign-in/email" || !ctx.request) return;
      const email = (ctx.body as { email?: unknown } | undefined)?.email;
      if (typeof email !== "string" || !email) return;

      // Un APIError en retour = identifiants refusés (ou compte non vérifié).
      // Tout le reste est un succès : on efface alors le compteur, seuls les
      // échecs CONSÉCUTIFS devant peser.
      const returned = ctx.context.returned;
      if (returned instanceof APIError) await recordLoginFailure(email);
      else await clearLoginFailures(email);
    }),
  },

  // Met à jour `lastLoginAt` à chaque création de session (= chaque connexion,
  // tous flux confondus). Alimente la détection d'inactivité RGPD (cf. rgpd.ts).
  databaseHooks: {
    session: {
      create: {
        after: async (session) => {
          try {
            await prisma.user.update({
              where: { id: session.userId },
              data: { lastLoginAt: new Date() },
            });
          } catch (e) {
            console.error("[auth] maj lastLoginAt échouée:", e);
          }
        },
      },
    },
  },

  // Limitation du débit des requêtes d'auth (anti-bruteforce).
  // Quota PAR IP (constat A1). Il ne remplace pas le freinage par compte
  // (login-throttle.ts) : l'un borne un attaquant qui martèle depuis une machine,
  // l'autre celui qui répartit ses essais sur beaucoup de comptes. Aucun des deux
  // ne couvre le cas de l'autre.
  //
  // `storage: "database"` (constat A3) : en mémoire, un redémarrage du conteneur
  // remettait tous les compteurs à zéro — il suffisait d'attendre un déploiement
  // pour repartir avec un quota neuf. Table `rate_limits` (cf. schema.prisma).
  rateLimit: {
    enabled: true,
    storage: "database",
    modelName: "rateLimit",
    // Régime général, inchangé : il couvre les endpoints d'auth peu sensibles.
    window: 60,
    max: 10,
    customRules: {
      // 10 tentatives par minute laissaient ~14 000 essais par jour et par IP.
      // Ce quota compte TOUTES les requêtes, succès compris — il ne peut donc pas
      // être aussi serré que le freinage par compte, qui ne compte que les échecs.
      // À 5 par 15 min, une mairie ou une école derrière une IP partagée (NAT)
      // n'aurait disposé que de 5 connexions par quart d'heure pour tout le
      // bâtiment. 20 borne encore un attaquant à ~80 essais/heure depuis une IP,
      // tandis que login-throttle.ts limite la profondeur compte par compte.
      "/sign-in/email": { window: 15 * 60, max: 20 },
      // Chaque appel déclenche un envoi d'e-mail : bride le harcèlement d'une
      // boîte tierce et la mise en liste noire du domaine de la Ville.
      "/forget-password": { window: 15 * 60, max: 3 },
      "/send-verification-email": { window: 15 * 60, max: 3 },
      // Création de compte : le captcha filtre déjà, le quota borne le reste.
      "/sign-up/email": { window: 60 * 60, max: 10 },
    },
  },

  // Champs métier additionnels persistés sur la table `user`.
  user: {
    additionalFields: {
      prenom: { type: "string", required: false, defaultValue: "" },
      nom: { type: "string", required: false, defaultValue: "" },
      tel: { type: "string", required: false, defaultValue: "" },
      niveau: { type: "string", required: false, defaultValue: "" },
      enfants: { type: "number", required: false, defaultValue: 0 },
      accompagnants: { type: "number", required: false, defaultValue: 0 },
      role: { type: "string", required: false, defaultValue: "utilisateur", input: false },
      rgpdOk: { type: "boolean", required: false, defaultValue: false },
      demandeurId: { type: "number", required: false },
      structureId: { type: "number", required: false },
    },
  },

  plugins: [
    // Second facteur TOTP (constat A6). Protège les comptes capables d'exporter
    // la base nominative complète. A1 ayant fermé le bruteforce, l'intérêt d'un
    // attaquant se déplace vers le vol de session et l'hameçonnage — que le
    // second facteur adresse, là où un mot de passe seul ne peut rien.
    //
    // L'activation est VOLONTAIRE (l'usager s'enrôle depuis « Mon compte ») ;
    // l'exigence pour les rôles privilégiés est appliquée par les gardes, qui
    // redirigent vers l'enrôlement au lieu de bloquer. Imposer le second facteur
    // sans chemin d'enrôlement aurait mis tout le monde dehors dès le
    // déploiement — les comptes existants n'ont aucun secret TOTP.
    twoFactor({
      issuer: "CultuRésa",
      // Le code n'est demandé qu'après vérification du mot de passe : le second
      // facteur s'ajoute au premier, il ne le remplace pas.
      skipVerificationOnEnable: false,
    }),
    // Doit rester en dernier : branche la gestion des cookies sur Next.js.
    nextCookies(),
  ],
});
