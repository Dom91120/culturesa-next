-- L'adaptateur Prisma de Better Auth génère un `id` pour tout enregistrement
-- créé. Sans ce champ, `prisma.rateLimit.create()` échouait sur « Unknown
-- argument id » — et donc TOUTE tentative de connexion (le quota par IP est
-- consulté avant la vérification des identifiants).
--
-- La table ne contient que des compteurs éphémères : on la vide plutôt que de
-- fabriquer des identifiants pour des lignes sans valeur. Le seul effet est de
-- remettre les quotas en cours à zéro.
TRUNCATE TABLE "rate_limits";

ALTER TABLE "rate_limits" DROP CONSTRAINT "rate_limits_pkey";
ALTER TABLE "rate_limits" ADD COLUMN "id" TEXT NOT NULL;
ALTER TABLE "rate_limits" ADD CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("id");

-- `key` reste la clé fonctionnelle, désormais en index unique.
CREATE UNIQUE INDEX "rate_limits_key_key" ON "rate_limits"("key");
