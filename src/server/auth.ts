import { PASSWORD_POLICY_MESSAGE, isPasswordValid } from "@/lib/password";
import { prisma } from "@/server/db";
import { sendMail } from "@/server/mailer";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";

// Endpoints Better Auth qui définissent/changent un mot de passe : on y impose la
// politique de complexité (Better Auth ne valide nativement que la longueur min).
const PASSWORD_ENDPOINTS = new Set(["/sign-up/email", "/reset-password", "/change-password"]);

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

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 12,
    sendResetPassword: async ({ user, url }) => {
      await sendMail({
        to: user.email,
        subject: "Réinitialisation de votre mot de passe — CultuRésa",
        html: `<p>Bonjour,</p><p>Pour réinitialiser votre mot de passe, cliquez sur ce lien (valable 1h) :</p><p><a href="${url}">${url}</a></p>`,
      });
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendMail({
        to: user.email,
        subject: "Confirmez votre adresse e-mail — CultuRésa",
        html: `<p>Bienvenue sur CultuRésa !</p><p>Confirmez votre adresse e-mail en cliquant ici :</p><p><a href="${url}">${url}</a></p>`,
      });
    },
  },

  // Enforcement serveur de la politique de mot de passe (complexité), en plus du
  // minPasswordLength ci-dessus. Rejette tout mot de passe non conforme, y compris
  // une requête qui contournerait la validation côté formulaire.
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (!PASSWORD_ENDPOINTS.has(ctx.path)) return;
      const body = (ctx.body ?? {}) as { password?: unknown; newPassword?: unknown };
      const pw = typeof body.password === "string" ? body.password : body.newPassword;
      if (typeof pw !== "string") return;
      if (!isPasswordValid(pw)) {
        throw new APIError("BAD_REQUEST", { message: PASSWORD_POLICY_MESSAGE });
      }
    }),
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

export type Session = typeof auth.$Infer.Session;
