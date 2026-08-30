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
  // exercice en cours : les documents opérationnels (agenda, éditions, pointage) lisent
  // la fiche vivante — les changer après coup réétiquetterait des séances déjà posées.
  // Le contrôle est refait dans l'action.
  const [modifiable, demandeursBruts] = await Promise.all([
    user?.role === "utilisateur"
      ? aReservationSurExerciceCourant(session.user.id).then((a) => !a)
      : Promise.resolve(false),
    prisma.demandeur.findMany({
      orderBy: { label: "asc" },
      select: {
        id: true,
        label: true,
        structureLibre: true,
        structures: { orderBy: { label: "asc" }, select: { id: true, label: true } },
      },
    }),
  ]);
  // Les structures d'une catégorie en SAISIE LIBRE ne sont pas envoyées au navigateur
  // (même règle que l'inscription) : déclarées une à une par les inscrits précédents,
  // les livrer publierait la liste de qui s'est inscrit. Le formulaire affiche un champ
  // de texte pour ces catégories et n'en a aucun usage.
  const demandeurs = demandeursBruts.map((d) =>
    d.structureLibre ? { ...d, structures: [] } : d,
  );

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
