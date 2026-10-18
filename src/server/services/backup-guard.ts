// ════════════════════════════════════════════════════════════════════════════
//  Contrôle du contenu d'un dump avant restauration (constat D2).
//
//  Restaurer une sauvegarde, c'est exécuter du SQL venu de l'extérieur. PostgreSQL
//  offre des instructions qui sortent du périmètre de la base — exécution de
//  programmes, lecture et écriture de fichiers du serveur, chargement d'extensions.
//  Un dump légitime produit par cette application n'en contient aucune.
//
//  ⚠️ BARRIÈRE SECONDAIRE, PAS LE CORRECTIF.
//  C'est un filtre par liste noire : par nature contournable (encodage exotique,
//  découpage inattendu, instruction non prévue ici). La mesure décisive est de
//  faire tourner l'application avec un rôle PostgreSQL non-superutilisateur, qui
//  supprime la CAPACITÉ au lieu d'essayer d'en reconnaître les usages —
//  cf. scripts/db/. Ce module n'existe qu'en défense en profondeur, et pour
//  couvrir la période antérieure à cette bascule.
//
//  ── Pourquoi une analyse structurelle et non un simple grep ──
//  Un dump contient les DONNÉES : le champ « niveau » d'un usager peut très
//  légitimement contenir le texte « CREATE EXTENSION ». Chercher les motifs sur le
//  fichier entier produirait donc des refus absurdes sur des sauvegardes valides.
//  On isole d'abord les blocs de données (`COPY … FROM stdin;` … `\.`), qui ne sont
//  jamais exécutés comme du SQL, et on n'analyse que les instructions.
// ════════════════════════════════════════════════════════════════════════════

/** Refus motivé : le message est destiné à l'exploitant, il doit être explicite. */
export class UnsafeDumpError extends Error {}

type Rule = { re: RegExp; label: string };

