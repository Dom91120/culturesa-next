"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ConfirmPasswordModal } from "@/components/confirm-password-modal";
import type { Role } from "@/generated/prisma/client";
import { formatTel } from "@/lib/format";
import {
  ActionIconButton,
  Avatar,
  BuildingGlyph,
  DownloadGlyph,
  KeyGlyph,
  PencilGlyph,
  RolePill,
  SchoolGlyph,
  SendGlyph,
  StatusPill,
  TrashGlyph,
  UserOffGlyph,
  UsersGlyph,
} from "./account-ui";
import {
  anonymizeUserAction,
  deleteEmptyUserAction,
  resendVerificationAction,
  resetTwoFactorAction,
} from "./actions";
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
  /** Second facteur actif (A6). Conditionne le bouton de réinitialisation. */
  twoFactorEnabled: boolean;
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

/** `structureLibre` : catégorie fourre-tout, dont la structure se saisit au lieu de se choisir. */
export type Demandeur = { id: number; label: string; structureLibre: boolean };
export type StructureRef = { id: number; label: string; demandeurId: number };
export type NiveauRef = { id: number; label: string; demandeurId: number | null };
export type ServiceRef = { id: string; label: string };

type SortKey = "default" | "nom" | "role";

// Filtres rapides (puces au-dessus du tableau — refonte Dom 2026-09-08).
type Filter = "all" | "utilisateur" | "gestionnaire" | "administrateur" | "pending" | "anonymized";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Tous" },
  { key: "utilisateur", label: "Utilisateurs" },
  { key: "gestionnaire", label: "Gestionnaires" },
  { key: "administrateur", label: "Administrateurs" },
  { key: "pending", label: "Non confirmés" },
  { key: "anonymized", label: "Anonymisés" },
];
function matchFilter(u: UserRow, f: Filter): boolean {
  switch (f) {
    case "all":
      return true;
    case "pending":
      return !u.emailVerified && !u.anonymized;
    case "anonymized":
      return u.anonymized;
    default:
      return u.role === f;
  }
}

const PAGE_SIZE = 15;

// ── Largeurs de colonnes (cf. <colgroup>) : colonnes d'appoint en pixels, « Compte »
// et « Structure / Service » se partagent le reste (58 % – 42 %).
const COL_STATUT = 112; // pastille « En attente » avec son pictogramme
const COL_ROLE = 120; // pastille « Administrateur »
const COL_TEL = 112; // « 06 12 34 56 78 »
const COL_ACTIONS = 160; // jusqu'à 6 boutons de 24 px
const COL_REST = COL_STATUT + COL_ROLE + COL_TEL + COL_ACTIONS;
const COL_COMPTE = `calc((100% - ${COL_REST}px) * 0.58)`;
const COL_AFF = `calc((100% - ${COL_REST}px) * 0.42)`;

// Recherche accent-insensible (réimplémente _normSearch du legacy).
function normSearch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

