"use client";

import { formatTel } from "@/lib/format";
import type { Role } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { anonymizeUserAction, resendVerificationAction } from "./actions";
import { UserModal } from "./user-modal";

export type UserRow = {
  id: string;
  nom: string;
  prenom: string;
  email: string;
  tel: string;
  role: Role;
  rgpdOk: boolean;
  emailVerified: boolean;
  niveau: string;
  enfants: number;
  accompagnants: number;
  demandeurId: number | null;
  structureId: number | null;
  demandeurLabel: string | null;
  structureLabel: string | null;
  anonymized: boolean;
  serviceIds: string[];
  serviceLabels: string[];
};

export type Demandeur = { id: number; label: string };
export type StructureRef = { id: number; label: string; demandeurId: number };
export type NiveauRef = { id: number; label: string; demandeurId: number | null };
export type ServiceRef = { id: string; label: string };

type SortKey = "default" | "nom" | "prenom" | "email" | "role";

const ROLE_META: Record<Role, { cls: string; label: string }> = {
  administrateur: { cls: "role-admin", label: "Admin" },
  gestionnaire: { cls: "role-gestionnaire", label: "Gestionnaire" },
  utilisateur: { cls: "role-utilisateur", label: "Utilisateur" },
};

const PAGE_SIZE = 20;

// Recherche accent-insensible (réimplémente _normSearch du legacy).
function normSearch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function affiliation(u: UserRow): string {
  if (u.serviceLabels.length) return u.serviceLabels.join(", ");
  if (u.structureLabel) return u.structureLabel;
  if (u.demandeurLabel) return u.demandeurLabel;
  return "—";
}

