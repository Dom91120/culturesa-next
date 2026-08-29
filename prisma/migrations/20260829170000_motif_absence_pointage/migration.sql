-- Motif d'absence sur l'occurrence pointée (facultatif, saisi dans la fiche
-- réservation) : ne porte du sens que lorsque pointage = absent.
ALTER TABLE "bookings" ADD COLUMN "pointageMotif" TEXT NOT NULL DEFAULT '';
