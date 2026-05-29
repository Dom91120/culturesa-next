import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/server/cron";

/**
 * Auto-validation des réservations selon `service.autoValidationDelay`.
 * TODO (étape métier) : implémenter dans src/server/services/bookings.ts
 *   - délai négatif = N jours OUVRÉS avant la séance
 *   - délai positif = N semaines calendaires après la réservation
 */
export async function GET() {
  if (!(await isAuthorizedCron())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // const validated = await runAutoValidation();
  return NextResponse.json({ ok: true, validated: 0, todo: "logique métier à implémenter" });
}
