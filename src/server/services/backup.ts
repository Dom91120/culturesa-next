import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip as gunzipCb, gzip as gzipCb } from "node:zlib";
import { prisma } from "@/server/db";

const gzip = promisify(gzipCb);
const gunzip = promisify(gunzipCb);

/**
 * Sauvegardes de la base (dumps PostgreSQL).
 *
 * Le dossier est PARTAGÉ avec le cron de production (docker-compose : ./backups monté
 * dans le conteneur cron, cf. cron/backup.sh) : les dumps automatiques y atterrissent
 * en `culturesa-<ts>.sql.gz`, les exports manuels créés ici en `manuel-<ts>.sql.gz`
 * (préfixe différent → hors du glob de rotation de backup.sh), les dumps téléversés
 * en `televerse-<ts>-<nom>.sql[.gz]`.
 *
 * `pg_dump`/`psql` sont exécutés :
 *   - en direct s'ils sont disponibles (PATH ou PG_BIN) — cas de l'image Docker de
 *     l'app (postgresql17-client) ;
 *   - sinon via `docker exec` dans le conteneur Postgres (PG_DOCKER_CONTAINER,
 *     défaut « culturesa-db ») — cas du poste de dev Windows sans outils client.
 */

const BACKUPS_DIR = process.env.BACKUPS_DIR || path.join(process.cwd(), "backups");
const DOCKER_CONTAINER = process.env.PG_DOCKER_CONTAINER || "culturesa-db";

/** Nom de fichier de dump admissible (liste, téléchargement, restauration, suppression). */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.sql(\.gz)?$/;

export type BackupKind = "auto" | "manuel" | "televerse";
export type BackupFile = {
  name: string;
  kind: BackupKind;
  size: number;
  mtime: Date;
};

export type BackupMode = "direct" | "docker" | null;

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
  throw new Error(
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
    const st = await fs.stat(path.join(BACKUPS_DIR, name));
    if (!st.isFile()) continue;
    files.push({ name, kind: kindOf(name), size: st.size, mtime: st.mtime });
  }
  files.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return files;
}

/** Résout un nom de dump vers son chemin, en refusant tout nom hors du dossier. */
export function backupPath(name: string): string {
  if (!SAFE_NAME.test(name)) throw new Error("Nom de fichier invalide.");
  return path.join(BACKUPS_DIR, name);
}

function timestamp(): string {
  // Même format que backup.sh : YYYYMMDD-HHMMSS (heure locale).
  const d = new Date();
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Crée un export manuel (mêmes options que le dump automatique de backup.sh). */
export async function createBackup(): Promise<BackupFile> {
  const p = dbParams();
  const sql = await runPgTool("pg_dump", [
    "-d",
    p.database,
    "--no-owner",
    "--no-privileges",
    "--clean",
    "--if-exists",
  ]);
  const name = `manuel-${timestamp()}.sql.gz`;
  await fs.mkdir(BACKUPS_DIR, { recursive: true });
  const gz = await gzip(sql, { level: 9 });
  await fs.writeFile(backupPath(name), gz);
  const st = await fs.stat(backupPath(name));
  return { name, kind: "manuel", size: st.size, mtime: st.mtime };
}

/** Enregistre un dump téléversé (contenu .sql ou .sql.gz déjà validé par l'appelant). */
export async function saveUploadedBackup(originalName: string, data: Buffer): Promise<string> {
  const base = path
    .basename(originalName)
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._-]+/, "");
  if (!/\.sql(\.gz)?$/.test(base)) throw new Error("Extension attendue : .sql ou .sql.gz");
  const name = `televerse-${timestamp()}-${base}`;
  if (!SAFE_NAME.test(name)) throw new Error("Nom de fichier invalide.");
  await fs.mkdir(BACKUPS_DIR, { recursive: true });
  await fs.writeFile(backupPath(name), data);
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
  let sql = await fs.readFile(file);
  if (name.endsWith(".gz")) sql = await gunzip(sql);
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
