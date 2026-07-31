import { beforeEach, describe, expect, it, vi } from "vitest";
import { messageClient, UserFacingError } from "./errors";

beforeEach(() => {
  // `clearAllMocks` est indispensable : sans lui l'espion conserve les appels des
  // tests précédents, et l'assertion « rien n'a été journalisé » échoue à cause de
  // ce qu'un autre test a fait — un échec qui accuse le mauvais coupable.
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/** Toutes les lignes journalisées du test courant, concaténées. */
const journalise = () =>
  (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls
    .flat()
    .map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
    .join(" ");

// Hors contexte de requête, `headers()` lève : `reference()` se replie sur un aléa
// local. C'est le chemin exercé ici — le cas « avec identifiant de requête » relève
// d'un test d'intégration, pas d'un test unitaire.
const REF = /\(référence [0-9A-Za-z]{6,12}\)$/;

describe("messageClient — le tri se fait sur l'INTENTION (constat D7)", () => {
  it("laisse passer un message écrit pour être lu", async () => {
    const e = new UserFacingError("Extension attendue : .sql, .sql.gz ou .sql.gz.enc");
    expect(await messageClient(e, "Échec.", "test")).toBe(
      "Extension attendue : .sql, .sql.gz ou .sql.gz.enc",
    );
  });

  it("laisse passer une sous-classe", async () => {
    // BackupCryptoError en est une : « mauvaise clé » et « fichier altéré »
    // appellent des gestes opposés ; les taire rendrait la restauration
    // indiagnosticable.
    class Fille extends UserFacingError {}
    expect(await messageClient(new Fille("Clé de chiffrement incorrecte."), "Échec.", "t")).toBe(
      "Clé de chiffrement incorrecte.",
    );
  });

  it("REMPLACE la sortie brute d'un outil externe", async () => {
    // Le cœur du constat : `run()` rejette avec le stderr de pg_dump/psql —
    // versions, chemins absolus, noms de rôles, détails de schéma.
    const brut = new Error(
      'pg_dump: error: connection to server at "db" (172.18.0.2), port 5432 failed: ' +
        'FATAL: role "culturesa_app" does not exist\npg_dump (PostgreSQL) 17.2',
    );
    const msg = await messageClient(brut, "Échec de l'export.", "backup:create");
    expect(msg).not.toContain("pg_dump");
    expect(msg).not.toContain("172.18.0.2");
    expect(msg).not.toContain("culturesa_app");
    expect(msg).toMatch(REF);
  });

  it("journalise l'erreur COMPLÈTE sous la même référence", async () => {
    // Sans cela on aurait remplacé une fuite par un mur : l'administrateur voit
    // une référence, l'exploitant retrouve la trace exacte.
    const msg = await messageClient(new Error("détail technique"), "Échec.", "backup:restore");
    const ref = msg.match(/référence ([0-9A-Za-z]+)\)/)?.[1];
    expect(ref).toBeTruthy();
    expect(journalise()).toContain(ref as string);
    expect(journalise()).toContain("détail technique");
  });

  it("le contexte figure dans la ligne de journal", async () => {
    // Une pile d'exception sans origine oblige à deviner d'où elle vient.
    await messageClient(new Error("x"), "Échec.", "cron:backup");
    expect(journalise()).toContain("cron:backup");
  });

  it("ne journalise RIEN pour une erreur destinée à l'usager", async () => {
    // Ce n'est pas une anomalie : un nom de fichier refusé est un fonctionnement
    // normal. Le journaliser en erreur remplirait les journaux de bruit — et des
    // erreurs qui apparaissent quand tout va bien cessent d'être lues.
    await messageClient(new UserFacingError("Nom de fichier invalide."), "Échec.", "t");
    expect(console.error).not.toHaveBeenCalled();
  });

  it("gère ce qui n'est pas une Error", async () => {
    expect(await messageClient("une chaîne jetée", "Échec.", "t")).toMatch(REF);
    expect(await messageClient(undefined, "Échec.", "t")).toMatch(REF);
  });

  it("deux appels hors requête produisent des références distinctes", async () => {
    // Une référence réutilisée désignerait plusieurs incidents à la fois. En
    // contexte de requête, l'identifiant est au contraire PARTAGÉ : il désigne la
    // requête entière, ce qui est précisément le but du constat D8.
    const r = async (e: Error) =>
      (await messageClient(e, "É.", "t")).match(/référence (\w+)\)/)?.[1];
    expect(await r(new Error("a"))).not.toBe(await r(new Error("b")));
  });
});
