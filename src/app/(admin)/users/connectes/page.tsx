import { type SessionRow, summarizeSessions } from "@/lib/connected-users";
import { prisma } from "@/server/db";
import { getSession, requireRole } from "@/server/guards";
import { ConnectedTable } from "./connected-table";

// Toujours à jour : la page se relit à chaque affichage (et toutes les 30 s côté client).
export const dynamic = "force-dynamic";

/** Administration › Utilisateurs › Connectés : sessions valables, regroupées par compte. */
export default async function ConnectedUsersPage() {
  await requireRole("administrateur");
  const session = await getSession();
  const now = new Date();
  const rows = await prisma.session.findMany({
    where: { expiresAt: { gt: now }, user: { anonymizedAt: null } },
    select: {
      userId: true,
      createdAt: true,
      updatedAt: true,
      userAgent: true,
      user: { select: { nom: true, prenom: true, email: true, role: true } },
    },
  });
  const sessions: SessionRow[] = rows.map((r) => ({
    userId: r.userId,
    nom: r.user.nom,
    prenom: r.user.prenom,
    email: r.user.email,
    role: r.user.role,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    userAgent: r.userAgent,
  }));
  const summary = summarizeSessions(sessions, now.toISOString());
  return (
    <ConnectedTable
      summary={summary}
      generatedAt={now.toISOString()}
      selfUserId={session?.user.id ?? null}
    />
  );
}
