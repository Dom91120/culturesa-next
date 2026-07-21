import { prisma } from "@/server/db";
import { requireUser } from "@/server/guards";
import { DeleteAccount } from "./delete-account";
import { PasswordForm } from "./password-form";
import { ProfileForm } from "./profile-form";

export default async function MonComptePage() {
  const session = await requireUser();
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      prenom: true,
      nom: true,
      tel: true,
      email: true,
      role: true,
      niveau: true,
      enfants: true,
      accompagnants: true,
      demandeur: { select: { label: true } },
      structure: { select: { label: true } },
      managedServices: {
        orderBy: { service: { label: "asc" } },
        select: { service: { select: { label: true } } },
      },
    },
  });

  const profile = {
    prenom: user?.prenom ?? "",
    nom: user?.nom ?? "",
    tel: user?.tel ?? "",
    email: user?.email ?? session.user.email,
    role: user?.role ?? "utilisateur",
    categorie: user?.demandeur?.label ?? null,
    structure: user?.structure?.label ?? null,
    niveau: user?.niveau ?? "",
    enfants: user?.enfants ?? 0,
    accompagnants: user?.accompagnants ?? 0,
    managedServices: user?.managedServices.map((m) => m.service.label) ?? [],
  };

  return (
    <div>
      <ProfileForm profile={profile} />
      <PasswordForm />
      <DeleteAccount />
    </div>
  );
}
