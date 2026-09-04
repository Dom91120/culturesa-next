-- Notification DIFFÉRÉE des (dé)validations manuelles (cf. services/validation-notice) :
-- état `validated` connu de l'usager au début de la fenêtre d'hésitation + échéance
-- d'envoi de l'e-mail reflétant l'état final (traitée par /api/cron/validation-notice).
ALTER TABLE "bookings"
  ADD COLUMN "validationNoticeFrom"  BOOLEAN,
  ADD COLUMN "validationNoticeDueAt" TIMESTAMPTZ;

CREATE INDEX "bookings_validationNoticeDueAt_idx" ON "bookings" ("validationNoticeDueAt");
