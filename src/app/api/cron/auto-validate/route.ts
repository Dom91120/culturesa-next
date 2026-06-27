import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/server/cron";
import { runAutoValidation } from "@/server/services/auto-validate";
import { sendManagerDigest } from "@/server/services/manager-notice";

/**
 * Auto-validation des réservations selon `service.autoValidationDelay` (délai signé
 * en minutes : négatif = minutes ouvrées, positif = minutes calendaires). Appelé
 * toutes les ~15 min par le conteneur cron (cf. cron/crontab).
 *
 * Enchaîne le digest de notification des gestionnaires (si l'échéance configurée
 * dans Administration > Configuration est atteinte).
 */
export async function GET() {
  if (!(await isAuthorizedCron())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const stats = await runAutoValidation();
  const digest = await sendManagerDigest();
  return NextResponse.json({ ok: true, ...stats, managerDigest: digest });
}
