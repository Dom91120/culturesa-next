-- Notification des gestionnaires : « Unitaires » (each) par défaut — un e-mail par
-- réservation — au lieu de « aucune » ; les services encore à « none » basculent.
ALTER TABLE "services" ALTER COLUMN "mgrNoticeMode" SET DEFAULT 'each';
UPDATE "services" SET "mgrNoticeMode" = 'each' WHERE "mgrNoticeMode" = 'none';
