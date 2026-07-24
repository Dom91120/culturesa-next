-- Audit 2026-07-24 : invariants metier portes par le code seul, desormais aussi
-- par la base. Contraintes en NOT VALID : seules les NOUVELLES ecritures sont
-- validees — aucune ligne existante (base serveur qui persiste) ne peut faire
-- echouer la migration.

-- 1) Periode : dates coherentes quand les deux sont presentes.
--    PAS de NOT NULL sur dateStart/dateEnd : une periode sans dates est un etat
--    LEGITIME (saisie en cours ; reconduction de bascule dont le decalage d'un an
--    a echoue, cf. exercice.ts cycleService) — la garde runtime du moteur de
--    miroirs (« Periode introuvable ou sans dates ») la traite deja.
ALTER TABLE "periods" ADD CONSTRAINT "ck_periods_dates_ordonnees"
  CHECK ("dateStart" IS NULL OR "dateEnd" IS NULL OR "dateStart" <= "dateEnd") NOT VALID;

-- 2) Exercice : toujours rattache a un service (les deux flux de creation —
--    periods.ts createServiceExercice et exercice.ts cycleService — le posent ;
--    0 ligne sans serviceId en base).
ALTER TABLE "exercice" ADD CONSTRAINT "ck_exercice_service_requis"
  CHECK ("serviceId" IS NOT NULL) NOT VALID;

-- 3) Creneau recurrent : periode ET jour obligatoires (modele « un slot = un
--    jour ») — la garde runtime « Creneau recurrent incomplet » devient une
--    vraie barriere pour les seeds/scripts/migrations qui l'oublieraient.
ALTER TABLE "slots" ADD CONSTRAINT "ck_slots_recurrent_complet"
  CHECK ("slotType" <> 'recurring' OR ("periodId" IS NOT NULL AND "slotDay" IS NOT NULL)) NOT VALID;
