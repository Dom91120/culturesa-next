import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { AUDIT, recordAudit } from "@/server/audit";
import { reponseApi, requireRoleApi } from "@/server/guards-api";
import { backupPath, listBackups } from "@/server/services/backup";

/**
 * Téléchargement d'un dump du dossier de sauvegardes (administrateurs uniquement).
 * Le nom doit exister dans la liste (pas d'accès arbitraire au système de fichiers).
 */
export async function GET(req: Request) {
  return reponseApi(async () => {
    // Garde commune des routes API : rôle ET second facteur (A6), refus en JSON
    // 401/403 — le contrôle manuel du rôle ne réclamait pas le second facteur.
    await requireRoleApi("administrateur", "/api/backups/download");

    const name = new URL(req.url).searchParams.get("file") ?? "";
    const known = (await listBackups()).some((f) => f.name === name);
    if (!known) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    // Sortie de donnees nominatives hors du serveur : trace systematique.
    await recordAudit(AUDIT.BACKUP_DOWNLOADED, { target: name });

    // Le dump est servi TEL QU'IL EST STOCKÉ, donc chiffré (constat D1) : le déchiffrer
    // ici replacerait des données nominatives de mineurs en clair sur le poste de
    // l'administrateur, c'est-à-dire exactement ce que le chiffrement au repos évite.
    // Pour relire un fichier hors de l'application : scripts/decrypt-backup.mjs.
    //
    // Fichier STREAMÉ (audit 2026-09-17, P9) : un dump de plusieurs centaines de Mo n'est
    // plus chargé entièrement en mémoire avant l'envoi ; la taille vient de `stat`.
    const path = backupPath(name);
    const { size } = await stat(path);
    const body = Readable.toWeb(createReadStream(path)) as ReadableStream;
    return new NextResponse(body, {
      headers: {
        "Content-Type": name.endsWith(".enc")
          ? "application/octet-stream"
          : name.endsWith(".gz")
            ? "application/gzip"
            : "application/sql",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Content-Length": String(size),
      },
    });
  });
}
