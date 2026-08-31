import { csvResponse } from "@/lib/csv";
import { prisma } from "@/server/db";
import { reponseApi, requireServiceManagerApi } from "@/server/guards-api";
import { listEditionRows, listInscrits, listOpenSlots } from "@/server/services/editions";
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
  return reponseApi(async () => {
    await requireServiceManagerApi(id, "/services/[id]/editions/export");

    const service = await prisma.service.findUnique({ where: { id }, select: { label: true } });
    if (!service) return new Response("Service introuvable", { status: 404 });

    // Export scopé à l'exercice sélectionné (param `?exercice=`), comme les écrans.
    const sp = new URL(req.url).searchParams;
    const spExercice = sp.get("exercice") ?? undefined;
    const { selected } = await resolveEditionExercice(id, spExercice);
    const safeName = service.label.replace(/[^a-zA-Z0-9-_]+/g, "_").slice(0, 40) || "service";

    // `kind` (défaut : réservations, l'export historique) : inscrits et créneaux
    // ouverts partagent la route — mêmes colonnes que leurs écrans.
    const kind = sp.get("kind") ?? "reservations";
    if (kind === "inscrits") {
      const inscrits = await listInscrits(id, selected?.periodIds, sp.get("anonymises") === "1");
      const lines = [
        ["Nom", "Prénom", "Structure", "Niveau", "Email", "Téléphone", "Inscrit le"],
        ...inscrits.map((u) => [
          u.nom,
          u.prenom,
          u.structure || u.demandeur,
          u.niveau,
          u.email,
          u.tel,
          u.inscritLe,
        ]),
      ];
      return csvResponse(lines, `inscrits_${safeName}.csv`);
    }
    if (kind === "creneaux") {
      const slots = await listOpenSlots(id, selected?.periodIds);
      const lines = [
        ["Jour / Date", "Horaires", "Type", "Période", "Places", "Demandeurs"],
        ...slots.map((s) => [
          s.jour,
          s.creneau,
          s.type,
          s.periode,
          s.places ?? "",
          s.demandeurs.length === 0 ? "Toutes catégories" : s.demandeurs.join(", "),
        ]),
      ];
      return csvResponse(lines, `creneaux_${safeName}.csv`);
    }
    if (kind !== "reservations") return new Response("Export inconnu", { status: 400 });

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

    return csvResponse(lines, `reservations_${safeName}.csv`);
  });
}
