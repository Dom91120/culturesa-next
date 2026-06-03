import { prisma } from "@/server/db";
import { requireRole } from "@/server/guards";
import { listEditionRows } from "@/server/services/editions";

function csvCell(v: string | number): string {
  return `"${String(v).replace(/"/g, '""')}"`;
}

const HEADER = [
  "Période",
  "Jour / Date",
  "Début",
  "Fin",
  "Demandeur",
  "Nom",
  "Prénom",
  "Thème",
  "Enfants",
  "Statut",
  "Pointage",
];

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireRole("gestionnaire");
  const { id } = await params;

  const service = await prisma.service.findUnique({ where: { id }, select: { label: true } });
  if (!service) return new Response("Service introuvable", { status: 404 });

  const rows = await listEditionRows(id);
  const lines = [
    HEADER,
    ...rows.map((r) => [
      r.periode,
      r.jour,
      r.debut,
      r.fin,
      r.demandeur,
      r.nom,
      r.prenom,
      r.theme,
      r.enfants,
      r.statut,
      r.pointage,
    ]),
  ];

  // BOM UTF-8 (﻿) + séparateur ; + fins de ligne CRLF (compatibilité Excel FR).
  const body = lines.map((cols) => cols.map(csvCell).join(";")).join("\r\n");
  const csv = String.fromCharCode(0xfeff) + body;

  const safeName = service.label.replace(/[^a-zA-Z0-9-_]+/g, "_").slice(0, 40) || "service";
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="reservations_${safeName}.csv"`,
    },
  });
}
