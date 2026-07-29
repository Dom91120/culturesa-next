import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BackupCryptoError,
  decryptBackup,
  encryptBackup,
  isEncryptedBackup,
  isGzip,
} from "./backup-crypto";

// La clé est lue dans l'environnement à CHAQUE appel (pas de mémoïsation) : on peut
// donc simuler un changement de secret entre sauvegarde et restauration.
const ORIG = process.env.BACKUP_ENCRYPTION_KEY;
beforeEach(() => {
  process.env.BACKUP_ENCRYPTION_KEY = "cle-de-test-tres-longue-et-aleatoire";
});
afterEach(() => {
  if (ORIG === undefined) delete process.env.BACKUP_ENCRYPTION_KEY;
  else process.env.BACKUP_ENCRYPTION_KEY = ORIG;
});

const DUMP = Buffer.from("-- PostgreSQL database dump\nCREATE TABLE t (id int);\n", "utf8");

describe("encryptBackup / decryptBackup — aller-retour", () => {
  it("restitue le contenu à l'identique", () => {
    expect(decryptBackup(encryptBackup(DUMP))).toEqual(DUMP);
  });

  it("le contenu chiffré ne laisse pas fuiter le clair", () => {
    const enc = encryptBackup(DUMP);
    expect(enc.includes("CREATE TABLE")).toBe(false);
    expect(enc.includes("PostgreSQL")).toBe(false);
  });

  it("deux chiffrements du même dump diffèrent (IV aléatoire)", () => {
    expect(encryptBackup(DUMP).equals(encryptBackup(DUMP))).toBe(false);
  });

  it("supporte un contenu vide", () => {
    expect(decryptBackup(encryptBackup(Buffer.alloc(0)))).toEqual(Buffer.alloc(0));
  });

  it("chiffrement idempotent : un dump déjà chiffré n'est pas rechiffré", () => {
    const once = encryptBackup(DUMP);
    expect(encryptBackup(once).equals(once)).toBe(true);
  });
});

describe("rétro-compatibilité — dumps EN CLAIR antérieurs au chiffrement", () => {
  it("un contenu non chiffré traverse decryptBackup inchangé", () => {
    // Invariant vital : les sauvegardes déjà sur disque doivent rester restaurables.
    expect(decryptBackup(DUMP)).toEqual(DUMP);
  });

  it("un gzip en clair traverse inchangé", () => {
    const gz = gzipSync(DUMP);
    expect(decryptBackup(gz)).toEqual(gz);
  });
});

describe("détection de format", () => {
  it("isEncryptedBackup distingue chiffré et clair", () => {
    expect(isEncryptedBackup(encryptBackup(DUMP))).toBe(true);
    expect(isEncryptedBackup(DUMP)).toBe(false);
    expect(isEncryptedBackup(gzipSync(DUMP))).toBe(false);
  });

  it("isEncryptedBackup ne se laisse pas piéger par un fichier trop court", () => {
    expect(isEncryptedBackup(Buffer.from("CULTURESA-BAK1", "ascii"))).toBe(false);
    expect(isEncryptedBackup(Buffer.alloc(0))).toBe(false);
  });

  it("isGzip reconnaît le magic gzip", () => {
    expect(isGzip(gzipSync(DUMP))).toBe(true);
    expect(isGzip(DUMP)).toBe(false);
    // Un dump chiffré n'est jamais vu comme gzip (l'ordre gzip→chiffrement l'exige).
    expect(isGzip(encryptBackup(gzipSync(DUMP)))).toBe(false);
  });
});

describe("échecs — messages exploitables par l'exploitant", () => {
  it("mauvaise clé : signalée comme telle, pas comme corruption", () => {
    const enc = encryptBackup(DUMP);
    process.env.BACKUP_ENCRYPTION_KEY = "une-tout-autre-cle";
    expect(() => decryptBackup(enc)).toThrow(BackupCryptoError);
    expect(() => decryptBackup(enc)).toThrow(/AUTRE clé/);
  });

  it("fichier altéré, bonne clé : signalé comme corruption", () => {
    const enc = encryptBackup(DUMP);
    enc[enc.length - 1] ^= 0xff; // altère le dernier octet du texte chiffré
    expect(() => decryptBackup(enc)).toThrow(BackupCryptoError);
    expect(() => decryptBackup(enc)).toThrow(/corrompu/);
  });

  it("fichier tronqué : détecté", () => {
    const enc = encryptBackup(DUMP);
    expect(() => decryptBackup(enc.subarray(0, enc.length - 5))).toThrow(BackupCryptoError);
  });

  it("en-tête altéré (tag GCM) : détecté", () => {
    const enc = encryptBackup(DUMP);
    enc[40] ^= 0xff; // dans la zone du tag d'authentification
    expect(() => decryptBackup(enc)).toThrow(BackupCryptoError);
  });
});

describe("chaîne complète telle que l'applique writeDump / restoreBackup", () => {
  it("gzip puis chiffrement, puis déchiffrement et détection gzip", () => {
    const stored = encryptBackup(gzipSync(DUMP));
    expect(isEncryptedBackup(stored)).toBe(true);
    const back = decryptBackup(stored);
    expect(isGzip(back)).toBe(true);
  });
});
