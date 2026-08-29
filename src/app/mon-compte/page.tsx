import { prisma } from "@/server/db";
import { requireUser } from "@/server/guards";
import { aReservationSurExerciceCourant } from "@/server/services/structures";
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
      demandeurId: true,
      structureId: true,
      demandeur: { select: { label: true } },
      structure: { select: { label: true } },
      managedServices: {
        orderBy: { service: { label: "asc" } },
        select: { service: { select: { label: true } } },
      },
    },
  });

  // Catégorie / structure modifiables par l'usager TANT QU'IL N'A RIEN RÉSERVÉ sur un
  // exercice en cours : ces deux libellés sont lus à l'affichage (agenda, éditions,
  // statistiques), jamais figés sur la réservation — les changer après coup
  // réétiquetterait des séances déjà posées. Le contrôle est refait dans l'action.
  const [modifiable, demandeurs] = await Promise.all([
    user?.role === "utilisateur"
      ? aReservationSurExerciceCourant(session.user.id).then((a) => !a)
      : Promise.resolve(false),
    prisma.demandeur.findMany({
      orderBy: { label: "asc" },
      select: {
        id: true,
        label: true,
        structures: { orderBy: { label: "asc" }, select: { id: true, label: true } },
      },
    }),
  ]);

  const profile = {
    prenom: user?.prenom ?? "",
    nom: user?.nom ?? "",
    tel: user?.tel ?? "",
    email: user?.email ?? session.user.email,
    role: user?.role ?? "utilisateur",
    categorie: user?.demandeur?.label ?? null,
    structure: user?.structure?.label ?? null,
    demandeurId: user?.demandeurId ?? null,
    structureId: user?.structureId ?? null,
    niveau: user?.niveau ?? "",
    enfants: user?.enfants ?? 0,
    accompagnants: user?.accompagnants ?? 0,
    managedServices: user?.managedServices.map((m) => m.service.label) ?? [],
  };

  return (
    <div>
      <ProfileForm profile={profile} demandeurs={demandeurs} affiliationModifiable={modifiable} />
      <PasswordForm />
      <DeleteAccount />
    </div>
  );
}
