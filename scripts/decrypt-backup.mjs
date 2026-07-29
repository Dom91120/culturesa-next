#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  Déchiffrement d'un dump CultuRésa, HORS de l'application.
//
//  Outil de REPRISE APRÈS SINISTRE : il doit fonctionner quand l'application ne
//  fonctionne plus. C'est pourquoi il ne dépend de rien — ni du code de l'app, ni
//  d'un paquet npm, seulement de Node. La logique cryptographique y est donc
//  DUPLIQUÉE depuis src/server/services/backup-crypto.ts : c'est un choix, pas un
//  oubli. Toute évolution du format doit être répercutée ici.
//
//  Usage :
//    node scripts/decrypt-backup.mjs <dump.sql.gz.enc> [sortie.sql | -]
//
//    Sans sortie      → écrit à côté, suffixes .enc et .gz retirés.
//    Sortie « - »     → écrit sur la sortie standard (pipe direct vers psql).
//
//  La clé provient de BACKUP_ENCRYPTION_KEY si elle est définie, sinon elle est
//  dérivée de BETTER_AUTH_SECRET — exactement comme dans l'application. Renseignez
//  celle qui était en vigueur AU MOMENT DE LA SAUVEGARDE.
//
//  Exemple :
//    BACKUP_ENCRYPTION_KEY='…' node scripts/decrypt-backup.mjs culturesa-20260729-030000.sql.gz.enc
// ════════════════════════════════════════════════════════════════════════════

import crypto from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const MAGIC = Buffer.from("CULTURESA-BAK1", "ascii");
const FP_LEN = 8;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + FP_LEN + IV_LEN + TAG_LEN;

const die = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

function backupKey() {
  const explicit = process.env.BACKUP_ENCRYPTION_KEY?.trim();
  if (explicit) {
    return Buffer.from(
      crypto.hkdfSync("sha256", explicit, Buffer.alloc(0), "culturesa:backup:v1", 32),
    );
  }
  const root = process.env.BETTER_AUTH_SECRET;
  if (!root) {
    die(
      "Aucune clé disponible. Définissez BACKUP_ENCRYPTION_KEY, ou à défaut\n" +
        "  BETTER_AUTH_SECRET — celle qui était en vigueur lors de la sauvegarde.",
    );
  }
  return Buffer.from(crypto.hkdfSync("sha256", root, Buffer.alloc(0), "backup:aes-256-gcm", 32));
}

const [, , input, output] = process.argv;
if (!input) {
  die("Usage : node scripts/decrypt-backup.mjs <dump.sql.gz.enc> [sortie.sql | -]");
}

let blob;
try {
  blob = readFileSync(input);
} catch (e) {
  die(`Lecture impossible de « ${input} » : ${e.message}`);
}

let plain;
if (blob.length >= HEADER_LEN && blob.subarray(0, MAGIC.length).equals(MAGIC)) {
  const key = backupKey();
  const fp = crypto.createHash("sha256").update(key).digest().subarray(0, FP_LEN);
  if (!blob.subarray(MAGIC.length, MAGIC.length + FP_LEN).equals(fp)) {
    die(
      "Ce dump a été chiffré avec une AUTRE clé que celle fournie.\n" +
        "  Utilisez le secret en vigueur au moment de la sauvegarde.",
    );
  }
  const ivStart = MAGIC.length + FP_LEN;
  const tagStart = ivStart + IV_LEN;
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", key, blob.subarray(ivStart, tagStart));
    d.setAuthTag(blob.subarray(tagStart, HEADER_LEN));
    plain = Buffer.concat([d.update(blob.subarray(HEADER_LEN)), d.final()]);
  } catch {
    die("Clé correcte mais fichier corrompu ou incomplet. Utilisez une autre sauvegarde.");
  }
} else {
  console.error("ℹ Fichier non chiffré (dump antérieur au chiffrement) — simple copie.");
  plain = blob;
}

// Décompression décidée sur le contenu (magic gzip), pas sur le nom.
if (plain.length >= 2 && plain[0] === 0x1f && plain[1] === 0x8b) {
  plain = gunzipSync(plain);
}

if (output === "-") {
  process.stdout.write(plain);
} else {
  const dest = output || input.replace(/\.enc$/, "").replace(/\.gz$/, "");
  if (dest === input) die("Le fichier de sortie serait identique à l'entrée. Précisez un nom.");
  writeFileSync(dest, plain);
  console.error(`✓ ${dest} (${plain.length.toLocaleString("fr-FR")} octets)`);
}
