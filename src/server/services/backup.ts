import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip as gunzipCb, gzip as gzipCb } from "node:zlib";
import { prisma } from "@/server/db";
import { UserFacingError } from "@/server/errors";
import {
  decryptBackup,
  encryptBackup,
  isEncryptedBackup,
  isGzip,
} from "@/server/services/backup-crypto";
import { assertSafeDump } from "@/server/services/backup-guard";

const gzip = promisify(gzipCb);
const gunzip = promisify(gunzipCb);

/**
 * Sauvegardes de la base (dumps PostgreSQL).
 *
 * TOUS les dumps sont produits par l'app dans BACKUPS_DIR : les exports automatiques
 * planifiés (route /api/cron/backup) en `culturesa-<ts>.sql.gz.enc` — seuls concernés
 * par la rotation sur le nombre —, les exports manuels en `manuel-<ts>.sql.gz.enc`
 * et les dumps téléversés, ces deux dernières familles étant purgées sur l'ÂGE
 * (90 jours) plutôt que sur le nombre. Les dumps
 * téléversés en `televerse-<ts>-<nom>.sql[.gz][.enc]`.
 *
 * CHIFFREMENT (constat D1, audit 2026-07-29) : tout dump écrit par l'app l'est en
 * AES-256-GCM (cf. backup-crypto.ts) — ces fichiers contiennent l'intégralité des
 * données nominatives, dont celles de mineurs. Le suffixe `.enc` le signale, mais
 * la détection à la lecture se fait sur le CONTENU : les dumps en clair antérieurs
 * restent restaurables, et un fichier renommé ne trompe pas la restauration.
 *
 * `pg_dump`/`psql` sont exécutés :
 *   - en direct s'ils sont disponibles (PATH ou PG_BIN) — cas de l'image Docker de
 *     l'app (postgresql17-client) ;
 *   - sinon via `docker exec` dans le conteneur Postgres (PG_DOCKER_CONTAINER,
 *     défaut « culturesa-db ») — cas du poste de dev Windows sans outils client.
 */

// Repli en chemin RELATIF (et non path.join(process.cwd(), …)) : un chemin bâti sur
// process.cwd() n'est pas résoluble statiquement, et le traceur de fichiers en concluait
// que n'importe quel fichier du projet pouvait être lu — il embarquait donc TOUT dans
// .next/standalone, jusque dans l'image Docker : .env, dumps SQL en clair, sources
// (audit 2026-07-29). L'exécution est inchangée : les API `fs` résolvent un chemin
// relatif contre process.cwd(). Cf. aussi outputFileTracingExcludes (next.config.ts)
// et .dockerignore. En production BACKUPS_DIR est fourni par docker-compose (/backups) ;
// ce repli ne sert qu'au poste de développement.
const BACKUPS_DIR = process.env.BACKUPS_DIR || "backups";
const DOCKER_CONTAINER = process.env.PG_DOCKER_CONTAINER || "culturesa-db";

// Droits POSIX des dumps et de leur dossier. Sans cela, l'umask du conteneur (022)
// crée des fichiers en 644 : lisibles par tout compte de l'hôte dès que le dossier
// est traversable. Le chiffrement (D1) limite déjà la portée d'une lecture, mais un
// secret protégé à un seul niveau n'est protégé que jusqu'au premier oubli.
// Sans effet sur un fichier existant — les noms étant horodatés, chaque écriture crée.
const FILE_MODE = 0o640;
const DIR_MODE = 0o750;

/** Nom de fichier de dump admissible (liste, téléchargement, restauration, suppression). */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.sql(\.gz)?(\.enc)?$/;

type BackupKind = "auto" | "manuel" | "televerse";
type BackupFile = {
  name: string;
  kind: BackupKind;
  size: number;
  mtime: Date;
  /** Dump chiffré au repos ? `false` = fichier en clair antérieur au constat D1. */
  encrypted: boolean;
};

