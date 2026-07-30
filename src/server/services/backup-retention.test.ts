import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// BACKUPS_DIR est lu UNE FOIS à l'import du module : le dossier temporaire doit
// donc être posé avant, l'import être dynamique, et le cache de modules vidé entre
// deux tests — sans quoi tous réutiliseraient le dossier du premier. Un `import`
// statique en tête de fichier figerait le chemin sur "backups" : la purge
// s'exercerait alors sur le vrai dossier de sauvegardes du poste. C'est exactement
// le genre de test qui, mal écrit, cause le dommage qu'il prétend prévenir.
let dir: string;
let purgeAgedBackups: (now?: number) => Promise<number>;

const JOUR = 24 * 60 * 60 * 1000;
const AGE_RETAIN_MS = 90 * JOUR;
const MAINTENANT = Date.UTC(2026, 6, 30, 12, 0, 0);

/** Écrit un dump factice et lui donne l'âge voulu. */
async function poser(nom: string, ageJours: number) {
  const p = path.join(dir, nom);
  await fs.writeFile(p, "-- dump factice\n");
  const t = new Date(MAINTENANT - ageJours * JOUR);
  await fs.utimes(p, t, t);
}

async function restants(): Promise<string[]> {
  return (await fs.readdir(dir)).sort();
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "culturesa-retention-"));
  process.env.BACKUPS_DIR = dir;
  vi.resetModules();
  ({ purgeAgedBackups } = await import("./backup"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
  process.env.BACKUPS_DIR = undefined;
});

describe("purgeAgedBackups — rétention à 90 jours des exports manuels et téléversés", () => {
  it("supprime au-delà de 90 jours, conserve en deçà", async () => {
    await poser("manuel-2026-01-01.sql.gz.enc", 120);
    await poser("televerse-2026-02-01-copie.sql.enc", 95);
    await poser("manuel-2026-07-01.sql.gz.enc", 30);
    await poser("culturesa-2026-07-30.sql.gz.enc", 0);

    expect(await purgeAgedBackups(MAINTENANT)).toBe(2);
    expect(await restants()).toEqual([
      "culturesa-2026-07-30.sql.gz.enc",
      "manuel-2026-07-01.sql.gz.enc",
    ]);
  });

  it("ne touche JAMAIS aux exports automatiques, même très anciens", async () => {
    // Ceux-ci relèvent d'AUTO_RETAIN (rotation sur le nombre). Les purger aussi
    // par l'âge ferait disparaître la série entière si la tâche s'arrêtait un
    // trimestre — exactement quand on découvrirait en avoir besoin.
    await poser("culturesa-2025-01-01.sql.gz.enc", 500);
    await poser("culturesa-2025-02-01.sql.gz.enc", 480);

    expect(await purgeAgedBackups(MAINTENANT)).toBe(0);
    expect(await restants()).toHaveLength(2);
  });

  it("90 jours PILE est conservé, 1 ms de plus est purgé — le seuil est strict", async () => {
    // Une inégalité large ferait disparaître le fichier un jour plus tôt que la
    // règle annoncée à l'écran. L'écart est mince, mais c'est celui entre ce que
    // le produit dit et ce qu'il fait.
    //
    // L'instant de référence est calculé À PARTIR de la date réellement stockée,
    // et non de celle demandée : `utimes` arrondit selon le système de fichiers,
    // et un fichier d'un cheveu plus jeune que 90 jours ne franchit jamais la
    // borne. Une première version de ce test passait indifféremment avec `>` et
    // avec `>=` — elle décrivait un seuil sans jamais l'atteindre.
    await poser("manuel-limite.sql.gz.enc", 90);
    // Un export récent DÈS LE DÉPART : sans lui, le garde-fou sauverait le fichier
    // quelle que soit l'inégalité, et le test passerait pour la mauvaise raison.
    await poser("culturesa-recent.sql.gz.enc", 0);
    const mtime = (await fs.stat(path.join(dir, "manuel-limite.sql.gz.enc"))).mtime.getTime();

    expect(await purgeAgedBackups(mtime + AGE_RETAIN_MS)).toBe(0);
    expect(await restants()).toContain("manuel-limite.sql.gz.enc");

    expect(await purgeAgedBackups(mtime + AGE_RETAIN_MS + 1)).toBe(1);
    expect(await restants()).toEqual(["culturesa-recent.sql.gz.enc"]);
  });

  it("GARDE-FOU : ne vide jamais le dossier, même si tout est périmé", async () => {
    // Cas de la sauvegarde automatique en panne depuis des mois : le seul dump
    // restant est un export manuel ancien. Le purger laisserait l'installation
    // sans aucune copie — au moment précis où l'on en a le plus besoin.
    await poser("manuel-2025-01-01.sql.gz.enc", 400);
    await poser("manuel-2025-06-01.sql.gz.enc", 300);
    await poser("televerse-2025-03-01-x.sql.enc", 350);

    expect(await purgeAgedBackups(MAINTENANT)).toBe(2);
    // Le PLUS RÉCENT des périmés survit, pas le premier venu.
    expect(await restants()).toEqual(["manuel-2025-06-01.sql.gz.enc"]);
  });

  it("le garde-fou ne s'applique pas si un export automatique subsiste", async () => {
    // Une copie récente existe : plus rien ne justifie de garder les périmés.
    await poser("manuel-2025-01-01.sql.gz.enc", 400);
    await poser("culturesa-2026-07-30.sql.gz.enc", 0);

    expect(await purgeAgedBackups(MAINTENANT)).toBe(1);
    expect(await restants()).toEqual(["culturesa-2026-07-30.sql.gz.enc"]);
  });

  it("dossier vide : ne lève pas", async () => {
    expect(await purgeAgedBackups(MAINTENANT)).toBe(0);
  });
});
