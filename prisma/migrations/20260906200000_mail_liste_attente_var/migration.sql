-- E-mails « demande refusée » et « réservation supprimée » : rappel de la liste d'attente
-- ({{liste_attente}}, paragraphe HTML fourni par le code, vide si le service n'en a pas ou si
-- l'annulation vient de l'usager). Les modèles vivent en base (mail_types) : la variable est
-- insérée avant la formule de politesse dans chaque modèle qui ne la porte pas encore
-- (modèle global comme surcharges par service).
UPDATE "mail_types"
   SET "html" = replace("html", '<p>Cordialement', '{{liste_attente}}' || chr(10) || '<p>Cordialement')
 WHERE "key" IN ('booking_refused', 'booking_cancelled')
   AND "html" IS NOT NULL
   AND position('{{liste_attente}}' IN "html") = 0
   AND position('<p>Cordialement' IN "html") > 0;
