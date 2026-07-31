import { NextResponse } from "next/server";
import type { Role } from "@/generated/prisma/client";
import { AUDIT, recordAudit } from "@/server/audit";
import { messageClient } from "@/server/errors";
import { getSession } from "@/server/guards";
import { saveUploadedBackup } from "@/server/services/backup";

/** Taille maximale d'un dump téléversé (largement au-dessus des dumps de l'app). */
const MAX_BYTES = 200 * 1024 * 1024;

/**
 * Téléversement d'un dump (.sql / .sql.gz) dans le dossier de sauvegardes
 * (administrateurs uniquement). Le fichier est ensuite restaurable depuis le panel.
 */
export async function POST(req: Request) {
  const session = await getSession();
  const role = (session?.user as { role?: Role } | undefined)?.role;
  if (role !== "administrateur") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "Fichier manquant." }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: "Fichier vide ou trop volumineux (max 200 Mo)." },
      { status: 400 },
    );
  }

  try {
    const data = Buffer.from(await file.arrayBuffer());
    const name = await saveUploadedBackup(file.name, data);
    await recordAudit(AUDIT.BACKUP_UPLOADED, {
      target: name,
      details: { origine: file.name, octets: file.size },
    });
    return NextResponse.json({ ok: true, name });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: await messageClient(e, "Échec du téléversement.", "backup:upload") },
      { status: 400 },
    );
  }
}
