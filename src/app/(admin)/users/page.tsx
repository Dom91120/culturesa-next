import { prisma } from "@/server/db";
import { UsersTable } from "./users-table";

export default async function UsersPage() {
  const raw = await prisma.user.findMany({
    orderBy: [{ nom: "asc" }, { prenom: "asc" }],
    select: {
      id: true,
      nom: true,
      prenom: true,
      email: true,
      tel: true,
      role: true,
      rgpdOk: true,
      demandeur: { select: { label: true } },
      structure: { select: { label: true } },
    },
  });

  const users = raw.map((u) => ({
    id: u.id,
    nom: u.nom,
    prenom: u.prenom,
    email: u.email,
    tel: u.tel,
    role: u.role,
    rgpdOk: u.rgpdOk,
    affiliation: u.structure?.label ?? u.demandeur?.label ?? null,
  }));

  return <UsersTable users={users} />;
}
