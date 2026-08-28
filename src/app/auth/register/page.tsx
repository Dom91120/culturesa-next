import { prisma } from "@/server/db";
import { RegisterForm } from "./register-form";

// Lit les demandeurs/niveaux en base → rendu à la requête (pas de prérendu au build,
// où la base n'est pas disponible).
export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const [demandeurs, niveaux] = await Promise.all([
    prisma.demandeur.findMany({
      orderBy: { label: "asc" },
      select: {
        id: true,
        label: true,
        structureLibre: true,
        structures: { orderBy: { label: "asc" }, select: { id: true, label: true } },
      },
    }),
    prisma.niveau.findMany({
      orderBy: [{ position: "asc" }, { label: "asc" }],
      select: { id: true, label: true, demandeurId: true },
    }),
  ]);

  // Les structures d'une catégorie en saisie libre ne sont PAS envoyées au
  // navigateur : elles ont été déclarées une à une par les inscrits précédents, et
  // cette page est publique. Les livrer reviendrait à publier la liste de qui s'est
  // inscrit — le formulaire n'en a de toute façon aucun usage, puisqu'il affiche un
  // champ de texte pour ces catégories.
  const publics = demandeurs.map((d) => (d.structureLibre ? { ...d, structures: [] } : d));

  return <RegisterForm demandeurs={publics} niveaux={niveaux} />;
}
