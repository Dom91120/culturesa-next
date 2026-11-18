-- Rôle « Direction des accueils de loisirs » (Dom 2026-11-18) : lecture seule, accès
-- automatique aux services qui acceptent une catégorie « accueil de loisirs ».
-- Additif : aucun compte existant ne change de rôle. Migration SEULE dans son fichier :
-- PostgreSQL interdit d'utiliser une valeur d'enum dans la transaction qui l'ajoute.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'direction_loisirs' BEFORE 'gestionnaire';
