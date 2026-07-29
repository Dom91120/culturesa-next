import { NextResponse } from "next/server";
import type { Role } from "@/generated/prisma/client";
import { getSessionNoTouch } from "@/server/guards";
import { sessionDeadlineAt } from "@/server/session-policy";

/**
 * État de la session courante — sonde du composant de surveillance
 * (components/session-watchdog.tsx), interrogée UNIQUEMENT à l'échéance annoncée,
 * jamais en boucle.
 *
 * `getSessionNoTouch` est impératif ici : cette requête est émise par la page, pas
 * par un geste de l'usager. La compter comme activité ferait indéfiniment repousser
 * l'échéance qu'elle est justement chargée de constater — la sonde entretiendrait
 * la session qu'elle surveille.
 *
 * Elle APPLIQUE en revanche la politique : une session hors délai est révoquée par
 * `getSessionNoTouch`, et la réponse `active: false` déclenche le retour du client
 * sur l'écran de connexion.
 */
export async function GET() {
  const session = await getSessionNoTouch();
  const headers = { "Cache-Control": "no-store, no-cache, must-revalidate" };

  if (!session) {
    return NextResponse.json({ active: false }, { headers });
  }

  const role = (session.user as { role?: Role }).role;
  const expiresAt = sessionDeadlineAt(role, session.session.updatedAt, session.session.createdAt);
  return NextResponse.json({ active: true, expiresAt }, { headers });
}
