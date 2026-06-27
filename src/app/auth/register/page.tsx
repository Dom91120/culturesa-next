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
        structures: { orderBy: { label: "asc" }, select: { id: true, label: true } },
      },
    }),
    prisma.niveau.findMany({
      orderBy: [{ position: "asc" }, { label: "asc" }],
      select: { id: true, label: true, demandeurId: true },
    }),
  ]);

  return <RegisterForm demandeurs={demandeurs} niveaux={niveaux} />;
}
