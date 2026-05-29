"use client";

import { createAuthClient } from "better-auth/react";

/** Client Better Auth pour les composants React (login, register, etc.). */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
});

export const { signIn, signUp, signOut, useSession } = authClient;
