-- Notification des gestionnaires : mode « Unitaires » (un e-mail par réservation,
-- sans regroupement ni attente d'échéance).
--
-- `ADD VALUE` est admis dans une transaction depuis PostgreSQL 12 tant que la valeur
-- n'est pas UTILISÉE dans la même transaction — ce qui est le cas ici : on ajoute
-- l'étiquette, aucune ligne ne la porte encore.
-- AlterEnum
ALTER TYPE "MgrNoticeMode" ADD VALUE IF NOT EXISTS 'each' BEFORE 'hours';
