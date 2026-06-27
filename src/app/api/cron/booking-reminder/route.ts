import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/server/cron";
import { runBookingReminders } from "@/server/services/booking-reminders";

/**
 * Rappels de réservation : envoie aux usagers un e-mail une semaine avant (J-7) et
 * la veille (J-1) de chaque séance réservée et confirmée. Idempotent : appelé une
 * fois par jour par le conteneur cron (cf. cron/crontab).
 */
export async function GET() {
  if (!(await isAuthorizedCron())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sent = await runBookingReminders();
  return NextResponse.json({ ok: true, sent });
}
