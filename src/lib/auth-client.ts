"use client";

import { inferAdditionalFields, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * Client Better Auth pour les composants React (login, register, etc.).
 * Les `additionalFields` sont redéclarés ici (en miroir de src/server/auth.ts)
 * afin que TypeScript les accepte dans signUp.email — sans importer de code serveur.
 */
export const authClient = createAuthClient({
  // Dans le navigateur, on cible TOUJOURS l'origine réelle d'où la page a été servie
  // (localhost en local, ou l'IP LAN ex. 192.168.1.102 depuis un smartphone) : sinon
  // une baseURL figée sur localhost ferait partir le fetch vers le localhost… du
  // téléphone → « Failed to fetch ». Repli sur l'env côté serveur (SSR).
  baseURL: typeof window !== "undefined" ? window.location.origin : process.env.NEXT_PUBLIC_APP_URL,
  plugins: [
    inferAdditionalFields({
      user: {
        prenom: { type: "string", required: false },
        nom: { type: "string", required: false },
        tel: { type: "string", required: false },
        niveau: { type: "string", required: false },
        enfants: { type: "number", required: false },
        accompagnants: { type: "number", required: false },
        rgpdOk: { type: "boolean", required: false },
        demandeurId: { type: "number", required: false },
        structureId: { type: "number", required: false },
        twoFactorEnabled: { type: "boolean", required: false },
      },
    }),
    // Second facteur (constat A6). Sans `twoFactorPage` ni `onTwoFactorRedirect` :
    // la connexion renvoie alors `twoFactorRedirect: true` dans sa réponse, et le
    // formulaire enchaîne sur la saisie du code SANS changer de page — le mot de
    // passe déjà saisi n'a pas à être retapé si l'usager se trompe de code.
    twoFactorClient(),
  ],
});

export const { signIn, signUp, signOut, useSession, twoFactor } = authClient;
