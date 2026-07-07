import { NextResponse } from "next/server";
import type { Role } from "@/generated/prisma/client";
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
    return NextResponse.json({ ok: true, name });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Échec du téléversement." },
      { status: 400 },
    );
  }
}
