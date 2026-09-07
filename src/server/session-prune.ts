import { prisma } from "@/server/db";

// ════════════════════════════════════════════════════════════════════════════
//  Élagage des sessions d'un compte À LA CONNEXION (Dom 2026-09-07).
//
//  Better Auth crée une ligne `session` à chaque connexion et ne ferme jamais les
//  précédentes (sauf changement de mot de passe) : une usagère repassant sept fois par
//  la page de connexion dans l'après-midi affichait « 7 sessions » dans Utilisateurs ›
//  Connectés. Deux règles, appliquées après la création de la nouvelle session :
//   1. les autres sessions du compte ouvertes depuis le MÊME NAVIGATEUR (même
//      user-agent ET même adresse IP — approximation raisonnable d'un même poste ;
//      l'IP n'est pas affichée, seulement comparée) sont fermées : un même navigateur
//      n'a qu'un cookie, elles étaient de toute façon orphelines ;
//   2. plafond de MAX_SESSIONS_PER_USER sessions par compte : au-delà, les plus
//      anciennes sont fermées (un compte légitimement ouvert sur deux ou trois
//      appareils n'est pas touché).
//  Best-effort : un échec ne doit jamais empêcher la connexion.
// ════════════════════════════════════════════════════════════════════════════

export const MAX_SESSIONS_PER_USER = 5;

export type PrunableSession = {
  id: string;
  createdAt: Date;
  userAgent: string | null;
  ipAddress: string | null;
};

/** Ids des sessions à fermer (fonction PURE, testée). `keep` = la session qui vient d'être créée. */
export function sessionsToPrune(
  sessions: readonly PrunableSession[],
  keep: PrunableSession,
  max: number = MAX_SESSIONS_PER_USER,
): string[] {
  const others = sessions.filter((s) => s.id !== keep.id);
  const sameBrowser = (s: PrunableSession) =>
    (s.userAgent ?? "") === (keep.userAgent ?? "") &&
    (s.ipAddress ?? "") === (keep.ipAddress ?? "");
  const out = new Set(others.filter(sameBrowser).map((s) => s.id));
  // Plafond : parmi les sessions restantes (nouvelle comprise), les plus anciennes au-delà de `max`.
  const remaining = others
    .filter((s) => !out.has(s.id))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  for (const s of remaining.slice(Math.max(0, max - 1))) out.add(s.id);
  return [...out];
}

/** Applique l'élagage pour la session `keep` (appelé par le hook de création de session). */
export async function pruneUserSessions(
  keep: PrunableSession & { userId: string },
): Promise<number> {
  try {
    const sessions = await prisma.session.findMany({
      where: { userId: keep.userId },
      select: { id: true, createdAt: true, userAgent: true, ipAddress: true },
    });
    const ids = sessionsToPrune(sessions, keep);
    if (ids.length === 0) return 0;
    const r = await prisma.session.deleteMany({ where: { id: { in: ids }, userId: keep.userId } });
    return r.count;
  } catch (e) {
    console.error("[auth] élagage des sessions échoué:", e);
    return 0;
  }
}
