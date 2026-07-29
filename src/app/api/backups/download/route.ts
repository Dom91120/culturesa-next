import { promises as fs } from "node:fs";
import { NextResponse } from "next/server";
import type { Role } from "@/generated/prisma/client";
import { getSession } from "@/server/guards";
import { backupPath, listBackups } from "@/server/services/backup";

/**
 * Téléchargement d'un dump du dossier de sauvegardes (administrateurs uniquement).
 * Le nom doit exister dans la liste (pas d'accès arbitraire au système de fichiers).
 */
export async function GET(req: Request) {
  const session = await getSession();
  const role = (session?.user as { role?: Role } | undefined)?.role;
  if (role !== "administrateur") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const name = new URL(req.url).searchParams.get("file") ?? "";
  const known = (await listBackups()).some((f) => f.name === name);
  if (!known) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const data = await fs.readFile(backupPath(name));
  // Le dump est servi TEL QU'IL EST STOCKÉ, donc chiffré (constat D1) : le déchiffrer
  // ici replacerait des données nominatives de mineurs en clair sur le poste de
  // l'administrateur, c'est-à-dire exactement ce que le chiffrement au repos évite.
  // Pour relire un fichier hors de l'application : scripts/decrypt-backup.mjs.
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": name.endsWith(".enc")
        ? "application/octet-stream"
        : name.endsWith(".gz")
          ? "application/gzip"
          : "application/sql",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Content-Length": String(data.byteLength),
    },
  });
}
