import { csvResponse } from "@/lib/csv";
import { requireUser } from "@/server/guards";
import { listEditionRows } from "@/server/services/editions";

const HEADER = ["Période", "Jour / Date", "Créneau", "Enfants", "Accompagnants", "Thème", "Statut"];

/** Export CSV des réservations de L'USAGER courant pour un service (« mes réservations »). */
export async function GET(_req: Request, { params }: { params: Promise<{ serviceId: string }> }) {
  const { serviceId } = await params;
  const session = await requireUser();

  const rows = await listEditionRows(serviceId, session.user.id);
  const lines = [
    HEADER,
    ...rows.map((r) => [
      r.periode,
      r.jourDate,
      r.creneau,
      r.enfants,
      r.accompagnants,
      r.theme,
      r.statut,
    ]),
  ];

  return csvResponse(lines, "mes-reservations.csv");
}
