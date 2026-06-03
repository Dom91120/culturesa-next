import { auth } from "@/server/auth";
import { toNextJsHandler } from "better-auth/next-js";

// Expose tous les endpoints Better Auth sous /api/auth/*
export const { GET, POST } = toNextJsHandler(auth);
