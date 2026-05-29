import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/server/cron";

/**
 * Rétention RGPD : préavis aux comptes inactifs (lastLoginAt ancien),
 * puis anonymisation passé le délai sans reconnexion.
 * TODO (étape métier) : implémenter dans src/server/services/rgpd.ts
 *   - envoi du préavis (deletionNoticeSentAt)
 *   - anonymisation (anonymizedAt) + journal RgpdLog
 */
export async function GET() {
  if (!(await isAuthorizedCron())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // const { notified, anonymized } = await runRgpdRetention();
  return NextResponse.json({ ok: true, notified: 0, anonymized: 0, todo: "logique métier à implémenter" });
}
