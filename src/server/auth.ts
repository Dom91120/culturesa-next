import { emailButton } from "@/lib/email-theme";
import { PASSWORD_POLICY_MESSAGE, isPasswordValid } from "@/lib/password";
import { verifyCaptcha } from "@/server/captcha";
import { prisma } from "@/server/db";
import { sendTemplatedMail } from "@/server/services/mail-send";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";

// Endpoints Better Auth qui définissent/changent un mot de passe : on y impose la
// politique de complexité (Better Auth ne valide nativement que la longueur min).
const PASSWORD_ENDPOINTS = new Set(["/sign-up/email", "/reset-password", "/change-password"]);

/**
 * Envoie un e-mail de compte/sécurité (vérification d'adresse, réinitialisation de
 * mot de passe) à partir du gabarit éditable (onglet Échanges), habillé du thème.
 */
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
  const vars = { salutation: prenom ? `Bonjour ${prenom},` : "Bonjour,", prenom, url };
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
      // CAPTCHA image auto-hébergé sur l'inscription (port de captcha_img.php du
      // legacy) : on vérifie le token signé + la saisie, transmis par en-têtes,
      // AVANT toute création de compte. Désactivable via CAPTCHA_DISABLED=true
      // (utile en tests/seed). Cf. src/server/captcha.ts.
      if (ctx.path === "/sign-up/email" && process.env.CAPTCHA_DISABLED !== "true") {
        const ok = verifyCaptcha(
          ctx.headers?.get("x-captcha-token"),
          ctx.headers?.get("x-captcha-answer"),
        );
        if (!ok) {
          throw new APIError("BAD_REQUEST", {
            message: "Code de vérification invalide ou expiré. Merci de recommencer.",
          });
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
  rateLimit: { enabled: true, window: 60, max: 10 },

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

  // Doit rester en dernier : branche la gestion des cookies sur Next.js.
  plugins: [nextCookies()],
});
