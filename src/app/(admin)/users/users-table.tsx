"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { GHOST_DANGER_STYLE } from "@/components/ui-styles";
import type { Role } from "@/generated/prisma/client";
import { formatTel } from "@/lib/format";
import { anonymizeUserAction, deleteEmptyUserAction, resendVerificationAction } from "./actions";
import { AnonymizeUserModal } from "./anonymize-user-modal";
import { DeleteUserModal } from "./delete-user-modal";
import { UserModal } from "./user-modal";

export type UserRow = {
  id: string;
  nom: string;
  prenom: string;
  email: string;
  tel: string;
  role: Role;
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
  bookingCount: number;
};

export type Demandeur = { id: number; label: string };
export type StructureRef = { id: number; label: string; demandeurId: number };
export type NiveauRef = { id: number; label: string; demandeurId: number | null };
export type ServiceRef = { id: string; label: string };

type SortKey = "default" | "nom" | "email" | "role";

const ROLE_META: Record<Role, { cls: string; label: string }> = {
  administrateur: { cls: "role-admin", label: "Admin" },
  gestionnaire: { cls: "role-gestionnaire", label: "Gestionnaire" },
  utilisateur: { cls: "role-utilisateur", label: "Utilisateur" },
};

const PAGE_SIZE = 20;

// ── Largeurs de colonnes (cf. <colgroup> du tableau) ──
// Les colonnes d'appoint sont calées en pixels sur leurs contrôles, PADDING DE CELLULE
// COMPRIS (`.admin-table td` : 0.6rem de chaque côté, soit ~19 px) ; Identité, E-mail et
// Structure / Service se partagent à parts égales tout ce qui reste.
const COL_CHECK = 36; // case à cocher 15 px + son padding propre (.col-check)
const COL_TEL = 116; // « 06 12 34 56 78 » à 0.75rem
const COL_ROLE = 108; // pastille « GESTIONNAIRE » (0.5rem, majuscules espacées)
const COL_RGPD = 92; // boutons 📥 et 🗑️ côte à côte
const COL_TEXT = `calc((100% - ${COL_CHECK + COL_TEL + COL_ROLE + COL_RGPD}px) / 3)`;

// Barre d'actions sous le tableau : gabarit commun des 4 boutons (rembourrage
// horizontal resserré pour que le groupe reste compact face à la pagination).
// `nowrap` + `flexShrink: 0` : à l'étroit, le libellé ne se replie pas sur deux lignes
// (le bouton garderait sa largeur mais doublerait de hauteur) — le groupe déborde
// plutôt vers la pagination.
const ACTION_BTN_STYLE = {
  fontSize: ".68rem",
  padding: ".2rem .45rem",
  whiteSpace: "nowrap",
  flexShrink: 0,
} as const;

// Colonnes d'appoint : la troncature ne les concerne pas — sans ça, elles héritent de
// l'ellipse de `.admin-table td` et affichent « … » dès qu'un contrôle frôle le bord.
const NO_ELLIPSIS = { overflow: "visible", textOverflow: "clip" } as const;

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

