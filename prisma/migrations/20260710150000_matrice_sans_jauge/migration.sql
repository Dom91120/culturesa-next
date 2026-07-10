-- Nettoyage : la jauge est portée par CHAQUE CRÉNEAU (slots.jauge, posée à la
-- création via le mode jauge de l'agenda admin) — la colonne par demandeur de la
-- matrice service × demandeurs n'a plus aucun consommateur métier (les créneaux
-- existants ont été initialisés depuis cette dérivation par la migration
-- 20260710120000_jauge_par_creneau).
ALTER TABLE "service_demandeur_settings" DROP COLUMN "jauge";
