-- Audit 2026-07-24 (code mort) : `services.duration` n'etait ni lue ni ecrite
-- par l'application (la duree d'un creneau vit sur le creneau lui-meme via
-- start_time/end_time). Suppression de la colonne.
ALTER TABLE "services" DROP COLUMN "duration";