// Affiliation : services gérés (gestionnaire), sinon structure, sinon catégorie — avec un
// pictogramme qui dit lequel des trois on lit.
type AffKind = "service" | "structure" | "categorie";
function affiliation(u: UserRow): { label: string; kind: AffKind | null } {
  if (u.serviceLabels.length) return { label: u.serviceLabels.join(", "), kind: "service" };
  if (u.structureLabel) return { label: u.structureLabel, kind: "structure" };
  if (u.demandeurLabel) return { label: u.demandeurLabel, kind: "categorie" };
  return { label: "—", kind: null };
}
const AFF_GLYPH: Record<AffKind, React.ReactNode> = {
  service: <BuildingGlyph size={14} />,
  structure: <SchoolGlyph size={14} />,
  categorie: <UsersGlyph size={14} />,
};

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
      className={`sortable${sortKey === sk ? " sorted" : ""}`}
      style={{ minWidth }}
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
  const [filter, setFilter] = useState<Filter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("default");
  const [page, setPage] = useState(0);

  const [modal, setModal] = useState<{ mode: "create" | "edit"; user: UserRow | null } | null>(
    null,
  );
  // Compte visé par la modale de suppression physique (comptes vides uniquement).
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  // Compte visé par la modale d'anonymisation RGPD (barre d'actions ou bouton de ligne).
  const [anonymizeTarget, setAnonymizeTarget] = useState<UserRow | null>(null);
  // Compte dont on réinitialise le second facteur (A6) — seul recours pour un
  // administrateur ayant perdu son téléphone ET ses codes de secours.
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  // Le refus de ré-authentification (mot de passe incorrect) doit s'afficher DANS
  // la modale, sans la fermer : la refermer sur un `alert` obligerait à tout
  // ressaisir pour une simple faute de frappe.
  const [resetErreur, setResetErreur] = useState<string | null>(null);

  // Effectifs des puces (sur TOUS les comptes, indépendants de la recherche).
  const counts = useMemo(() => {
    const c = {} as Record<Filter, number>;
    for (const f of FILTERS) c[f.key] = users.filter((u) => matchFilter(u, f.key)).length;
    return c;
  }, [users]);

  const filtered = useMemo(() => {
    const q = normSearch(query.trim());
    const list = users.filter(
      (u) =>
        matchFilter(u, filter) &&
        (!q ||
          normSearch(
            `${u.nom}${u.prenom}${u.email}${u.structureLabel ?? ""}${u.serviceLabels.join("")}`,
          ).includes(q)),
    );
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
  }, [users, query, filter, sortKey]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, totalPages - 1);
  const from = current * PAGE_SIZE;
  const pageRows = filtered.slice(from, from + PAGE_SIZE);

  function sortBy(key: SortKey) {
    setSortKey(key);
  }

  function confirmAnonymize(password: string) {
    if (!anonymizeTarget) return;
    const id = anonymizeTarget.id;
    startTransition(async () => {
      const res = await anonymizeUserAction(id, password);
      if (!res?.ok) alert(res?.error ?? "Échec de l'anonymisation.");
      setAnonymizeTarget(null);
      router.refresh();
    });
  }

  // Réinitialisation du second facteur d'un AUTRE compte. Le serveur re-vérifie
  // le rôle administrateur et exige le mot de passe de l'opérateur (BAC3) :
  // retirer un second facteur abaisse la protection d'un compte privilégié.
  function confirmResetTwoFactor(password: string) {
    if (!resetTarget) return;
    const id = resetTarget.id;
    setResetErreur(null);
    startTransition(async () => {
      const res = await resetTwoFactorAction(id, password);
      if (!res?.ok) {
        setResetErreur(res?.error ?? "Échec de la réinitialisation.");
        return;
      }
      setResetTarget(null);
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
      router.refresh();
    });
  }

  function resendConfirmation(u: UserRow) {
    startTransition(async () => {
      await resendVerificationAction(u.email);
    });
  }

  return (
    // Panneau autour du contenu, comme le sous-onglet « Connectés » (Dom 2026-09-07).
    <div className="panel">
      <div className="panel-title" style={{ marginBottom: ".55rem" }}>
        <span className="dot" style={{ background: "var(--warn)" }} />
        Comptes utilisateurs
        <span style={{ color: "var(--muted)", fontWeight: 400 }}>· {users.length}</span>
      </div>

      {/* Barre d'outils sur UNE ligne (Dom 2026-09-08) : filtres rapides à gauche — un clic
          isole une population, l'effectif est celui de tous les comptes, la recherche
          s'applique ensuite, retour à la page 1 à chaque changement — recherche et
          « Ajouter » à droite. */}
      <div className="acct-toolbar">
        <fieldset
          aria-label="Filtrer les comptes"
          style={{
            border: "none",
            padding: 0,
            margin: 0,
            display: "flex",
            gap: ".4rem",
            flexWrap: "wrap",
          }}
        >
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`acct-chip${filter === f.key ? " is-on" : ""}`}
              aria-pressed={filter === f.key}
              onClick={() => {
                setFilter(f.key);
                setPage(0);
              }}
            >
              {f.label}
              <span className="n">{counts[f.key]}</span>
            </button>
          ))}
        </fieldset>
        {/* Recherche + « Ajouter » : un seul bloc, qui passe à la ligne d'un tenant et
            reste aligné à droite quand la place manque (Dom 2026-09-08). */}
        <div className="acct-toolbar-right">
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
              placeholder="Nom, e-mail, structure…"
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
            style={{ padding: ".25rem .65rem", fontSize: ".68rem", whiteSpace: "nowrap" }}
            title="Ajouter un compte"
          >
            ＋<span className="acct-add-label"> Ajouter</span>
          </button>
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="acct-table" style={{ minWidth: 860 }}>
          <colgroup>
            <col style={{ width: COL_COMPTE }} />
            <col style={{ width: COL_STATUT }} />
            <col style={{ width: COL_ROLE }} />
            <col style={{ width: COL_AFF }} />
            <col style={{ width: COL_TEL }} />
            <col style={{ width: COL_ACTIONS }} />
          </colgroup>
          <thead>
            <tr>
              <SortTh label="Compte" sk="nom" sortKey={sortKey} onSort={sortBy} />
              <th title="Adresse e-mail confirmée par l'usager">Statut</th>
              <SortTh label="Rôle" sk="role" sortKey={sortKey} onSort={sortBy} />
              <th>Structure / Service</th>
              <th>Téléphone</th>
              <th style={{ textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((u, i) => {
              const prev = i > 0 ? pageRows[i - 1] : from > 0 ? filtered[from - 1] : null;
              const roleBreak =
                (sortKey === "default" || sortKey === "role") &&
                prev != null &&
                prev.role !== u.role;
              const aff = affiliation(u);
              const rowClasses = [roleBreak ? "role-break" : "", u.anonymized ? "is-anon" : ""]
                .filter(Boolean)
                .join(" ");
              return (
                <tr key={u.id} className={rowClasses || undefined}>
                  <td>
                    <div className="acct-who">
                      <Avatar
                        prenom={u.prenom}
                        nom={u.nom}
                        email={u.email}
                        role={u.role}
                        anonymized={u.anonymized}
                      />
                      <div style={{ minWidth: 0 }}>
                        <div className="name" title={`${u.nom} ${u.prenom}`.trim()}>
                          {u.anonymized ? "Compte anonymisé" : `${u.nom} ${u.prenom}`.trim() || "—"}
                        </div>
                        <div className="mail" title={u.email}>
                          {u.email}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <StatusPill
                      status={
                        u.anonymized ? "anonymized" : u.emailVerified ? "confirmed" : "pending"
                      }
                    />
                  </td>
                  <td>
                    <RolePill role={u.role} dim={u.anonymized} />
                  </td>
                  <td title={aff.label}>
                    <span className="acct-aff">
                      {aff.kind && AFF_GLYPH[aff.kind]}
                      <span>{aff.label}</span>
                    </span>
                  </td>
                  <td>{formatTel(u.tel)}</td>
                  <td>
                    {/* Actions de ligne (Dom 2026-09-08), révélées au survol : avion (compte
                        en attente), crayon, flèche (export RGPD), personne barrée (anonymiser),
                        clé (second facteur actif), corbeille (compte sans réservation). Un
                        compte anonymisé ne garde que l'export. Plus de case à cocher ni de
                        barre d'actions : on agit rarement sur plusieurs comptes. */}
                    <div className="acct-actions">
                      {!u.anonymized && !u.emailVerified && (
                        <ActionIconButton
                          label="Renvoyer le mail de confirmation"
                          tone="warn"
                          disabled={pending}
                          onClick={() => resendConfirmation(u)}
                        >
                          <SendGlyph />
                        </ActionIconButton>
                      )}
                      <ActionIconButton
                        label="Modifier la fiche"
                        onClick={() => setModal({ mode: "edit", user: u })}
                      >
                        <PencilGlyph />
                      </ActionIconButton>
                      <ActionIconButton
                        label="Exporter les données (RGPD art. 15)"
                        href={`/rgpd/export?userId=${u.id}`}
                      >
                        <DownloadGlyph />
                      </ActionIconButton>
                      {!u.anonymized && (
                        <ActionIconButton
                          label="Anonymiser ce compte (RGPD) : efface les données personnelles, conserve les réservations"
                          tone="danger"
                          onClick={() => setAnonymizeTarget(u)}
                        >
                          <UserOffGlyph />
                        </ActionIconButton>
                      )}
                      {/* N'apparaît que si un second facteur est effectivement actif :
                          proposer de réinitialiser ce qui n'existe pas n'apprendrait rien à
                          personne, et le serveur refuserait de toute façon. */}
                      {u.twoFactorEnabled && (
                        <ActionIconButton
                          label="Réinitialiser la double authentification (téléphone ou codes de secours perdus)"
                          tone="warn"
                          disabled={pending}
                          onClick={() => {
                            setResetErreur(null);
                            setResetTarget(u);
                          }}
                        >
                          <KeyGlyph />
                        </ActionIconButton>
                      )}
                      {u.bookingCount === 0 && (
                        <ActionIconButton
                          label="Supprimer définitivement (compte sans réservation : test, spam)"
                          tone="danger"
                          disabled={pending}
                          onClick={() => setDeleteTarget(u)}
                        >
                          <TrashGlyph />
                        </ActionIconButton>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {/* Lignes vides de complément : hauteur de page constante (15 lignes) */}
            {total > 0 &&
              pageRows.length < PAGE_SIZE &&
              Array.from({ length: PAGE_SIZE - pageRows.length }, (_, i) => (
                // biome-ignore lint/a11y/noAriaHiddenOnFocusable: ligne purement décorative (aucun contenu focusable) — le masquage aux lecteurs d'écran est voulu
                <tr key={`filler-${i}`} aria-hidden="true">
                  <td colSpan={6}>&nbsp;</td>
                </tr>
              ))}
            {total === 0 && (
              <tr className="acct-empty">
                <td colSpan={6}>Aucun compte ne correspond.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: ".5rem", display: "flex", alignItems: "center", gap: ".75rem" }}>
        {/* Compteur à gauche, pagination centrée (ressort symétrique à droite). */}
        <span style={{ flex: 1, fontSize: ".72rem", color: "var(--muted)", whiteSpace: "nowrap" }}>
          {total === 0
            ? "0 compte"
            : `${from + 1}–${from + pageRows.length} sur ${total} compte${total > 1 ? "s" : ""}`}
        </span>
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

      {anonymizeTarget && (
        <AnonymizeUserModal
          name={`${anonymizeTarget.prenom} ${anonymizeTarget.nom}`.trim()}
          email={anonymizeTarget.email}
          pending={pending}
          onCancel={() => setAnonymizeTarget(null)}
          onConfirm={confirmAnonymize}
        />
      )}

      {resetTarget && (
        <ConfirmPasswordModal
          titre="🔑 Réinitialiser la double authentification"
          libelleAction="Réinitialiser"
          pending={pending}
          erreur={resetErreur}
          onCancel={() => setResetTarget(null)}
          onConfirm={confirmResetTwoFactor}
        >
          <p style={{ marginBottom: ".6rem" }}>
            Le second facteur de{" "}
            <strong>
              {`${resetTarget.prenom} ${resetTarget.nom}`.trim() || resetTarget.email}
            </strong>{" "}
            sera retiré. La personne se reconnectera avec son seul mot de passe, puis sera invitée à
            se réenrôler dès sa prochaine visite.
          </p>
          {/* Dire à quoi sert ce bouton évite qu'il serve à autre chose : c'est un
              recours, pas un moyen commode de contourner le second facteur. */}
          <p style={{ color: "var(--muted)", marginBottom: ".6rem" }}>
            À n&apos;utiliser que si la personne a perdu son téléphone <em>et</em> ses codes de
            secours.
          </p>
          <p style={{ color: "var(--warn)", fontWeight: 600 }}>
            ⚠️ Assurez-vous de son identité par un autre canal que le courriel. Cette opération
            abaisse la protection d&apos;un compte privilégié ; elle est tracée au journal
            d&apos;audit.
          </p>
        </ConfirmPasswordModal>
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
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
