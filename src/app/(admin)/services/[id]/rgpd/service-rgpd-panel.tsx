"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { DATE_FMT_FR as dateFmt } from "@/lib/format";
import { anonymizeServiceUserAction } from "./actions";

const PAGE_SIZE = 10;

/** Ligne sérialisée reçue du serveur (date en ISO string ou null). */
export type ServiceRgpdRow = {
  id: string;
  nom: string;
  prenom: string;
  email: string;
  lastSeen: string | null;
};

// Recherche accent-insensible (calque _normSearch du legacy / users-table).
function normSearch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function countWord(n: number): string {
  return n > 1 ? "utilisateurs" : "utilisateur";
}

export function ServiceRgpdPanel({
  serviceId,
  users,
}: {
  serviceId: string;
  users: ServiceRgpdRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = normSearch(query.trim());
    if (!q) return users;
    return users.filter((u) => normSearch(`${u.nom}${u.prenom}${u.email}`).includes(q));
  }, [users, query]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, totalPages - 1);
  const from = current * PAGE_SIZE;
  const pageRows = filtered.slice(from, from + PAGE_SIZE);

  const cntLbl =
    query.trim() && total !== users.length
      ? `${total} / ${users.length} ${countWord(users.length)}`
      : `${users.length} ${countWord(users.length)}`;

  function anonymizeOne(id: string, label: string) {
    if (
      !confirm(
        `Effacer définitivement (anonymiser) les données personnelles de ${label} ? Les champs nom, prénom, e-mail et téléphone seront vidés et le compte verrouillé. Cette opération est irréversible. L'enregistrement (réservations passées) est conservé pour les statistiques.`,
      )
    )
      return;
    startTransition(async () => {
      await anonymizeServiceUserAction(serviceId, id);
      router.refresh();
    });
  }

  return (
    <div className="panel">
      <img
        src="/RGPD.png"
        alt="Logo RGPD"
        style={{ display: "block", height: 100, width: "auto", margin: ".5rem 0 1.5rem" }}
      />

      <p
        style={{
          fontSize: ".82rem",
          color: "var(--text)",
          marginBottom: "1.25rem",
          lineHeight: 1.5,
          textAlign: "justify",
        }}
      >
        Cet écran vous permet d&apos;exercer les droits RGPD des utilisateurs de ce service. Pour
        chaque personne, deux actions sont possibles :{" "}
        <strong style={{ marginRight: ".3em" }}>exporter</strong> ses données personnelles afin de
        les lui transmettre, par exemple lorsqu&apos;elle en fait la demande (droit d&apos;accès) ;
        ou <strong style={{ marginRight: ".3em" }}>effacer</strong> ses informations nominatives en
        anonymisant son compte, de façon irréversible (droit à l&apos;effacement).
        <br />
        <br />
        Utilisez la recherche pour retrouver un utilisateur, puis lancez l&apos;action
        correspondante depuis sa ligne dans le tableau ci-dessous.
      </p>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          flexWrap: "wrap",
          marginBottom: ".5rem",
        }}
      >
        <label
          htmlFor="rgpd-service-search"
          style={{
            fontSize: ".75rem",
            margin: 0,
            color: "var(--muted)",
            display: "flex",
            alignItems: "center",
            alignSelf: "stretch",
          }}
        >
          Liste des utilisateurs du service
        </label>
        <input
          id="rgpd-service-search"
          type="search"
          placeholder="🔍 Rechercher (nom, prénom, e-mail)…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
          style={{
            marginLeft: "auto",
            flex: 1,
            minWidth: 240,
            maxWidth: 330,
            fontSize: ".78rem",
            padding: ".35rem .6rem",
            borderRadius: "var(--rad-sm)",
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--text)",
          }}
        />
      </div>

      {users.length === 0 ? (
        <div
          style={{
            fontSize: ".78rem",
            color: "var(--muted)",
            marginTop: ".5rem",
            fontStyle: "italic",
          }}
        >
          Aucun utilisateur éligible pour ce service.
        </div>
      ) : (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>E-mail</th>
                  <th>Dernière activité</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((u) => {
                  const fullName = `${u.nom} ${u.prenom}`.trim() || u.email;
                  return (
                    <tr key={u.id}>
                      <td>{fullName}</td>
                      <td style={{ color: "var(--muted)" }}>{u.email}</td>
                      <td style={{ color: "var(--muted)" }}>
                        {u.lastSeen ? dateFmt.format(new Date(u.lastSeen)) : "—"}
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <a
                          className="btn btn-ghost"
                          href={`/rgpd/export?userId=${u.id}`}
                          target="_blank"
                          rel="noreferrer"
                          title="Exporter (RGPD art. 15)"
                          style={{
                            padding: ".05rem .5rem",
                            fontSize: ".72rem",
                            textDecoration: "none",
                            marginRight: ".3rem",
                          }}
                        >
                          📥
                        </a>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => anonymizeOne(u.id, fullName)}
                          disabled={pending}
                          title="Anonymiser ce compte (RGPD)"
                          style={{
                            padding: ".05rem .5rem",
                            fontSize: ".72rem",
                            borderColor: "rgba(224,107,107,.4)",
                            color: "var(--danger)",
                          }}
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {total === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      style={{
                        textAlign: "center",
                        padding: "1.5rem",
                        color: "var(--muted)",
                        fontStyle: "italic",
                      }}
                    >
                      Aucun utilisateur.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", alignItems: "center", marginTop: ".6rem" }}>
            <span style={{ flex: 1, fontSize: ".7rem", color: "var(--muted)" }}>{cntLbl}</span>
            <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: ".1rem .45rem", fontSize: ".72rem" }}
                disabled={current === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                ‹
              </button>
              <span style={{ fontSize: ".7rem", color: "var(--muted)" }}>
                {current + 1} / {totalPages}
              </span>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: ".1rem .45rem", fontSize: ".72rem" }}
                disabled={current >= totalPages - 1}
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              >
                ›
              </button>
            </div>
            <span style={{ flex: 1 }} />
          </div>
        </>
      )}

      <p
        style={{
          fontSize: ".78rem",
          color: "var(--muted)",
          marginTop: "1.25rem",
          lineHeight: 1.5,
        }}
      >
        <strong style={{ color: "var(--text)", marginRight: ".3em" }}>🗑️ Anonymiser</strong> vide les
        champs nom, prénom, e-mail et téléphone, et verrouille le compte. L&apos;enregistrement est
        conservé pour préserver les statistiques (réservations passées notamment).
        <br />
        <strong style={{ color: "var(--text)", marginRight: ".3em" }}>📥 Exporter</strong> ouvre une
        vue des données personnelles (profil + historique des réservations) — droit d&apos;accès
        RGPD (article 15). Téléchargement JSON.
      </p>
    </div>
  );
}