type BackupMode = "direct" | "docker" | null;

function dbParams() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  return {
    host: url.hostname,
    port: url.port || "5432",
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
  };
}

/** Lance une commande, renvoie stdout (Buffer) ; rejette avec stderr si code ≠ 0. */
function run(
  cmd: string,
  args: string[],
  opts: { env?: Record<string, string>; stdin?: Buffer } = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...opts.env },
      windowsHide: true,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => err.push(c));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(Buffer.concat(err).toString("utf8") || `${cmd} : code ${code}`));
    });
    if (opts.stdin != null) child.stdin.end(opts.stdin);
    else child.stdin.end();
  });
}

// Mode d'exécution détecté une seule fois par process (les outils n'apparaissent
// pas en cours de route). `null` = ni binaires locaux ni conteneur Docker joignable.
let modePromise: Promise<BackupMode> | null = null;

async function detectMode(): Promise<BackupMode> {
  const bin = pgBinPath("pg_dump");
  // Sondes en cascade : l'échec d'une sonde est un résultat attendu (on passe à la
  // suivante), pas une erreur à journaliser — les catch vides sont volontaires.
  try {
    await run(bin, ["--version"]);
    return "direct";
  } catch {}
  try {
    await run("docker", ["exec", DOCKER_CONTAINER, "pg_dump", "--version"]);
    return "docker";
  } catch {}
  return null;
}

export function getBackupMode(): Promise<BackupMode> {
  if (!modePromise) modePromise = detectMode();
  return modePromise;
}

/** Chemin d'un binaire PostgreSQL en mode direct (PG_BIN prioritaire sur le PATH). */
function pgBinPath(tool: string): string {
  return process.env.PG_BIN ? path.join(process.env.PG_BIN, tool) : tool;
}

/** Exécute un outil PostgreSQL selon le mode détecté. */
async function runPgTool(tool: "pg_dump" | "psql", args: string[], stdin?: Buffer) {
  const mode = await getBackupMode();
  const p = dbParams();
  if (mode === "direct") {
    return run(pgBinPath(tool), ["-h", p.host, "-p", p.port, "-U", p.user, ...args], {
      env: { PGPASSWORD: p.password },
      stdin,
    });
  }
  if (mode === "docker") {
    // Dans le conteneur : connexion locale (socket), pas de -h. `-e PGPASSWORD` SANS
    // valeur (docker lit la variable dans l'environnement du process `docker` qu'on
    // spawn) : le mot de passe n'apparaît plus dans les arguments, donc plus dans la
    // liste des process de l'hôte (`ps`) — audit sécurité 2026-07-19. Le mode direct
    // faisait déjà passer PGPASSWORD par `env`.
    return run(
      "docker",
      ["exec", "-i", "-e", "PGPASSWORD", DOCKER_CONTAINER, tool, "-U", p.user, ...args],
      { env: { PGPASSWORD: p.password }, stdin },
    );
  }
  // Message DESTINÉ à l administrateur : il désigne exactement ce qu il doit
  // corriger côté déploiement (constat D7).
  throw new UserFacingError(
    "Outils PostgreSQL indisponibles : ni pg_dump/psql sur la machine (PG_BIN), " +
      `ni conteneur Docker « ${DOCKER_CONTAINER} » joignable.`,
  );
}

function kindOf(name: string): BackupKind {
  if (name.startsWith("manuel-")) return "manuel";
  if (name.startsWith("televerse-")) return "televerse";
  return "auto";
}

/** Liste les dumps du dossier de sauvegardes (plus récent en premier). */
export async function listBackups(): Promise<BackupFile[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(BACKUPS_DIR);
  } catch {
    return []; // dossier pas encore créé
  }
  const files: BackupFile[] = [];
  for (const name of entries) {
    if (!SAFE_NAME.test(name)) continue;
    const full = path.join(BACKUPS_DIR, name);
    const st = await fs.stat(full);
    if (!st.isFile()) continue;
    files.push({
      name,
      kind: kindOf(name),
      size: st.size,
      mtime: st.mtime,
      encrypted: await isFileEncrypted(full),
    });
  }
  files.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return files;
}

