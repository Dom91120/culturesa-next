-- Fusion des valeurs par défaut du service : ponct*/recur* -> capacity + duration.
-- AlterTable
ALTER TABLE "services" DROP COLUMN "ponctCapacity",
DROP COLUMN "ponctDuration",
DROP COLUMN "recurCapacity",
DROP COLUMN "recurDuration",
ADD COLUMN     "capacity" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "duration" INTEGER NOT NULL DEFAULT 60;
