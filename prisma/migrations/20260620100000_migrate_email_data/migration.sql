-- Migration de DONNÉES idempotente : déplace les e-mails restés dans `app_config`
-- (surcharges de contenu `mail.tpl.*`, registres `mail.custom.types*`) vers `mail_types`,
-- et fige les drapeaux/ordre des types INTÉGRÉS. No-op si déjà migré (dev) ou base neuve.

DO $$
DECLARE
  builtin_keys text[] := ARRAY[
    'booking_confirmed','booking_pending','booking_unvalidated','booking_cancelled',
    'booking_refused','booking_reminder','email_verification','password_reset',
    'account_deletion_request','account_deletion_notice','email_test','manager_digest'];
  system_keys text[] := ARRAY[
    'email_verification','password_reset','account_deletion_request',
    'account_deletion_notice','email_test','manager_digest'];
  i int;
  rec record;
  parts text[];
  n int;
  scope text;
  tkey text;
  part text;
  reg_svc text;
  elem jsonb;
BEGIN
  -- A) Drapeaux + ordre des types INTÉGRÉS (lignes globales existantes ; n'écrase pas le contenu).
  FOR i IN 1 .. array_length(builtin_keys, 1) LOOP
    UPDATE "mail_types"
       SET "builtin" = true,
           "system"  = (builtin_keys[i] = ANY(system_keys)),
           "position" = i
     WHERE "service_id" = '' AND "key" = builtin_keys[i];
  END LOOP;

  -- B) Surcharges de contenu : 'mail.tpl.<key>.<part>' (global) ou 'mail.tpl.<svc>.<key>.<part>'.
  FOR rec IN SELECT cfg_key, cfg_value FROM "app_config" WHERE cfg_key LIKE 'mail.tpl.%' LOOP
    parts := regexp_split_to_array(rec.cfg_key, '[.]');
    n := array_length(parts, 1);
    IF n = 4 THEN
      scope := ''; tkey := parts[3]; part := parts[4];
    ELSIF n = 5 THEN
      scope := parts[3]; tkey := parts[4]; part := parts[5];
    ELSE
      CONTINUE;
    END IF;
    IF part NOT IN ('subject', 'html') THEN CONTINUE; END IF;

    INSERT INTO "mail_types" ("service_id", "key", "builtin")
      VALUES (scope, tkey, tkey = ANY(builtin_keys))
      ON CONFLICT ("service_id", "key") DO NOTHING;

    IF part = 'subject' THEN
      UPDATE "mail_types" SET "subject" = COALESCE(rec.cfg_value, '')
        WHERE "service_id" = scope AND "key" = tkey;
    ELSE
      UPDATE "mail_types" SET "html" = COALESCE(rec.cfg_value, '')
        WHERE "service_id" = scope AND "key" = tkey;
    END IF;
  END LOOP;

  -- C) Registres de types perso : 'mail.custom.types' (global) et 'mail.custom.types.<svc>'.
  FOR rec IN
    SELECT cfg_key, cfg_value FROM "app_config"
    WHERE cfg_key = 'mail.custom.types' OR cfg_key LIKE 'mail.custom.types.%'
  LOOP
    IF rec.cfg_key = 'mail.custom.types' THEN
      reg_svc := '';
    ELSE
      reg_svc := substring(rec.cfg_key from 'mail[.]custom[.]types[.](.*)');
    END IF;
    IF rec.cfg_value IS NULL OR rec.cfg_value = '' THEN CONTINUE; END IF;

    FOR elem IN SELECT value FROM jsonb_array_elements(rec.cfg_value::jsonb) AS value LOOP
      IF elem->>'key' IS NULL THEN CONTINUE; END IF;
      INSERT INTO "mail_types" ("service_id", "key", "label", "description", "recipient", "builtin")
        VALUES (reg_svc, elem->>'key', COALESCE(elem->>'label', ''),
                COALESCE(elem->>'description', ''), COALESCE(elem->>'recipient', ''), false)
        ON CONFLICT ("service_id", "key") DO UPDATE
          SET "label" = EXCLUDED."label",
              "description" = EXCLUDED."description",
              "recipient" = EXCLUDED."recipient",
              "builtin" = false;
    END LOOP;
  END LOOP;

  -- D) Nettoyage des clés app_config migrées.
  DELETE FROM "app_config"
   WHERE cfg_key LIKE 'mail.tpl.%'
      OR cfg_key = 'mail.custom.types'
      OR cfg_key LIKE 'mail.custom.types.%';
END $$;
