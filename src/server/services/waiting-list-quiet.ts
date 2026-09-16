import type { Prisma } from "@/generated/prisma/client";
import { parseQuietMinutes, WAITLIST_QUIET_KEY } from "@/lib/waiting-list-quiet";
import { getConfigMany, setConfig } from "@/server/config";

// Délai de carence de l'attribution automatique — réglage GLOBAL (Administration ›
// Tâches planifiées), cf. lib/waiting-list-quiet pour la règle et son pourquoi.

/** Minutes de calme exigées sur l'agenda d'un service avant appariement (défaut 15, 0 = aucun). */
export async function getWaitlistQuietMinutes(): Promise<number> {
  const cfg = await getConfigMany([WAITLIST_QUIET_KEY]);
  return parseQuietMinutes(cfg[WAITLIST_QUIET_KEY]);
}

export async function setWaitlistQuietMinutes(minutes: number): Promise<void> {
  await setConfig(WAITLIST_QUIET_KEY, String(minutes));
}

/**
 * Dernière modification de l'agenda d'un service : max des `updatedAt` des réservations
 * et des créneaux (même mesure que la sonde /api/agenda-version). null si rien.
 */
export async function lastAgendaActivity(
  db: Prisma.TransactionClient,
  serviceId: string,
): Promise<Date | null> {
  const [b, s] = await Promise.all([
    db.booking.aggregate({ where: { serviceId }, _max: { updatedAt: true } }),
    db.slot.aggregate({ where: { serviceId }, _max: { updatedAt: true } }),
  ]);
  const dates = [b._max.updatedAt, s._max.updatedAt].filter((d): d is Date => d != null);
  if (dates.length === 0) return null;
  return new Date(Math.max(...dates.map((d) => d.getTime())));
}
