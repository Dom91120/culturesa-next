-- Suppression de la notion d'ÉTAT (actif/archive) sur les périodes et les créneaux.
-- L'archivage des périodes à la bascule d'exercice est supprimé ; le périmètre des vues
-- (agenda/stats/éditions) se fait désormais par EXERCICE, plus par état. Slot.state
-- n'était jamais autre que « actif » (cycle de vie réel : actif ↔ supprimé).

-- Index composite (slotDate, state) → (slotDate) seul (le cron de rappels filtre slotDate).
DROP INDEX "slots_slotDate_state_idx";
CREATE INDEX "slots_slotDate_idx" ON "slots"("slotDate");

-- Retrait des colonnes state (aucune donnée signifiante : 0 période archivée, slots
-- tous « actif »).
ALTER TABLE "periods" DROP COLUMN "state";
ALTER TABLE "slots" DROP COLUMN "state";

-- Plus aucune colonne ne référence l'enum → suppression du type.
DROP TYPE "EntityState";
