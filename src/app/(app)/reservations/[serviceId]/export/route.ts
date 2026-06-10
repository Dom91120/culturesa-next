import { requireUser } from "@/server/guards";
import { listEditionRows } from "@/server/services/editions";

function csvCell(v: string | number): string {
  return `"${String(v).replace(/"/g, '""')}"`;
}

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

  const body = lines.map((cols) => cols.map(csvCell).join(";")).join("\r\n");
  const csv = String.fromCharCode(0xfeff) + body;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="mes-reservations.csv"',
    },
  });
}
