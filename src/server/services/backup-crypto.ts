import crypto from "node:crypto";
import { deriveKey } from "@/server/crypto";
import { UserFacingError } from "@/server/errors";

// ════════════════════════════════════════════════════════════════════════════
//  Chiffrement des dumps de la base (constat D1 de l'audit 2026-07-29).
//
//  Les sauvegardes contiennent l'INTÉGRALITÉ des données nominatives, dont
//  celles de mineurs (noms, e-mails, téléphones, écoles, effectifs enfants).
//  Elles étaient déposées en clair — `gzip` n'est PAS du chiffrement — sur le
//  système de fichiers de l'hôte, téléchargeables via l'interface.
//
//  AES-256-GCM (chiffrement authentifié : toute altération est détectée au
//  déchiffrement). Même primitive que server/secret-crypto.ts, mais sur des
//  fichiers binaires plutôt que des chaînes de configuration.
//
//  ── Format du fichier ──
//    [ 0 ..14[  magic « CULTURESA-BAK1 »   (14 o) — identifie le format
//    [14 ..22[  empreinte de clé            ( 8 o) — diagnostic « mauvaise clé »
//    [22 ..34[  IV                          (12 o)
//    [34 ..50[  tag d'authentification GCM  (16 o)
//    [50 ..  [  texte chiffré
//
//  ── Rétro-compatibilité ──
//  Les dumps EN CLAIR déjà présents restent restaurables : la détection se fait
//  sur le magic, pas sur l'extension (cf. isEncryptedBackup). Aucune migration
//  automatique n'est tentée — réécrire des sauvegardes existantes est une
//  opération à risque qui doit rester une décision d'exploitation.
// ════════════════════════════════════════════════════════════════════════════

const MAGIC = Buffer.from("CULTURESA-BAK1", "ascii"); // 14 octets
const FP_LEN = 8;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + FP_LEN + IV_LEN + TAG_LEN; // 50

/** Erreur de déchiffrement porteuse d'un message exploitable par l'exploitant. */
/**
 * Erreur de chiffrement/déchiffrement d un dump.
 *
 * Destinée à l USAGER (constat D7) : ses messages distinguent « mauvaise clé » de
 * « fichier altéré » — deux diagnostics qui appellent des gestes opposés. Les taire
 * derrière un libellé générique rendrait la restauration indiagnosticable.
 */
export class BackupCryptoError extends UserFacingError {}

/**
 * Clé de chiffrement des dumps, et sa provenance.
 *
 * Par défaut, dérivée du secret applicatif comme le reste (server/crypto.ts) :
 * zéro configuration, chiffrement actif dès le déploiement. `BACKUP_ENCRYPTION_KEY`
 * permet de la DÉCOUPLER de `BETTER_AUTH_SECRET` — recommandé, car ces deux secrets
 * n'ont pas le même cycle de vie : faire tourner le secret applicatif est une
 * opération courante, perdre la clé des sauvegardes rend la reprise après sinistre
 * impossible.
 *
 * ⚠️ Dans les DEUX cas, la clé (ou `BETTER_AUTH_SECRET`) doit être sauvegardée
 * SÉPARÉMENT des dumps, et hors de la machine qui les héberge. Un dump chiffré
 * sans sa clé n'est plus une sauvegarde.
 */
function backupKey(): Buffer {
  const explicit = process.env.BACKUP_ENCRYPTION_KEY?.trim();
  if (explicit) {
    // HKDF : accepte n'importe quelle chaîne (pas d'exigence de longueur exacte),
    // avec séparation de domaine par `info`, comme server/crypto.ts.
    return Buffer.from(
      crypto.hkdfSync("sha256", explicit, Buffer.alloc(0), "culturesa:backup:v1", 32),
    );
  }
  return deriveKey("backup:aes-256-gcm");
}

/**
 * Empreinte courte de la clé, écrite en clair dans l'en-tête. Ne révèle rien
 * (condensat tronqué) mais permet de distinguer « mauvaise clé » de « fichier
 * corrompu » — sans elle, les deux cas donnent le même échec d'authentification
 * GCM, et l'exploitant ne sait pas s'il doit chercher sa clé ou son fichier.
 */
function keyFingerprint(key: Buffer): Buffer {
  return crypto.createHash("sha256").update(key).digest().subarray(0, FP_LEN);
}

/** Ce contenu est-il un dump chiffré par ce module ? (détection par magic) */
export function isEncryptedBackup(data: Buffer): boolean {
  return data.length >= HEADER_LEN && data.subarray(0, MAGIC.length).equals(MAGIC);
}

/** Ce contenu est-il un flux gzip ? (magic 0x1f 0x8b — indépendant du nom de fichier) */
export function isGzip(data: Buffer): boolean {
  return data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b;
}

/** Chiffre un dump. Déjà chiffré → renvoyé inchangé (idempotent). */
export function encryptBackup(plain: Buffer): Buffer {
  if (isEncryptedBackup(plain)) return plain;
  const key = backupKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, keyFingerprint(key), iv, cipher.getAuthTag(), ct]);
}

/**
 * Déchiffre un dump. Un contenu NON chiffré est renvoyé tel quel (dumps en clair
 * antérieurs à D1 : ils doivent rester restaurables).
 *
 * Lève `BackupCryptoError` avec un message actionnable — contrairement au reste du
 * code où l'on échoue en silence : ici l'exploitant est en train de restaurer, il
 * doit savoir POURQUOI ça échoue.
 */
export function decryptBackup(stored: Buffer): Buffer {
  if (!isEncryptedBackup(stored)) return stored;

  const key = backupKey();
  const fp = stored.subarray(MAGIC.length, MAGIC.length + FP_LEN);
  if (!fp.equals(keyFingerprint(key))) {
    throw new BackupCryptoError(
      "Ce dump a été chiffré avec une AUTRE clé que celle configurée. " +
        "Vérifiez BACKUP_ENCRYPTION_KEY (ou BETTER_AUTH_SECRET si elle n'est pas définie) : " +
        "il s'agit probablement du secret en vigueur au moment de la sauvegarde.",
    );
  }

  const ivStart = MAGIC.length + FP_LEN;
  const tagStart = ivStart + IV_LEN;
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      stored.subarray(ivStart, tagStart),
    );
    decipher.setAuthTag(stored.subarray(tagStart, HEADER_LEN));
    return Buffer.concat([decipher.update(stored.subarray(HEADER_LEN)), decipher.final()]);
  } catch {
    // Empreinte bonne mais authentification GCM en échec → le fichier a été
    // tronqué ou altéré (transfert incomplet, disque défaillant).
    throw new BackupCryptoError(
      "Dump illisible : la clé est la bonne mais le fichier est corrompu ou incomplet " +
        "(transfert interrompu, support défaillant). Utilisez une autre sauvegarde.",
    );
  }
}
