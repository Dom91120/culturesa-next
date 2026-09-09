import { notFound } from "next/navigation";
import { UsersGlyph } from "@/app/(admin)/users/account-ui";
import { InfoGlyph } from "@/components/ui-glyphs";
import { formatTel } from "@/lib/format";
import { prisma } from "@/server/db";
import { type Inscrit, listInscrits } from "@/server/services/editions";
import { AnonymisesToggle } from "../anonymises-toggle";
import { dash, EditionHeader, EditionSummary, type SummaryPill, Who } from "../edition-header";
import { resolveEditionExercice } from "../range";
import { SortTh } from "../sort-th";

export const metadata = { title: "CultuRésa — Inscrits" };

// Édition « Liste des inscrits » : les usagers distincts ayant réservé sur l'exercice
// sélectionné — identité, structure, niveau et contact. Volontairement SANS plage
// hebdo/mensuelle ni ruptures (un inscrit se compte par exercice, pas par semaine).
// Refonte Dom 2026-09-09 : barre commune, résumé en pastilles, tableau clair, avatars.
export default async function EditionsInscritsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ exercice?: string; anonymises?: string; tri?: string; dir?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const [service, exo] = await Promise.all([
    prisma.service.findUnique({ where: { id }, select: { label: true } }),
    resolveEditionExercice(id, sp.exercice),
  ]);
  if (!service) notFound();
  const { exercices, selected } = exo;

  // Comptes anonymisés (RGPD) exclus par défaut ; pastille « Comptes anonymisés » → anonymises=1.
  const withAnonymized = sp.anonymises === "1";
  const inscrits = await listInscrits(id, selected?.periodIds, withAnonymized);

  // Tri par clic sur les en-têtes : `tri` (colonne) + `dir` (asc par défaut), portés
  // par l'URL — conservés par la navigation d'exercice (ExerciceNav garde les autres
  // paramètres) et transmis au PDF (même vue imprimée). Défaut = identité.
  const SORT_KEYS = ["identite", "structure", "niveau", "email", "inscription"] as const;
  type SortKey = (typeof SORT_KEYS)[number];
  const tri: SortKey = (SORT_KEYS as readonly string[]).includes(sp.tri ?? "")
    ? (sp.tri as SortKey)
    : "identite";
  const dir = sp.dir === "desc" ? "desc" : "asc";
  // Valeur triée = la valeur AFFICHÉE (structure avec repli demandeur, date en
  // YYYY-MM-DD) ; départage identité pour un ordre stable.
  const valOf = (u: Inscrit): string =>
    tri === "identite"
      ? `${u.nom} ${u.prenom}`
      : tri === "structure"
        ? u.structure || u.demandeur
        : tri === "inscription"
          ? u.inscritYmd
          : u[tri];
  inscrits.sort(
    (a, b) =>
      (valOf(a).localeCompare(valOf(b), "fr", { sensitivity: "base" }) ||
        a.nom.localeCompare(b.nom) ||
        a.prenom.localeCompare(b.prenom)) * (dir === "desc" ? -1 : 1),
  );

  // Lien d'un en-tête : re-clic sur la colonne active → inversion du sens.
  const sortHref = (k: SortKey) => {
    const p = new URLSearchParams();
    if (selected) p.set("exercice", String(selected.id));
    if (withAnonymized) p.set("anonymises", "1");
    p.set("tri", k);
    if (k === tri && dir === "asc") p.set("dir", "desc");
    return `?${p.toString()}`;
  };
  const SORT_LABEL: Record<SortKey, string> = {
    identite: "identité",
    structure: "structure",
    niveau: "niveau",
    email: "contact",
    inscription: "date d'inscription",
  };

  const viewParams = `${selected ? `&exercice=${selected.id}` : ""}${
    withAnonymized ? "&anonymises=1" : ""
  }`;
  const pdfHref = `/services/${id}/editions/pdf?kind=inscrits${viewParams}&tri=${tri}${
    dir === "desc" ? "&dir=desc" : ""
  }`;
  const csvHref = `/services/${id}/editions/export?kind=inscrits${viewParams}`;

  // Résumé : effectif, structures distinctes, signalements (sans niveau, sans téléphone).
  const structures = new Set(inscrits.map((u) => u.structure || u.demandeur).filter(Boolean)).size;
  const sansNiveau = inscrits.filter((u) => !u.niveau).length;
  const sansTel = inscrits.filter((u) => !u.tel).length;
  const pills: SummaryPill[] = [
    { text: `${inscrits.length} inscrit${inscrits.length > 1 ? "s" : ""}`, tone: "ok" },
  ];
  if (structures > 0) pills.push({ text: `${structures} structure${structures > 1 ? "s" : ""}` });
  if (sansNiveau > 0) pills.push({ text: `${sansNiveau} sans niveau`, tone: "warn" });
  if (sansTel > 0) pills.push({ text: `${sansTel} sans téléphone`, tone: "warn" });

  return (
    <div className="panel ed-screen">
      <EditionHeader
        serviceId={id}
        serviceLabel={service.label}
        title="Liste des inscrits"
        icon={<UsersGlyph size={16} />}
        tone="ok"
        exercices={exercices}
        selectedId={selected?.id ?? null}
        right={<AnonymisesToggle />}
        csvHref={csvHref}
        pdfHref={pdfHref}
      />

      {inscrits.length === 0 ? (
        <p className="ed-empty">Aucun inscrit sur cet exercice.</p>
      ) : (
        <>
          <EditionSummary
            pills={pills}
            right={`trié par ${SORT_LABEL[tri]}, ${dir === "asc" ? "A → Z" : "Z → A"}`}
          />
          <div className="ed-table-wrap">
            <table className="ed-table" style={{ tableLayout: "fixed", minWidth: 760 }}>
              <thead>
                <tr>
                  <SortTh
                    href={sortHref("identite")}
                    active={tri === "identite"}
                    dir={dir}
                    width="26%"
                  >
                    Identité
                  </SortTh>
                  <SortTh
                    href={sortHref("structure")}
                    active={tri === "structure"}
                    dir={dir}
                    width="24%"
                  >
                    Structure
                  </SortTh>
                  <SortTh href={sortHref("niveau")} active={tri === "niveau"} dir={dir} width={90}>
                    Niveau
                  </SortTh>
                  <SortTh href={sortHref("email")} active={tri === "email"} dir={dir}>
                    Contact
                  </SortTh>
                  <SortTh
                    href={sortHref("inscription")}
                    active={tri === "inscription"}
                    dir={dir}
                    width={100}
                    align="right"
                  >
                    Inscrit le
                  </SortTh>
                </tr>
              </thead>
              <tbody>
                {inscrits.map((u, i) => {
                  const anonymized = !u.nom && !u.prenom && !u.email;
                  return (
                    <tr key={`${u.email}-${i}`}>
                      <td>
                        <Who
                          nom={u.nom}
                          prenom={u.prenom}
                          email={u.email}
                          anonymized={anonymized}
                        />
                      </td>
                      <td className="ed-nowrap">
                        {u.structure ? (
                          <>
                            {u.structure}
                            {u.demandeur && u.demandeur !== u.structure && (
                              <span className="ed-sub">{u.demandeur}</span>
                            )}
                          </>
                        ) : (
                          u.demandeur || dash
                        )}
                      </td>
                      <td>
                        {u.niveau ? <span className="ms-pill is-info">{u.niveau}</span> : dash}
                      </td>
                      <td className="ed-nowrap">
                        {u.email || dash}
                        {u.tel ? (
                          <span className="ed-sub ed-mono">{formatTel(u.tel)}</span>
                        ) : (
                          !anonymized && <span className="ed-sub is-warn">sans téléphone</span>
                        )}
                      </td>
                      <td className="ed-nowrap ed-mu" style={{ textAlign: "right" }}>
                        {u.inscritLe}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="rg-foot">
        <InfoGlyph size={13} />
        <span style={{ flex: 1, lineHeight: 1.45 }}>
          Un inscrit se compte une fois par exercice, quel que soit le nombre de réservations.
          Cliquez un en-tête pour trier, une seconde fois pour inverser ; le PDF reprend le tri et
          le filtre affichés.
        </span>
      </div>
    </div>
  );
}
