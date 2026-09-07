import { csvResponse } from "@/lib/csv";
import { prisma } from "@/server/db";
import { reponseApi, requireServiceManagerApi } from "@/server/guards-api";
import { listEditionRows, listInscrits, listOpenSlots } from "@/server/services/editions";
import { listWaitingEntries } from "@/server/services/waiting-list";
import {
  listWaitingContacts,
  listWaitingHistory,
  listWaitingPlacements,
  waitingDemand,
} from "@/server/services/waiting-list-editions";
import { resolveEditionExercice } from "../range";

const ymdFr = (ymd: string | null) => (ymd ? ymd.split("-").reverse().join("/") : "");
const isoFr = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR") : "");

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
    // Éditions de la liste d'attente (Dom 2026-09-07) : mêmes colonnes que leurs écrans.
    if (kind === "attente") {
      const rows = await listWaitingEntries(id);
      const lines = [
        [
          "Rang",
          "Nom",
          "Prénom",
          "Structure",
          "Email",
          "Disponibilités",
          "Périodes souhaitées",
          "Réservation automatique",
          "Inscrit le",
          "Prévenu le",
          "Échéance",
        ],
        ...rows.map((r, i) => [
          i + 1,
          r.nom,
          r.prenom,
          r.structure || r.demandeur,
          r.email,
          r.dispos.join(", "),
          r.periodes.join(", ") || "Toutes",
          r.autoInscription ? "Oui" : "Non",
          isoFr(r.createdAt),
          isoFr(r.lastNotifiedAt),
          ymdFr(r.echeance),
        ]),
      ];
      return csvResponse(lines, `liste_attente_${safeName}.csv`);
    }
    if (kind === "attente-demande") {
      const d = await waitingDemand(id);
      const lines: (string | number)[][] = [
        ["Jour", "Matin", "dont automatique", "Après-midi", "dont automatique"],
        ...d.byHalfDay.map((r) => [r.label, r.am.total, r.am.auto, r.pm.total, r.pm.auto]),
      ];
      if (d.byPeriod.length > 0) {
        lines.push([]);
        lines.push(["Période", "Inscrits", "dont automatique"]);
        for (const p of d.byPeriod) lines.push([p.label, p.total, p.auto]);
      }
      return csvResponse(lines, `demande_liste_attente_${safeName}.csv`);
    }
    if (kind === "attente-historique" || kind === "attente-placements") {
      const range = selected ? { from: selected.dateStart, to: selected.dateEnd } : undefined;
      const rows =
        kind === "attente-historique"
          ? await listWaitingHistory(id, range)
          : await listWaitingPlacements(id, range);
      const lines = [
        [
          "Usager",
          "Email",
          "Structure",
          "Disponibilités",
          "Périodes",
          "Réservation automatique",
          "Inscrit le",
          "Clos le",
          "Délai (jours)",
          "Issue",
          "Réservation",
          "Réservation supprimée",
        ],
        ...rows.map((r) => [
          r.usager,
          r.email,
          r.structure,
          r.dispos.join(", "),
          r.periodes.join(", ") || "Toutes",
          r.autoInscription ? "Oui" : "Non",
          r.inscritLe,
          r.clotureLe,
          r.delaiJours,
          r.issueLabel,
          r.reservation,
          r.suppression,
        ]),
      ];
      const name =
        kind === "attente-historique" ? "historique_liste_attente" : "placements_liste_attente";
      return csvResponse(lines, `${name}_${safeName}.csv`);
    }
    if (kind === "attente-adresses") {
      const rows = await listWaitingContacts(id);
      const lines = [
        [
          "Nom",
          "Prénom",
          "Structure",
          "Email",
          "Téléphone",
          "Disponibilités",
          "Périodes",
          "Inscrit le",
          "Échéance",
        ],
        ...rows.map((r) => [
          r.nom,
          r.prenom,
          r.structure,
          r.email,
          r.tel,
          r.dispos.join(", "),
          r.periodes.join(", ") || "Toutes",
          r.inscritLe,
          ymdFr(r.echeance),
        ]),
      ];
      return csvResponse(lines, `adresses_liste_attente_${safeName}.csv`);
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
