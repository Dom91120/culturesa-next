import { prisma } from "@/server/db";
import { getSession, requireRole } from "@/server/guards";
import { headers } from "next/headers";

export async function GET(req: Request) {
  await requireRole("gestionnaire");
  const session = await getSession();

  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  if (!userId) return new Response("userId manquant", { status: 400 });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      prenom: true,
      nom: true,
      tel: true,
      niveau: true,
      enfants: true,
      accompagnants: true,
      role: true,
      rgpdOk: true,
      createdAt: true,
      lastLoginAt: true,
      demandeur: { select: { label: true } },
      structure: { select: { label: true } },
      bookings: {
        select: {
          id: true,
          bookingType: true,
          serviceId: true,
          slotId: true,
          // Le jour est porté par le créneau (slotDay) ; date pour un ponctuel.
          slot: { select: { slotDay: true, slotDate: true } },
          enfants: true,
          accompagnants: true,
          themeLabel: true,
          validated: true,
          pointage: true,
          createdAt: true,
        },
      },
    },
  });
  if (!user) return new Response("Usager introuvable", { status: 404 });

  // Journalise l'accès (RGPD art. 15) — sans donnée nominative dans details.
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  await prisma.rgpdLog.create({
    data: {
      action: "export",
      targetUserId: userId,
      actorUserId: session?.user.id ?? null,
      ip,
      details: { format: "json", bookings: user.bookings.length },
    },
  });

  const payload = {
    exportedAt: new Date().toISOString(),
    article: "RGPD art. 15 — droit d'accès",
    user,
  };

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="rgpd_${user.nom || "usager"}_${user.id}.json"`,
    },
  });
}
