import { prisma } from "@/server/db";
import { RegisterForm } from "./register-form";

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