// `\s+` partout où un espace est attendu : une instruction répartie sur plusieurs
// lignes ne doit pas passer entre les mailles.
const RULES: Rule[] = [
  {
    re: /\bCOPY\b[\s\S]{0,400}?\b(?:FROM|TO)\s+PROGRAM\b/i,
    label: "COPY … FROM/TO PROGRAM (exécution d'un programme sur le serveur)",
  },
  { re: /\bCREATE\s+(?:OR\s+REPLACE\s+)?EXTENSION\b/i, label: "CREATE EXTENSION" },
  {
    re: /\bALTER\s+SYSTEM\b/i,
    label: "ALTER SYSTEM (modification de la configuration du serveur)",
  },
  {
    re: /\bCREATE\s+TABLESPACE\b/i,
    label: "CREATE TABLESPACE (chemin sur le système de fichiers)",
  },
  {
    re: /\bCREATE\s+(?:EVENT\s+TRIGGER|SUBSCRIPTION|PUBLICATION)\b/i,
    label: "réplication / déclencheur d'événement",
  },
  {
    re: /\bCREATE\s+(?:FOREIGN\s+DATA\s+WRAPPER|SERVER|USER\s+MAPPING)\b/i,
    label: "accès à une source de données externe",
  },
  { re: /\bLANGUAGE\s+(?:'?c'?|internal)\b/i, label: "fonction en langage C ou interne" },
  { re: /\bSECURITY\s+DEFINER\b/i, label: "fonction SECURITY DEFINER (élévation de privilège)" },
  {
    re: /\b(?:pg_read_file|pg_read_binary_file|pg_write_file|pg_ls_dir|pg_stat_file|lo_import|lo_export)\s*\(/i,
    label: "accès au système de fichiers du serveur",
  },
  {
    re: /\b(?:CREATE|ALTER)\s+(?:ROLE|USER)\b[\s\S]{0,200}?\bSUPERUSER\b/i,
    label: "création ou élévation d'un rôle superutilisateur",
  },
  {
    re: /\bGRANT\b[\s\S]{0,200}?\bpg_(?:execute_server_program|read_server_files|write_server_files)\b/i,
    label: "attribution d'un rôle prédéfini privilégié",
  },
  // Un bloc DO exécute du PL/pgSQL arbitraire : il pourrait contenir n'importe
  // laquelle des instructions ci-dessus, hors de portée d'une analyse simple.
  // pg_dump n'en produit jamais : le refuser ne coûte rien.
  { re: /\bDO\s+(?:LANGUAGE\s+\w+\s+)?\$/i, label: "bloc DO (PL/pgSQL arbitraire)" },
];

/**
 * Retire les blocs de DONNÉES d'un dump, pour ne garder que les instructions.
 *
 * `pg_dump` émet `COPY table (colonnes) FROM stdin;` puis les lignes de données,
 * terminées par `\.` seul sur sa ligne. Ces lignes sont des données, jamais du SQL.
 */
const COPY_FROM_STDIN = /^\s*COPY\b[\s\S]*\bFROM\s+stdin\s*;/i;
const END_OF_DATA = /^\\\.\r?$/;

function statementsOnly(sql: string): string {
  const out: string[] = [];
  let inData = false;
  for (const line of sql.split(/\r?\n/)) {
    if (inData) {
      if (END_OF_DATA.test(line)) inData = false; // fin du bloc de données
      continue;
    }
    if (COPY_FROM_STDIN.test(line)) {
      inData = true;
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/**
 * Neutralise les commentaires SQL. Sans cela, un commentaire inséré au milieu
 * d'une instruction suffirait à casser un motif recherché. Ils sont remplacés par
 * une espace, et non supprimés, pour ne pas coller deux mots-clés l'un à l'autre.
 */
function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/**
 * Lève `UnsafeDumpError` si le dump contient une instruction hors du périmètre
 * d'une sauvegarde applicative. Ne renvoie rien s'il est acceptable.
 */
export function assertSafeDump(sql: Buffer | string): void {
  const text = stripComments(statementsOnly(typeof sql === "string" ? sql : sql.toString("utf8")));
  const found = RULES.filter((r) => r.re.test(text)).map((r) => r.label);
  if (text.split("\n").some((l) => PSQL_META.test(l) && !PG_DUMP_RESTRICT.test(l))) {
    found.push(String.raw`méta-commande psql (\!, \o |…, \copy … program, \i…)`);
  }
  if (found.length === 0) return;
  throw new UnsafeDumpError(
    `Ce dump contient des instructions qu'une sauvegarde de l'application ne produit jamais : ${found.join(" ; ")}. ` +
      "Restauration refusée. S'il provient bien de CultuRésa, il a été modifié depuis ; " +
      "utilisez une autre sauvegarde.",
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  Méta-commandes psql (audit 2026-10-18).
//
//  Le dump est lu par `psql`, pas par le serveur : une ligne `\! commande`,
//  `\o |commande`, `\copy … to program`, `\i fichier`, `\gexec`… s'exécute sur la
//  machine qui lance psql (conteneur de l'application, ou conteneur Postgres en mode
//  docker) — HORS de portée du rôle non-superutilisateur. Le filtre ci-dessus ne
//  suffit pas : son repérage des blocs COPY diffère du lexer de psql (une chaîne SQL
//  laissée ouverte sur une fausse ligne `COPY … FROM stdin;` fait passer la suite
//  pour des données), et psql reconnaît aussi un antislash en milieu de ligne.
//
//  ── Mesure décisive : le mode restreint de psql ──
//  `\restrict <clé>` (psql ≥ 18, 17.6, 16.10, 15.14, 14.19, 13.22) interdit toute
//  méta-commande hormis `\unrestrict <même clé>`. On l'injecte EN TÊTE avec une clé
//  aléatoire tirée à chaque restauration : le dump ne peut pas la connaître, donc ne
//  peut pas sortir du mode. C'est psql lui-même qui refuse — aucun écart d'analyse
//  possible. Avec ON_ERROR_STOP, le refus arrête tout et --single-transaction annule
//  (vérifié sur psql 18.6 : sortie en code 3, rien d'exécuté).
//
//  pg_dump 18 émet déjà son propre couple `\restrict` / `\unrestrict` : un second
//  `\restrict` étant refusé en mode restreint, ces lignes sont retirées (à
//  l'identique de ce qu'émet pg_dump, hors blocs de données) avant l'enveloppe.
// ════════════════════════════════════════════════════════════════════════════

/** Ligne commençant par un antislash (commentaires retirés) : méta-commande. */
const PSQL_META = /^\s*\\/;
/** Couple émis par pg_dump ≥ 18 / 17.6 (clé alphanumérique), seul sur sa ligne. */
const PG_DUMP_RESTRICT = /^\\(?:un)?restrict [A-Za-z0-9]+\r?$/;

/**
 * Enveloppe le dump pour psql : `\restrict <clé>` en première ligne, sans
 * `\unrestrict` (psql reste restreint jusqu'à la fin de l'entrée). Travaille en
 * `latin1` — un caractère par octet — pour ne jamais altérer les données, quel que
 * soit l'encodage du dump.
 */
export function confinePsqlScript(sql: Buffer, key: string): Buffer {
  if (!/^[A-Za-z0-9]{32,}$/.test(key)) throw new Error(String.raw`Clé \restrict invalide.`);
  const out = [String.raw`\restrict ` + key];
  let inData = false;
  for (const line of sql.toString("latin1").split("\n")) {
    if (inData) {
      if (END_OF_DATA.test(line)) inData = false;
    } else if (COPY_FROM_STDIN.test(line)) {
      inData = true;
    } else if (PG_DUMP_RESTRICT.test(line)) {
      continue;
    }
    out.push(line);
  }
  return Buffer.from(out.join("\n"), "latin1");
}
