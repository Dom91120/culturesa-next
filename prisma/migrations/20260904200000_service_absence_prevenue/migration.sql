-- « Absences prévenues » : réglage PAR SERVICE (opt-in) conditionnant le signalement
-- d'absence à l'avance (usager : macaron + aide ; gestionnaire : case dans la fiche).
ALTER TABLE "services" ADD COLUMN "absencePrevenue" BOOLEAN NOT NULL DEFAULT false;
