-- File d'attente des e-mails en échec (envoi best-effort), renvoyables depuis
-- Administration > Messagerie.
-- CreateTable
CREATE TABLE "failed_mails" (
    "id" SERIAL NOT NULL,
    "to_addr" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "html" TEXT NOT NULL DEFAULT '',
    "text" TEXT NOT NULL DEFAULT '',
    "error" TEXT NOT NULL DEFAULT '',
    "attempts" SMALLINT NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_tried_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "failed_mails_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "failed_mails_createdAt_idx" ON "failed_mails"("createdAt");
