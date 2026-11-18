-- Marqueur « accueil de loisirs » sur la catégorie de demandeur (Dom 2026-11-18) :
-- périmètre du rôle `direction_loisirs`. Additif, défaut false.
ALTER TABLE "demandeurs"
  ADD COLUMN "accueilLoisirs" BOOLEAN NOT NULL DEFAULT false;

-- Reprise de l'existant d'après le libellé (« Accueil de loisir(s) … », « ALSH »,
-- « Centre de loisirs »), insensible à la casse. Le marqueur reste ensuite éditable
-- dans Administration › Configuration : c'est lui, et non le libellé, qui fait foi.
UPDATE "demandeurs"
   SET "accueilLoisirs" = true
 WHERE "label" ~* '(accueils?|centres?)\s+de\s+loisirs?|\malsh\M';
