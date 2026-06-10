import { prisma } from "@/server/db";
import { requireUser } from "@/server/guards";
import { DeleteAccount } from "./delete-account";
import { PasswordForm } from "./password-form";
import { ProfileForm } from "./profile-form";

export default async function MonComptePage() {
  const session = await requireUser();
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { prenom: true, nom: true, tel: true, email: true },
  });

  const profile = {
    prenom: user?.prenom ?? "",
    nom: user?.nom ?? "",
    tel: user?.tel ?? "",
    email: user?.email ?? session.user.email,
  };

  return (
    <div>
      <ProfileForm profile={profile} />
      <PasswordForm />
      <DeleteAccount />
    </div>
  );
}
