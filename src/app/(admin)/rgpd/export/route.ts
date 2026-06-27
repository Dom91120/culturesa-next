import type { Role } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { requireRole } from "@/server/guards";
import { isUserInServicesRgpdScope } from "@/server/services/rgpd";
import { headers } from "next/headers";

export async function GET(req: Request) {
  const session = await requireRole("gestionnaire");

  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  if (!userId) return new Response("userId manquant", { status: 400 });

  // Anti-IDOR : un administrateur peut exporter tout compte ; un gestionnaire
  // uniquement les usagers relevant du périmètre RGPD d'un service qu'il gère
  // (même critère que la liste du panneau Paramètres › RGPD).
  const role = (session.user as { role?: Role }).role ?? "utilisateur";
  if (role !== "administrateur") {
    const managed = await prisma.serviceManager.findMany({
      where: { userId: session.user.id },
      select: { serviceId: true },
    });
    const inScope = await isUserInServicesRgpdScope(
      managed.map((m) => m.serviceId),
      userId,
    );
    if (!inScope) return new Response("Accès refusé", { status: 403 });
  }

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

  // Nom assaini avant injection dans l'en-tête (cf. editions/export) : `nom` est un champ
  // libre ; un guillemet/CR-LF casserait le header (réponse 500) ou injecterait un en-tête.
  const safeName = (user.nom || "usager").replace(/[^a-zA-Z0-9-_]+/g, "_").slice(0, 40);
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="rgpd_${safeName}_${user.id}.json"`,
    },
  });
}