/**
 * Le fichier est-il chiffré ? Lit uniquement l'EN-TÊTE (64 octets, l'en-tête complet
 * en faisant 50) : la liste est affichée à chaque visite du panneau, charger des dumps
 * entiers pour cela serait absurde. Détection sur le contenu et non sur l'extension —
 * un fichier renommé ne doit pas être annoncé comme protégé alors qu'il ne l'est pas.
 */
async function isFileEncrypted(full: string): Promise<boolean> {
  let fh: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    fh = await fs.open(full, "r");
    const buf = Buffer.alloc(64);
    const { bytesRead } = await fh.read(buf, 0, 64, 0);
    return isEncryptedBackup(buf.subarray(0, bytesRead));
  } catch {
    return false; // illisible → on n'annonce pas une protection non vérifiée
  } finally {
    await fh?.close();
  }
}

/** Résout un nom de dump vers son chemin, en refusant tout nom hors du dossier. */
export function backupPath(name: string): string {
  if (!SAFE_NAME.test(name)) throw new UserFacingError("Nom de fichier invalide.");
  return path.join(BACKUPS_DIR, name);
}

function timestamp(): string {
  // Même format que backup.sh : YYYYMMDD-HHMMSS (heure locale).
  const d = new Date();
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Dump complet gzippé PUIS CHIFFRÉ → BACKUPS_DIR/<name>.
 *   --clean --if-exists : DROP ... IF EXISTS avant CREATE (restauration sur base existante)
 *   --no-owner --no-privileges : pas de dépendance aux rôles/ACL de l'instance source
 *
 * Ordre gzip → chiffrement : compresser APRÈS chiffrement ne gagnerait rien (un texte
 * chiffré est incompressible). Le dump n'existe en clair qu'en mémoire, jamais sur disque.
 */
async function writeDump(name: string): Promise<BackupFile> {
  const p = dbParams();
  const sql = await runPgTool("pg_dump", [
    "-d",
    p.database,
    "--no-owner",
    "--no-privileges",
    "--clean",
    "--if-exists",
  ]);
  await fs.mkdir(BACKUPS_DIR, { recursive: true, mode: DIR_MODE });
  const gz = await gzip(sql, { level: 9 });
  await fs.writeFile(backupPath(name), encryptBackup(gz), { mode: FILE_MODE });
  const st = await fs.stat(backupPath(name));
  return { name, kind: kindOf(name), size: st.size, mtime: st.mtime, encrypted: true };
}

/** Crée un export manuel (soumis à la rétention par âge, cf. AGE_RETAIN_MS). */
export function createBackup(): Promise<BackupFile> {
  return writeDump(`manuel-${timestamp()}.sql.gz.enc`);
}

// Rotation des exports automatiques : on ne conserve que les RETAIN plus récents
// (≈ une semaine pour une exécution quotidienne) — même politique que l'ancien backup.sh.
const AUTO_RETAIN = 7;

// ── Rétention des exports manuels et téléversés ──
// Ces deux familles échappaient à la rotation et s'accumulaient SANS AUCUNE LIMITE :
// chaque fichier est un dump nominatif complet, incluant des données de mineurs.
// Le chiffrement (D1) les rend inoffensifs en cas de copie, mais un dump qu'on ne
// garde pas reste plus sûr qu'un dump chiffré — et la minimisation de la durée de
// conservation est une exigence propre du RGPD, distincte de la protection.
//
// Compté en JOURS et non en « mois » : trois mois calendaires durent entre 89 et 92
// jours selon la date de départ. Une durée fixe rend la purge prévisible et le test
// reproductible ; l'écart avec un trimestre exact est sans portée ici.
const AGE_RETAIN_DAYS = 90; // ≈ 3 mois — arbitrage d'exploitation, 2026-07-30
const AGE_RETAIN_MS = AGE_RETAIN_DAYS * 24 * 60 * 60 * 1000;

/** Familles soumises à la rétention par âge (les `culturesa-*` relèvent d'AUTO_RETAIN). */
const AGE_RETAIN_PREFIXES = ["manuel-", "televerse-"] as const;

/**
 * Supprime les exports manuels et téléversés de plus de AGE_RETAIN_DAYS jours.
 *
 * GARDE-FOU : ne supprime jamais le DERNIER dump disponible, toutes familles
 * confondues. Si la sauvegarde automatique est en panne depuis des mois — le
 * moment précis où l'on a le plus besoin d'une copie —, un export manuel ancien
 * peut être la seule qui reste. Une purge qui viderait le dossier ferait plus de
 * dégâts que les données qu'elle est censée ne pas laisser traîner.
 *
 * Exporté pour être éprouvé isolément : une fonction qui supprime des fichiers ne
 * doit pas n'être atteignable qu'au travers d'un `pg_dump`.
 */
export async function purgeAgedBackups(now = Date.now()): Promise<number> {
  const all = await listBackups();
  const perimes = all.filter(
    (f) =>
      AGE_RETAIN_PREFIXES.some((p) => f.name.startsWith(p)) &&
      now - f.mtime.getTime() > AGE_RETAIN_MS,
  );
  // `all.length - perimes.length` = ce qui subsisterait. On ne descend pas à zéro.
  if (perimes.length > 0 && all.length === perimes.length) {
    const [plusRecent] = perimes.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    console.warn(
      `[backup] purge par âge : ${plusRecent.name} conservé, c'est le dernier dump disponible.`,
    );
    perimes.shift();
  }
  for (const f of perimes) await fs.unlink(backupPath(f.name));
  return perimes.length;
}

/**
 * Export automatique planifié (route /api/cron/backup) : dump `culturesa-<ts>.sql.gz`,
 * rotation des `culturesa-*` sur le NOMBRE, puis purge des exports manuels et
 * téléversés sur l'ÂGE.
 *
 * Deux politiques distinctes, parce que les besoins le sont : les exports automatiques
 * forment une série régulière dont on veut les N derniers états ; les exports manuels et
 * téléversés arrivent au gré des opérations, et compter les plus récents y conserverait
 * indéfiniment un fichier isolé vieux de trois ans.
 *
 * La purge par âge est adossée à la tâche de sauvegarde plutôt qu'à une planification
 * propre : une tâche de moins à surveiller, et elle ne peut pas vider le dossier au
 * moment même où l'on constate que plus aucune sauvegarde n'est produite.
 */
export async function createAutoBackup(): Promise<{
  file: BackupFile;
  purged: number;
  purgedAged: number;
}> {
  const file = await writeDump(`culturesa-${timestamp()}.sql.gz.enc`);
  const autos = (await listBackups()).filter((f) => f.name.startsWith("culturesa-"));
  const olds = autos.slice(AUTO_RETAIN); // listBackups renvoie les plus récents d'abord
  for (const f of olds) await fs.unlink(backupPath(f.name));
  return { file, purged: olds.length, purgedAged: await purgeAgedBackups() };
}

/**
 * Enregistre un dump téléversé (.sql, .sql.gz, ou .enc produit par cette application).
 *
 * Le contenu est CHIFFRÉ avant écriture s'il ne l'est pas déjà : un dump réintroduit
 * depuis une copie hors-site ne doit pas rouvrir la brèche que D1 vient de fermer.
 * `encryptBackup` étant idempotent, un fichier déjà chiffré est stocké tel quel — et
 * conserve donc la clé qui l'a produit, laquelle peut différer de la clé courante
 * (la restauration le signalera explicitement le cas échéant).
 */
/**
 * Contrôle du contenu AU TÉLÉVERSEMENT : retour immédiat plutôt qu'à la
 * restauration, quand l'administrateur a le fichier sous les yeux.
 *
 * Best-effort volontaire : si le contenu ne peut pas être lu (chiffré avec une
 * autre clé, gzip corrompu), on laisse passer. Refuser ici empêcherait de STOCKER
 * une sauvegarde ancienne parfaitement légitime — et la restauration, elle,
 * contrôle systématiquement. Le vrai verrou est là-bas.
 */
async function rejectUnsafeUpload(data: Buffer): Promise<void> {
  let plain: Buffer;
  try {
    plain = isEncryptedBackup(data) ? decryptBackup(data) : data;
    if (isGzip(plain)) plain = await gunzip(plain);
  } catch {
    return;
  }
  assertSafeDump(plain);
}

export async function saveUploadedBackup(originalName: string, data: Buffer): Promise<string> {
  const base = path
    .basename(originalName)
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._-]+/, "");
  if (!/\.sql(\.gz)?(\.enc)?$/.test(base)) {
    throw new UserFacingError("Extension attendue : .sql, .sql.gz ou .sql.gz.enc");
  }
  await rejectUnsafeUpload(data);
  // Le contenu écrit est TOUJOURS chiffré (encryptBackup est idempotent) : le suffixe
  // `.enc` doit donc être systématique, y compris pour un fichier déjà chiffré arrivé
  // sous un autre nom. Sinon la liste annoncerait « en clair » un fichier protégé.
  const name = `televerse-${timestamp()}-${base}${base.endsWith(".enc") ? "" : ".enc"}`;
  if (!SAFE_NAME.test(name)) throw new UserFacingError("Nom de fichier invalide.");
  await fs.mkdir(BACKUPS_DIR, { recursive: true, mode: DIR_MODE });
  await fs.writeFile(backupPath(name), encryptBackup(data), { mode: FILE_MODE });
  return name;
}

