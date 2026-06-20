"use server";

import { prisma } from "@/server/db";
import { getSession } from "@/server/guards";

/**
 * Marque l'onboarding (modale de bienvenue) comme vu pour l'usager courant.
 * Idempotent ; no-op si aucune session. Appelé à la fermeture de la modale.
 */
export async function markOnboardedAction(): Promise<void> {
  const session = await getSession();
  if (!session) return;
  await prisma.user.update({
    where: { id: session.user.id },
    data: { onboardedAt: new Date() },
  });
}
