import { csvResponse } from "@/lib/csv";
import { prisma } from "@/server/db";
import { requireServiceManager } from "@/server/guards";
import { listEditionRows } from "@/server/services/editions";
import { resolveEditionExercice } from "../range";

// Schéma aligné sur le legacy (api/export.php) : 14 colonnes, même ordre. « Demandeur »
// = Nom Prénom de l'usager ; « Structure » = structure (repli demandeur). On conserve en
// plus la colonne « Pointage » (apport Next, sans équivalent legacy).
const HEADER = [
  "Type",
  "Structure",
  "Niveau",
  "Demandeur",
  "Email",
  "Téléphone",
  "Enfants",
  "Adultes",
  "Période",
  "Créneau",
  "Jour / Date",
  "Thème",
  "Statut",
  "Date de réservation",
  "Pointage",
];

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireServiceManager(id);

  const service = await prisma.service.findUnique({ where: { id }, select: { label: true } });
  if (!service) return new Response("Service introuvable", { status: 404 });

  // Export scopé à l'exercice sélectionné (param `?exercice=`), comme l'écran Liste.
  const spExercice = new URL(req.url).searchParams.get("exercice") ?? undefined;
  const { selected } = await resolveEditionExercice(id, spExercice);
  const rows = await listEditionRows(id, undefined, selected?.periodIds);
  const lines = [
    HEADER,
    ...rows.map((r) => [
      r.type,
      r.structure,
      r.niveau,
      `${r.nom} ${r.prenom}`.trim(),
      r.email,
      r.tel,
      r.enfants,
      r.accompagnants,
      r.periode,
      r.creneau,
      r.jourDate,
      r.theme,
      r.statut,
      r.createdAt,
      r.pointage,
    ]),
  ];

  const safeName = service.label.replace(/[^a-zA-Z0-9-_]+/g, "_").slice(0, 40) || "service";
  return csvResponse(lines, `reservations_${safeName}.csv`);
}
