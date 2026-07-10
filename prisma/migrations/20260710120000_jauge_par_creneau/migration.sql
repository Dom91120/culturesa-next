-- « A une jauge » PAR CRÉNEAU : posé à la création (mode jauge de l'agenda admin),
-- miroirs hérités du parent. Initialisation depuis la dérivation actuelle de la
-- matrice service × demandeurs (jauge active pour au moins un demandeur du mode) :
--   - récurrents : un demandeur RÉCURRENT du service a la jauge ;
--   - ponctuels autonomes : un demandeur PONCTUEL du service a la jauge ;
--   - miroirs : valeur du récurrent parent.
ALTER TABLE "slots" ADD COLUMN "jauge" BOOLEAN NOT NULL DEFAULT false;

UPDATE "slots" s SET "jauge" = true
WHERE s."slotType" = 'recurring' AND EXISTS (
  SELECT 1 FROM "service_demandeur_settings" d
  WHERE d."serviceId" = s."serviceId" AND d."recurrent" = true AND d."jauge" = true
);

UPDATE "slots" s SET "jauge" = true
WHERE s."slotType" = 'unique' AND s."parentSlotId" IS NULL AND EXISTS (
  SELECT 1 FROM "service_demandeur_settings" d
  WHERE d."serviceId" = s."serviceId" AND d."recurrent" = false AND d."jauge" = true
);

UPDATE "slots" m SET "jauge" = p."jauge"
FROM "slots" p
WHERE m."parentSlotId" = p.id;
