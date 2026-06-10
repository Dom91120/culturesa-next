import { isAuthorizedCron } from "@/server/cron";
import { runRgpdRetention } from "@/server/services/rgpd";
import { NextResponse } from "next/server";

/**
 * Rétention RGPD : préavis aux comptes inactifs (dernière activité ancienne),
 * puis anonymisation passé le délai de grâce sans reconnexion. Appelé une fois par
 * jour par le conteneur cron (cf. cron/crontab).
 */
export async function GET() {
  if (!(await isAuthorizedCron())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { notified, anonymized } = await runRgpdRetention();
  return NextResponse.json({ ok: true, notified, anonymized });
}
