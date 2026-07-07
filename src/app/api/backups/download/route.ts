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
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": name.endsWith(".gz") ? "application/gzip" : "application/sql",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Content-Length": String(data.byteLength),
    },
  });
}
