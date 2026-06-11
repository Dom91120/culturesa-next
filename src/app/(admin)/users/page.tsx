import { prisma } from "@/server/db";
import { requireRole } from "@/server/guards";
import { UsersTable } from "./users-table";

export default async function UsersPage() {
  await requireRole("administrateur");

  const [raw, demandeurs, structures, niveaux, services] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ role: "asc" }, { nom: "asc" }, { prenom: "asc" }],
      select: {
        id: true,
        nom: true,
        prenom: true,
        email: true,
        tel: true,
        role: true,
        rgpdOk: true,
        emailVerified: true,
        niveau: true,
        enfants: true,
        accompagnants: true,
        demandeurId: true,
        structureId: true,
        anonymizedAt: true,
        demandeur: { select: { label: true } },
        structure: { select: { label: true } },
        managedServices: {
          select: { serviceId: true, service: { select: { label: true } } },
        },
      },
    }),
    prisma.demandeur.findMany({ orderBy: { label: "asc" }, select: { id: true, label: true } }),
    prisma.structure.findMany({
      orderBy: { label: "asc" },
      select: { id: true, label: true, demandeurId: true },
    }),
    prisma.niveau.findMany({
      orderBy: { label: "asc" },
      select: { id: true, label: true, demandeurId: true },
    }),
    prisma.service.findMany({ orderBy: { label: "asc" }, select: { id: true, label: true } }),
  ]);

  const users = raw.map((u) => ({
    id: u.id,
    nom: u.nom,
    prenom: u.prenom,
    email: u.email,
    tel: u.tel,
    role: u.role,
    rgpdOk: u.rgpdOk,
    emailVerified: u.emailVerified,
    niveau: u.niveau,
    enfants: u.enfants,
    accompagnants: u.accompagnants,
    demandeurId: u.demandeurId,
    structureId: u.structureId,
    demandeurLabel: u.demandeur?.label ?? null,
    structureLabel: u.structure?.label ?? null,
    anonymized: u.anonymizedAt != null,
    serviceIds: u.managedServices.map((m) => m.serviceId),
    serviceLabels: u.managedServices.map((m) => m.service.label),
  }));

  return (
    <UsersTable
      users={users}
      demandeurs={demandeurs}
      structures={structures}
      niveaux={niveaux}
      services={services}
    />
  );
}
