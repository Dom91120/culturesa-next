import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou STATIQUE (audit 2026-10-18) : le garde du layout services/[id] ne protège
 * pas les pages — layout et page sont rendus en parallèle, et une navigation RSC qui
 * déclare le layout déjà monté ne le rend pas. Les éditions et statistiques affichent
 * des données nominatives de mineurs : chaque page.tsx doit porter son propre garde,
 * chaque route.ts le sien. Seules les pages de pure redirection en sont dispensées.
 */

const ROOT = fileURLToPath(new URL(".", import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

const files = walk(ROOT);
const pages = files.filter((f) => f.endsWith("page.tsx"));
const routes = files.filter((f) => f.endsWith("route.ts"));

/** Page qui ne fait que rediriger : aucune lecture de données, aucun rendu. */
const isRedirectOnly = (src: string) =>
  !src.includes("@/server/") && /\bredirect\(/.test(src) && !/return\s*\(/.test(src);

describe("pages et routes de services/[id] : garde propre", () => {
  it("trouve bien les éditions et les statistiques", () => {
    const names = pages.map((f) => relative(ROOT, f).replaceAll("\\", "/"));
    expect(names).toContain("stats/page.tsx");
    expect(names).toContain("editions/page.tsx");
    expect(names).toContain("editions/inscrits/page.tsx");
  });

  it.each(pages.map((f) => [relative(ROOT, f).replaceAll("\\", "/"), f]))(
    "%s appelle requireServiceAccess, requireServiceView ou requireServiceManager",
    (_name, file) => {
      const src = readFileSync(file, "utf8");
      if (isRedirectOnly(src)) return;
      expect(src).toMatch(/await require(ServiceAccess|ServiceView|ServiceManager)\(id\)/);
    },
  );

  it.each(routes.map((f) => [relative(ROOT, f).replaceAll("\\", "/"), f]))(
    "%s appelle requireServiceAccessApi ou requireServiceViewApi",
    (_name, file) => {
      expect(readFileSync(file, "utf8")).toMatch(/await requireService(Access|View)Api\(id,/);
    },
  );

  // `requireServiceView` admet la Direction des accueils de loisirs : il n'a sa place
  // que là où son périmètre est appliqué aux données. Liste FERMÉE — l'ajouter à une
  // autre page lui ouvrirait des données hors accueils de loisirs.
  it("requireServiceView n'est appelé que par les pages au périmètre filtré", () => {
    const withView = [...pages, ...files.filter((f) => f.endsWith("layout.tsx"))]
      .filter((f) => /requireServiceView\(/.test(readFileSync(f, "utf8")))
      .map((f) => relative(ROOT, f).replaceAll("\\", "/"))
      .sort();
    expect(withView).toEqual([
      "agenda/page.tsx",
      "editions/loisirs/page.tsx",
      "editions/page.tsx",
      "layout.tsx",
      "page.tsx",
    ]);
  });

  it("requireServiceViewApi n'est appelé que par les exports des éditions", () => {
    const withView = routes
      .filter((f) => /requireServiceViewApi\(/.test(readFileSync(f, "utf8")))
      .map((f) => relative(ROOT, f).replaceAll("\\", "/"))
      .sort();
    expect(withView).toEqual(["editions/export/route.ts", "editions/pdf/route.ts"]);
  });
});
