-- Suppression des « périodes globales » : une période est TOUJOURS rattachée à un
-- service. `Period.serviceId` passe NOT NULL (0 période globale en base → aucun conflit).
ALTER TABLE "periods" ALTER COLUMN "serviceId" SET NOT NULL;
