-- CreateTable
CREATE TABLE "mail_triggers" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "default_kind" TEXT NOT NULL,
    "position" SMALLINT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_triggers_pkey" PRIMARY KEY ("key")
);
