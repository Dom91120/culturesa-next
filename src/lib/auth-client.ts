"use client";

import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * Client Better Auth pour les composants React (login, register, etc.).
 * Les `additionalFields` sont redéclarés ici (en miroir de src/server/auth.ts)
 * afin que TypeScript les accepte dans signUp.email — sans importer de code serveur.
 */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
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
      },
    }),
  ],
});

export const { signIn, signUp, signOut, useSession } = authClient;
