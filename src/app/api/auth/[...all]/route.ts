import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth";

// Expose tous les endpoints Better Auth sous /api/auth/*
export const { GET, POST } = toNextJsHandler(auth);
