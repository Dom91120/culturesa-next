-- Simplification des états de PÉRIODE : « desactive » disparaît de leur cycle de vie.
--   - la visibilité usager est portée par exercice."visibleToUsers" (case « Affiché
--     aux utilisateurs ») ;
--   - « exercice précédent » se déduit du rattachement exerciceId (lignage), plus
--     d'un état intermédiaire ;
--   - seuls subsistent « actif » (visible admin) et « archive » (deux bascules en
--     arrière, masqué partout).
-- L'enum EntityState conserve la valeur desactive (utilisée par d'autres tables).
UPDATE "periods" SET "state" = 'actif' WHERE "state" = 'desactive';
