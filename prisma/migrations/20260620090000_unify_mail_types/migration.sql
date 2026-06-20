-- Unification du stockage des e-mails : `mail_types` devient la table UNIQUE (métadonnées
-- + contenu) avec clé composite (service_id, key). service_id = '' ⇒ niveau global.

ALTER TABLE "mail_types" DROP CONSTRAINT "mail_types_pkey";

ALTER TABLE "mail_types" ADD COLUMN "service_id" TEXT NOT NULL DEFAULT '';
ALTER TABLE "mail_types" ADD COLUMN "subject" TEXT NOT NULL DEFAULT '';
ALTER TABLE "mail_types" ADD COLUMN "html" TEXT NOT NULL DEFAULT '';
ALTER TABLE "mail_types" ADD COLUMN "builtin" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "mail_types" ADD COLUMN "system" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "mail_types" ADD COLUMN "position" SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE "mail_types" ALTER COLUMN "label" SET DEFAULT '';

ALTER TABLE "mail_types" ADD CONSTRAINT "mail_types_pkey" PRIMARY KEY ("service_id", "key");
