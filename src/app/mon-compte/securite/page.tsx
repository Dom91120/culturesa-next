import type { Role } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/guards";
import { exige2FA } from "@/server/two-factor-policy";
import { TwoFactorPanel } from "./two-factor-panel";

export const dynamic = "force-dynamic";

/**
 * Sécurité du compte (constat A6).
 *
 * Accessible à TOUT usager connecté, et volontairement HORS du garde qui exige le
 * second facteur : c'est la page où l'on s'enrôle. La placer derrière l'exigence
 * qu'elle sert à satisfaire produirait une boucle de redirection — et un
 * gestionnaire définitivement incapable d'accéder à quoi que ce soit.
 */
export default async function SecuritePage() {
  const session = await requireUser();
  const role = ((session.user as { role?: Role }).role ?? "utilisateur") as Role;

  // Lu en base plutôt que depuis la session : celle-ci peut dater d'avant
  // l'activation, et afficherait alors un état faux juste après l'enrôlement.
  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { twoFactorEnabled: true },
  });

  return <TwoFactorPanel enabled={me?.twoFactorEnabled ?? false} requis={exige2FA(role)} />;
}