export function UsersTable({
  users,
  demandeurs,
  structures,
  niveaux,
  services,
}: {
  users: UserRow[];
  demandeurs: Demandeur[];
  structures: StructureRef[];
  niveaux: NiveauRef[];
  services: ServiceRef[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("default");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const [modal, setModal] = useState<{ mode: "create" | "edit"; user: UserRow | null } | null>(
    null,
  );

  const filtered = useMemo(() => {
    const q = normSearch(query.trim());
    const list = q
      ? users.filter((u) => normSearch(`${u.nom}${u.prenom}${u.email}`).includes(q))
      : users.slice();
    list.sort((a, b) => {
      if (sortKey === "default") {
        return (
          a.role.localeCompare(b.role) ||
          a.nom.localeCompare(b.nom) ||
          a.prenom.localeCompare(b.prenom)
        );
      }
      return (a[sortKey] || "").localeCompare(b[sortKey] || "");
    });
    return list;
  }, [users, query, sortKey]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, totalPages - 1);
  const from = current * PAGE_SIZE;
  const pageRows = filtered.slice(from, from + PAGE_SIZE);

  const selected = selectedId ? (users.find((u) => u.id === selectedId) ?? null) : null;

  function sortBy(key: SortKey) {
    setSortKey(key);
  }

  function toggleRow(id: string) {
    setSelectedId((cur) => (cur === id ? null : id));
  }

  function clearSelection() {
    setSelectedId(null);
  }

  function editSelected() {
    if (!selected) return;
    setModal({ mode: "edit", user: selected });
  }

  function anonymizeSelected() {
    if (!selected) return;
    if (
      !confirm(
        "Anonymiser ce compte ? Les données personnelles seront anonymisées de façon irréversible (RGPD). Les réservations sont conservées.",
      )
    )
      return;
    const id = selected.id;
    startTransition(async () => {
      await anonymizeUserAction(id);
      setSelectedId(null);
      router.refresh();
    });
  }

  function anonymizeRow(id: string) {
    if (
      !confirm(
        "Anonymiser ce compte ? Les données personnelles seront anonymisées de façon irréversible (RGPD).",
      )
    )
      return;
    startTransition(async () => {
      await anonymizeUserAction(id);
      if (selectedId === id) setSelectedId(null);
      router.refresh();
    });
  }

  function resendConfirmation() {
    if (!selected) return;
    startTransition(async () => {
      await resendVerificationAction(selected.email);
    });
  }

  // En-tête de colonne triable. Un clic (ou Entrée/Espace) fixe la clé de tri.
  const SortTh = ({
    label,
    sk,
    minWidth,
  }: {
    label: string;
    sk: SortKey;
    minWidth?: number;
  }) => (
    <th
      className={sortKey === sk ? "sorted" : undefined}
      style={{ minWidth, textAlign: "center", cursor: "pointer" }}
      onClick={() => sortBy(sk)}
    >
      {label} <span className="sort-arrow">↕</span>
    </th>
  );

  return (
    <div>
      <div className="panel-title" style={{ justifyContent: "space-between", gap: ".75rem" }}>
        <span style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
          <span className="dot" style={{ background: "var(--warn)" }} />
          Comptes utilisateurs
        </span>
        <div className="search-wrap">
          {/* biome-ignore lint/a11y/noSvgWithoutTitle: icône décorative copiée du legacy */}
          <svg
            className="search-icon"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
            />
          </svg>
          <input
            type="text"
            placeholder="Nom, e-mail…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setModal({ mode: "create", user: null })}
          style={{ padding: ".25rem .65rem", fontSize: ".68rem" }}
        >
          ＋ Ajouter
        </button>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th className="col-check" />
              <SortTh label="Nom" sk="nom" minWidth={130} />
              <SortTh label="Prénom" sk="prenom" minWidth={130} />
              <SortTh label="E-mail" sk="email" />
              <th style={{ textAlign: "center" }}>Téléphone</th>
              <th style={{ textAlign: "center" }}>Structure / Service</th>
              <SortTh label="Rôle" sk="role" />
              <th style={{ textAlign: "center" }} title="Export RGPD">
                RGPD
              </th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((u, i) => {
              const prev = i > 0 ? pageRows[i - 1] : from > 0 ? filtered[from - 1] : null;
              const roleBreak =
                (sortKey === "default" || sortKey === "role") &&
                prev != null &&
                prev.role !== u.role;
              const checked = selectedId === u.id;
              const meta = ROLE_META[u.role];
              const rowClasses = [roleBreak ? "role-break" : "", checked ? "row-checked" : ""]
                .filter(Boolean)
                .join(" ");
              return (
                <tr key={u.id} className={rowClasses || undefined}>
                  <td className="col-check">
                    <input
                      type="checkbox"
                      className="admin-cb"
                      checked={checked}
                      onChange={() => toggleRow(u.id)}
                    />
                  </td>
                  <td>{u.nom || "—"}</td>
                  <td>{u.prenom || "—"}</td>
                  <td style={{ color: "var(--muted)" }}>{u.email}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{formatTel(u.tel)}</td>
                  <td>{affiliation(u)}</td>
                  <td>
                    <span className={`role-pill ${meta.cls}`}>{meta.label}</span>
                  </td>
                  <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                    <a
                      className="btn btn-ghost"
                      href={`/rgpd/export?userId=${u.id}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        padding: ".05rem .45rem",
                        fontSize: ".7rem",
                        textDecoration: "none",
                        marginRight: ".2rem",
                      }}
                      title="Exporter les données RGPD"
                    >
                      📥
                    </a>
                    {u.anonymized ? (
                      <span
                        style={{ fontSize: ".62rem", color: "var(--muted)", fontStyle: "italic" }}
                        title="Compte déjà anonymisé"
                      >
                        anonymisé
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          anonymizeRow(u.id);
                        }}
                        style={{
                          padding: ".05rem .45rem",
                          fontSize: ".7rem",
                          borderColor: "rgba(224,107,107,.4)",
                          color: "var(--danger)",
                        }}
                        title="Anonymiser ce compte (RGPD)"
                      >
                        🛡️
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {total === 0 && (
              <tr>
                <td
                  colSpan={8}
                  style={{ textAlign: "center", padding: "1.5rem", color: "var(--muted)" }}
                >
                  Aucun compte utilisateur.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td
                colSpan={8}
                style={{
                  border: "none",
                  padding: ".55rem .6rem 0",
                  fontSize: ".72rem",
                  color: "var(--muted)",
                }}
              >
                {total === 0
                  ? "0 compte"
                  : `${from + 1}–${from + pageRows.length} sur ${total} compte${total > 1 ? "s" : ""}`}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div style={{ marginTop: ".5rem", display: "flex", alignItems: "center", gap: ".75rem" }}>
        <div
          style={{
            visibility: selected ? "visible" : "hidden",
            display: "flex",
            alignItems: "center",
            gap: ".75rem",
            flex: 1,
          }}
        >
          <span style={{ fontSize: ".82rem", color: "var(--muted)" }}>1 sélectionné</span>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={editSelected}
            style={{
              borderColor: "color-mix(in srgb, var(--accent) 40%, transparent)",
              color: "var(--accent)",
              fontSize: ".68rem",
              padding: ".25rem .65rem",
            }}
          >
            ✏️ Modifier
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={anonymizeSelected}
            disabled={pending}
            style={{
              borderColor: "rgba(220,80,80,.4)",
              color: "#e05555",
              fontSize: ".68rem",
              padding: ".25rem .65rem",
            }}
          >
            🗑️ Supprimer
          </button>
          {selected && !selected.emailVerified && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={resendConfirmation}
              disabled={pending}
              style={{
                borderColor: "rgba(232,164,90,.4)",
                color: "var(--warn)",
                fontSize: ".68rem",
                padding: ".25rem .65rem",
              }}
            >
              🖅 Renvoyer le mail de confirmation
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={clearSelection}
            style={{ fontSize: ".68rem", padding: ".25rem .65rem" }}
            title="Désélectionner le compte"
          >
            Annuler
          </button>
        </div>
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
      </div>

      {modal && (
        <UserModal
          mode={modal.mode}
          user={modal.user}
          demandeurs={demandeurs}
          structures={structures}
          niveaux={niveaux}
          services={services}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            setSelectedId(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
