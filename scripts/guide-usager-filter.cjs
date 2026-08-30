// Extrait du guide complet (docs/Guide-utilisation.md, SOURCE UNIQUE) la VERSION
// USAGER : préambule (sans le sommaire, dont la moitié des liens viserait des
// sections retirées), sections « Pour tous les utilisateurs », « Pour les usagers »,
// « Notions clés » et « Automatismes » (validation auto et rappels concernent
// l'usager). Les sections gestionnaires/administrateurs et « Voir aussi » (liens
// mainteneur) sont écartées ; les numéros de sections sont retirés pour ne pas
// laisser de trous (1, 2, 5, 6…). Partagé par gen-guide-html.mjs et gen-guide-docx.cjs.
function filtrerGuideUsager(md) {
  // Titre propre à la déclinaison.
  let out = md.replace(
    /^# Guide d'utilisation — CultuRésa/m,
    "# Guide de l'usager — CultuRésa",
  );

  // Sommaire du préambule : du libellé « Sommaire : » à la ligne vide suivante.
  out = out.replace(/^Sommaire :[\s\S]*?\n\n/m, "");

  // Découpe en préambule + sections de niveau 2 (chaque section court jusqu'au ## suivant).
  const parts = out.split(/^(?=## )/m);
  const keep = [parts[0]];
  for (const section of parts.slice(1)) {
    if (/^## \d+\. (Pour tous les utilisateurs|Pour les usagers|Notions clés|Automatismes)/.test(section)) {
      keep.push(section.replace(/^## \d+\.\s*/, "## "));
    }
  }
  // Séparateurs orphelins en fin de section conservés tels quels (rendu : simple filet).
  return keep.join("");
}

module.exports = { filtrerGuideUsager };
