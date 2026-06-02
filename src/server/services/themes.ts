import { prisma } from "@/server/db";

export type ThemesMode = "libre" | "liste";

/**
 * Nettoie une liste de libellés de thèmes (utilisé client ET serveur,
 * en défense en profondeur) :
 *   - trim,
 *   - suppression des chaînes vides,
 *   - troncature à 255 caractères,
 *   - dédoublonnage insensible à la casse en conservant l'ordre.
 */
export function cleanThemeLabels(labels: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of labels) {
    let label = String(raw).trim();
    if (label === "") continue;
    if (label.length > 255) label = label.slice(0, 255);
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

/** Lit le mode de thèmes du service et la liste ordonnée de ses libellés. */
export async function getServiceThemes(
  serviceId: string,
): Promise<{ mode: ThemesMode; themes: string[] }> {
  const [svc, rows] = await Promise.all([
    prisma.service.findUnique({
      where: { id: serviceId },
      select: { themesMode: true },
    }),
    prisma.serviceTheme.findMany({
      where: { serviceId },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { label: true },
    }),
  ]);
  return {
    mode: svc?.themesMode === "liste" ? "liste" : "libre",
    themes: rows.map((r) => r.label),
  };
}

/**
 * Remplace le mode + la liste de thèmes d'un service. La liste est nettoyée
 * (cf. `cleanThemeLabels`) puis réécrite avec des positions incrémentales.
 */
export async function saveServiceThemes(
  serviceId: string,
  mode: ThemesMode,
  labels: string[],
): Promise<void> {
  const cleaned = cleanThemeLabels(labels);
  await prisma.$transaction(async (tx) => {
    await tx.service.update({ where: { id: serviceId }, data: { themesMode: mode } });
    await tx.serviceTheme.deleteMany({ where: { serviceId } });
    if (cleaned.length > 0) {
      await tx.serviceTheme.createMany({
        data: cleaned.map((label, position) => ({ serviceId, label, position })),
      });
    }
  });
}