/**
 * Restaure la base à partir d'un dump du dossier. Le dump (généré avec
 * --clean --if-exists) recrée les objets ; --single-transaction garantit le
 * tout-ou-rien, ON_ERROR_STOP arrête à la première erreur.
 * Le pool Prisma est recyclé ensuite (les connexions ouvertes pendant la
 * restauration porteraient des plans invalidés).
 */
export async function restoreBackup(name: string): Promise<void> {
  const file = backupPath(name);
  // Type explicite : `fs.readFile` renvoie un Buffer plus étroit (NonSharedBuffer) que
  // celui produit par le déchiffrement, qui est réaffecté ici.
  let sql: Buffer = await fs.readFile(file);
  // Déchiffrement puis décompression, décidés sur le CONTENU (magic) et non sur
  // l'extension : un fichier renommé, ou un dump en clair antérieur au chiffrement
  // (constat D1), se restaure correctement dans tous les cas. `decryptBackup` laisse
  // passer un contenu non chiffré et lève un message explicite si la clé ne
  // correspond pas — cf. backup-crypto.ts.
  sql = decryptBackup(sql);
  if (isGzip(sql)) sql = await gunzip(sql);
  // Dernière barrière avant `psql` : restaurer, c'est exécuter du SQL venu de
  // l'extérieur (constat D2). Contrôle placé ICI plutôt qu'au téléversement seul,
  // car c'est le point de passage OBLIGÉ — il couvre aussi un fichier déposé
  // directement dans le dossier de sauvegardes. Barrière secondaire : la mesure
  // décisive reste le rôle PostgreSQL non-superutilisateur (cf. scripts/db/).
  assertSafeDump(sql);
  const p = dbParams();
  await runPgTool(
    "psql",
    ["-d", p.database, "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", "-"],
    sql,
  );
  await prisma.$disconnect();
}

/** Supprime un dump du dossier. */
export async function deleteBackup(name: string): Promise<void> {
  await fs.unlink(backupPath(name));
}