// En-tête de colonne triable. Défini HORS du composant : sinon recréé à chaque rendu
// (nouveau type de composant) → les <th> sont démontés/remontés à chaque rendu.
function SortTh({
  label,
  sk,
  sortKey,
  onSort,
  minWidth,
}: {
  label: string;
  sk: SortKey;
  sortKey: SortKey;
  onSort: (k: SortKey) => void;
  minWidth?: number;
}) {
  return (
    <th
      className={sortKey === sk ? "sorted" : undefined}
      style={{ minWidth, textAlign: "center", cursor: "pointer" }}
      onClick={() => onSort(sk)}
    >
      {label} <span className="sort-arrow">↕</span>
    </th>
  );
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
  // Compte visé par la modale de suppression physique (comptes vides uniquement).
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  // Compte visé par la modale d'anonymisation RGPD (barre d'actions ou bouton de ligne).
  const [anonymizeTarget, setAnonymizeTarget] = useState<UserRow | null>(null);

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
      // Colonne « Identité » (tri par nom) : départage par prénom.
      return (
        (a[sortKey] || "").localeCompare(b[sortKey] || "") ||
        (sortKey === "nom" ? a.prenom.localeCompare(b.prenom) : 0)
      );
    });
    return list;
  }, [users, query, sortKey]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, totalPages - 1);
  const from = current * PAGE_SIZE;
  const pageRows = filtered.slice(from, from + PAGE_SIZE);

  // Résolu dans `filtered` (pas `users`) : si la recherche exclut la ligne sélectionnée,
  // la barre d'actions disparaît au lieu d'agir sur une ligne devenue invisible.
  const selected = selectedId ? (filtered.find((u) => u.id === selectedId) ?? null) : null;

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

  function confirmAnonymize(password: string) {
    if (!anonymizeTarget) return;
    const id = anonymizeTarget.id;
    startTransition(async () => {
      const res = await anonymizeUserAction(id, password);
      if (!res?.ok) alert(res?.error ?? "Échec de l'anonymisation.");
      setAnonymizeTarget(null);
      if (selectedId === id) setSelectedId(null);
      router.refresh();
    });
  }

  // Suppression physique — réservée aux comptes sans réservation (test, spam) ;
  // le serveur re-vérifie (hardDeleteEmptyUser). La voie RGPD normale reste l'anonymisation.
  function confirmDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    startTransition(async () => {
      const res = await deleteEmptyUserAction(id);
      if (!res?.ok) alert(res?.error ?? "Échec de la suppression.");
      setDeleteTarget(null);
      setSelectedId(null);
      router.refresh();
    });
  }

  function resendConfirmation() {
    if (!selected) return;
    startTransition(async () => {
      await resendVerificationAction(selected.email);
    });
  }

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
        {/* `table-layout: fixed` : sans lui les largeurs du <colgroup> ne sont que des
            indications, la répartition suivant le contenu. */}
        <table className="admin-table zebra" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: COL_CHECK }} />
            <col style={{ width: COL_TEXT }} />
            <col style={{ width: COL_TEXT }} />
            <col style={{ width: COL_TEL }} />
            <col style={{ width: COL_TEXT }} />
            <col style={{ width: COL_ROLE }} />
            <col style={{ width: COL_RGPD }} />
          </colgroup>
          <thead>
            <tr>
              <th className="col-check" />
              {/* (Plus de minWidth : les largeurs viennent du <colgroup>.) */}
              <SortTh label="Identité" sk="nom" sortKey={sortKey} onSort={sortBy} />
              <SortTh label="E-mail" sk="email" sortKey={sortKey} onSort={sortBy} />
              <th style={{ textAlign: "center" }}>Téléphone</th>
              <th style={{ textAlign: "center" }}>Structure / Service</th>
              <SortTh label="Rôle" sk="role" sortKey={sortKey} onSort={sortBy} />
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
              // Compte anonymisé : contenus estompés. Restent pleinement actives la case
              // à cocher (barre d'actions : modification, suppression d'un compte vide)
              // et l'exportation RGPD ; la corbeille, elle, est désactivée d'elle-même.
              const dim: React.CSSProperties | undefined = u.anonymized
                ? { opacity: 0.45 }
                : undefined;
              return (
                <tr key={u.id} className={rowClasses || undefined}>
                  <td className="col-check" style={NO_ELLIPSIS}>
                    <input
                      type="checkbox"
                      className="admin-cb"
                      checked={checked}
                      onChange={() => toggleRow(u.id)}
                    />
                  </td>
                  {/* nowrap : ellipse au lieu de replier sur 2 lignes (hauteur de ligne
                      constante) ; valeur complète en infobulle. La troncature elle-même
                      vient de `.admin-table td` (overflow + text-overflow). */}
                  <td
                    style={{ whiteSpace: "nowrap", ...dim }}
                    title={`${u.nom} ${u.prenom}`.trim()}
                  >
                    {`${u.nom} ${u.prenom}`.trim() || "—"}
                  </td>
                  <td
                    style={{ color: "var(--muted)", whiteSpace: "nowrap", ...dim }}
                    title={u.email}
                  >
                    {u.email}
                  </td>
                  <td style={{ whiteSpace: "nowrap", ...NO_ELLIPSIS, ...dim }}>
                    {formatTel(u.tel)}
                  </td>
                  <td style={{ whiteSpace: "nowrap", ...dim }} title={affiliation(u)}>
                    {affiliation(u)}
                  </td>
                  <td style={{ ...NO_ELLIPSIS, ...dim }}>
                    <span className={`role-pill ${meta.cls}`}>{meta.label}</span>
                  </td>
                  <td style={{ textAlign: "center", whiteSpace: "nowrap", ...NO_ELLIPSIS }}>
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
                      title="Exporter (RGPD art. 15)"
                    >
                      📥
                    </a>
                    {/* Compte déjà anonymisé : même bouton, désactivé (l'info-bulle est
                        portée par le <span>, un bouton désactivé ne reçoit pas le survol). */}
                    <span
                      style={{ display: "inline-block" }}
                      title={u.anonymized ? "Anonymisé" : "Anonymiser ce compte (RGPD)"}
                    >
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={u.anonymized}
                        onClick={(e) => {
                          e.stopPropagation();
                          setAnonymizeTarget(u);
                        }}
                        style={{
                          padding: ".05rem .45rem",
                          fontSize: ".7rem",
                          borderColor: "rgba(224,107,107,.4)",
                          color: "var(--danger)",
                        }}
                      >
                        🗑️
                      </button>
                    </span>
                  </td>
                </tr>
              );
            })}
            {/* Lignes vides de complément : hauteur de page constante (20 lignes) */}
            {total > 0 &&
              pageRows.length < PAGE_SIZE &&
              Array.from({ length: PAGE_SIZE - pageRows.length }, (_, i) => (
                // biome-ignore lint/a11y/noAriaHiddenOnFocusable: ligne purement décorative (aucun contenu focusable) — le masquage aux lecteurs d'écran est voulu
                <tr key={`filler-${i}`} aria-hidden="true">
                  <td colSpan={7}>&nbsp;</td>
                </tr>
              ))}
            {total === 0 && (
              <tr>
                <td
                  colSpan={7}
                  style={{ textAlign: "center", padding: "1.5rem", color: "var(--muted)" }}
                >
                  Aucun compte utilisateur.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: ".5rem", display: "flex", alignItems: "center", gap: ".75rem" }}>
        {/* Bloc de gauche : compteur de lignes, ou « 1 sélectionné » à sa place. De même
            poids que la barre d'actions à droite, il centre la pagination sur la largeur. */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: ".75rem",
          }}
        >
          {selected ? (
            <span style={{ fontSize: ".82rem", color: "var(--muted)", whiteSpace: "nowrap" }}>
              1 sélectionné
            </span>
          ) : (
            <span style={{ fontSize: ".72rem", color: "var(--muted)", whiteSpace: "nowrap" }}>
              {total === 0
                ? "0 compte"
                : `${from + 1}–${from + pageRows.length} sur ${total} compte${total > 1 ? "s" : ""}`}
            </span>
          )}
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
        {/* Barre d'actions : après la pagination, alignée à droite. Rendue en
            `visibility: hidden` hors sélection (et non démontée) — elle réserve ainsi sa
            hauteur, plus grande que celle du compteur, et la ligne ne saute pas.
            Ressort symétrique du bloc de gauche → pagination centrée. */}
        <div
          style={{
            visibility: selected ? "visible" : "hidden",
            flex: 1,
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: ".75rem",
          }}
        >
          <button
            type="button"
            className="btn btn-ghost"
            onClick={editSelected}
            style={{
              borderColor: "color-mix(in srgb, var(--accent) 40%, transparent)",
              color: "var(--accent)",
              ...ACTION_BTN_STYLE,
            }}
          >
            ✏️ Modifier
          </button>
          {!selected?.anonymized && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => selected && setAnonymizeTarget(selected)}
              disabled={pending}
              style={{ ...GHOST_DANGER_STYLE, ...ACTION_BTN_STYLE }}
              title="Anonymisation RGPD : efface les données personnelles, conserve les réservations"
            >
              🗑️ Anonymiser
            </button>
          )}
          {selected?.bookingCount === 0 && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => selected && setDeleteTarget(selected)}
              disabled={pending}
              style={{ ...GHOST_DANGER_STYLE, ...ACTION_BTN_STYLE }}
              title="Compte sans réservation : suppression physique de la base (test, spam)"
            >
              🗑️ Supprimer définitivement
            </button>
          )}
          {selected && !selected.emailVerified && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={resendConfirmation}
              disabled={pending}
              style={{
                borderColor: "rgba(232,164,90,.4)",
                color: "var(--warn)",
                ...ACTION_BTN_STYLE,
              }}
            >
              🖅 Renvoyer le mail de confirmation
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={clearSelection}
            style={ACTION_BTN_STYLE}
            title="Désélectionner le compte"
          >
            Annuler
          </button>
        </div>
      </div>

      {anonymizeTarget && (
        <AnonymizeUserModal
          name={`${anonymizeTarget.prenom} ${anonymizeTarget.nom}`.trim()}
          email={anonymizeTarget.email}
          pending={pending}
          onCancel={() => setAnonymizeTarget(null)}
          onConfirm={confirmAnonymize}
        />
      )}

      {deleteTarget && (
        <DeleteUserModal
          name={`${deleteTarget.prenom} ${deleteTarget.nom}`.trim()}
          email={deleteTarget.email}
          pending={pending}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      )}

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
