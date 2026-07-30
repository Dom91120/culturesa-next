-- CreateTable
CREATE TABLE "audit_log" (
    "id" SERIAL NOT NULL,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_label" TEXT NOT NULL DEFAULT '',
    "actor_role" TEXT NOT NULL DEFAULT '',
    "target" TEXT,
    "details" JSONB,
    "ip" TEXT,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_log_at_idx" ON "audit_log"("at");

-- CreateIndex
CREATE INDEX "audit_log_action_idx" ON "audit_log"("action");

-- CreateIndex
CREATE INDEX "audit_log_actor_id_idx" ON "audit_log"("actor_id");
