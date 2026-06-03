"use server";

import type { ActionState } from "@/lib/action-state";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/guards";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const schema = z.object({
  prenom: z.string().trim().max(80),
  nom: z.string().trim().max(80),
  tel: z.string().trim().max(30),
});

export async function updateProfileAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = schema.safeParse({
    prenom: formData.get("prenom"),
    nom: formData.get("nom"),
    tel: formData.get("tel"),
  });
  if (!parsed.success) return { ok: false, error: "Données invalides." };

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      prenom: parsed.data.prenom,
      nom: parsed.data.nom,
      tel: parsed.data.tel,
      name: `${parsed.data.prenom} ${parsed.data.nom}`.trim(),
    },
  });
  revalidatePath("/mon-compte");
  return { ok: true };
}
