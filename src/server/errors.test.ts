import { beforeEach, describe, expect, it, vi } from "vitest";
import { messageClient, UserFacingError } from "./errors";

beforeEach(() => {
  // `clearAllMocks` est indispensable : sans lui l'espion conserve les appels des
  // tests précédents, et l'assertion « rien n'a été journalisé » échoue à cause de
  // ce qu'un autre test a fait — un échec qui accuse le mauvais coupable.
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("messageClient — le tri se fait sur l'INTENTION (constat D7)", () => {
  it("laisse passer un message écrit pour être lu", () => {
    const e = new UserFacingError("Extension attendue : .sql, .sql.gz ou .sql.gz.enc");
    expect(messageClient(e, "Échec.", "test")).toBe(
      "Extension attendue : .sql, .sql.gz ou .sql.gz.enc",
    );
  });

  it("laisse passer une sous-classe", () => {
    // BackupCryptoError en est une : « mauvaise clé » et « fichier altéré »
    // appellent des gestes opposés, les taire rendrait la restauration
    // indiagnosticable.
    class Fille extends UserFacingError {}
    expect(messageClient(new Fille("Clé de chiffrement incorrecte."), "Échec.", "t")).toBe(
      "Clé de chiffrement incorrecte.",
    );
  });

  it("REMPLACE la sortie brute d'un outil externe", () => {
    // Le cœur du constat : `run()` rejette avec le stderr de pg_dump/psql —
    // versions, chemins absolus, noms de rôles, détails de schéma.
    const brut = new Error(
      'pg_dump: error: connection to server at "db" (172.18.0.2), port 5432 failed: ' +
        'FATAL: role "culturesa_app" does not exist\npg_dump (PostgreSQL) 17.2',
    );
    const msg = messageClient(brut, "Échec de l'export.", "backup:create");
    expect(msg).not.toContain("pg_dump");
    expect(msg).not.toContain("172.18.0.2");
    expect(msg).not.toContain("culturesa_app");
    expect(msg).toMatch(/^Échec de l'export\. \(référence [0-9A-F]{6}\)$/);
  });

  it("journalise l'erreur COMPLÈTE sous la même référence", () => {
    // Sans cela on aurait remplacé une fuite par un mur : l'administrateur voit
    // une référence, l'exploitant retrouve la trace exacte.
    const brut = new Error("détail technique");
    const msg = messageClient(brut, "Échec.", "backup:restore");
    const ref = msg.match(/référence ([0-9A-F]{6})/)?.[1];
    expect(ref).toBeTruthy();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`réf. ${ref}`), brut);
  });

  it("le contexte figure dans la ligne de journal", () => {
    // Une pile d'exception sans origine oblige à deviner d'où elle vient.
    messageClient(new Error("x"), "Échec.", "cron:backup");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("[cron:backup]"),
      expect.anything(),
    );
  });

  it("ne journalise RIEN pour une erreur destinée à l'usager", () => {
    // Ce n'est pas une anomalie : un nom de fichier refusé est un fonctionnement
    // normal. Le journaliser en erreur remplirait les journaux de bruit — et des
    // erreurs qui apparaissent quand tout va bien cessent d'être lues.
    messageClient(new UserFacingError("Nom de fichier invalide."), "Échec.", "t");
    expect(console.error).not.toHaveBeenCalled();
  });

  it("gère ce qui n'est pas une Error", () => {
    expect(messageClient("une chaîne jetée", "Échec.", "t")).toMatch(/^Échec\. \(référence/);
    expect(messageClient(undefined, "Échec.", "t")).toMatch(/^Échec\. \(référence/);
  });

  it("deux appels produisent des références distinctes", () => {
    // Une référence réutilisée désignerait plusieurs incidents à la fois.
    const r = (m: string) => m.match(/référence ([0-9A-F]{6})/)?.[1];
    expect(r(messageClient(new Error("a"), "É.", "t"))).not.toBe(
      r(messageClient(new Error("b"), "É.", "t")),
    );
  });
});
