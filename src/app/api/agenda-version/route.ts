import { NextResponse } from "next/server";
import type { Role } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { getSession } from "@/server/guards";
import { userCanAccessService } from "@/server/services/bookings";

/**
 * « Version d'agenda » d'un service — sonde LÉGÈRE du polling des grilles (audit
 * perf 2026-07-24) : le hook useAgendaAutoRefresh l'interroge à chaque tick et ne
 * déclenche le router.refresh() complet (~18-20 requêtes + payload de tous les
 * miroirs) que si elle a changé. Version = counts + max(updatedAt) de bookings et
 * slots du service : toute création/édition bump un updatedAt, toute suppression
 * change un count. Les données FROIDES du payload (périodes, réglages du service,
 * référentiels) ne bumpent pas la version : elles rattrapent au retour d'onglet
 * (refresh inconditionnel) ou à la navigation.
 *
 * Accès : mêmes règles que les grilles — administrateur ; gestionnaire DU service
 * (ServiceManager) ; usager dont le demandeur effectif est accepté par le service.
 * Route API (et non server action) : GET haute fréquence sans mutation, no-store.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const serviceId = new URL(req.url).searchParams.get("serviceId")?.trim() ?? "";
  if (!serviceId) return NextResponse.json({ error: "serviceId requis" }, { status: 400 });

  const role = ((session.user as { role?: Role }).role ?? "utilisateur") as Role;
  let allowed = role === "administrateur";
  if (!allowed && role === "gestionnaire") {
    allowed = !!(await prisma.serviceManager.findUnique({
      where: { userId_serviceId: { userId: session.user.id, serviceId } },
      select: { serviceId: true },
    }));
  }
  if (!allowed) allowed = await userCanAccessService(prisma, session.user.id, serviceId);
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const [b, s] = await Promise.all([
    prisma.booking.aggregate({
      where: { serviceId },
      _count: true,
      _max: { updatedAt: true },
    }),
    prisma.slot.aggregate({
      where: { serviceId },
      _count: true,
      _max: { updatedAt: true },
    }),
  ]);
  const version = [
    b._count,
    b._max.updatedAt?.getTime() ?? 0,
    s._count,
    s._max.updatedAt?.getTime() ?? 0,
  ].join(":");

  return NextResponse.json(
    { version },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
  );
}
