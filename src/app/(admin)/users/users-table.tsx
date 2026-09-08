"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ConfirmPasswordModal } from "@/components/confirm-password-modal";
import { GHOST_DANGER_STYLE } from "@/components/ui-styles";
import type { Role } from "@/generated/prisma/client";
import { formatTel } from "@/lib/format";
import {
  ActionIconButton,
  Avatar,
  BuildingGlyph,
  DownloadGlyph,
  PencilGlyph,
  RolePill,
  SchoolGlyph,
  SendGlyph,
  StatusPill,
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
const COL_CHECK = 34;
const COL_STATUT = 112; // pastille « En attente » avec son pictogramme
const COL_ROLE = 120; // pastille « Administrateur »
const COL_TEL = 112; // « 06 12 34 56 78 »
const COL_ACTIONS = 122; // 4 boutons de 26 px
const COL_REST = COL_CHECK + COL_STATUT + COL_ROLE + COL_TEL + COL_ACTIONS;
const COL_COMPTE = `calc((100% - ${COL_REST}px) * 0.58)`;
const COL_AFF = `calc((100% - ${COL_REST}px) * 0.42)`;

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
  display: "inline-flex",
  alignItems: "center",
  gap: ".3rem",
} as const;

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
      setSelectedId(null);
      router.refresh();
    });
  }

  function resendConfirmation(u: UserRow | null = selected) {
    if (!u) return;
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
            <col style={{ width: COL_CHECK }} />
            <col style={{ width: COL_COMPTE }} />
            <col style={{ width: COL_STATUT }} />
            <col style={{ width: COL_ROLE }} />
            <col style={{ width: COL_AFF }} />
            <col style={{ width: COL_TEL }} />
            <col style={{ width: COL_ACTIONS }} />
          </colgroup>
          <thead>
            <tr>
              <th className="col-check" />
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
              const checked = selectedId === u.id;
              const aff = affiliation(u);
              const rowClasses = [
                roleBreak ? "role-break" : "",
                checked ? "row-checked" : "",
                u.anonymized ? "is-anon" : "",
              ]
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
                    {/* Actions de ligne (crayon / flèche / personne barrée / avion — Dom
                        2026-09-08), révélées au survol ; un compte anonymisé ne garde que
                        l'export. Les actions rares (suppression d'un compte vide, second
                        facteur) restent dans la barre sous le tableau, via la case à cocher. */}
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
                  <td colSpan={7}>&nbsp;</td>
                </tr>
              ))}
            {total === 0 && (
              <tr className="acct-empty">
                <td colSpan={7}>Aucun compte ne correspond.</td>
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
            <PencilGlyph size={13} /> Modifier
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
              <UserOffGlyph size={13} /> Anonymiser
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
              onClick={() => resendConfirmation()}
              disabled={pending}
              style={{
                borderColor: "rgba(232,164,90,.4)",
                color: "var(--warn)",
                ...ACTION_BTN_STYLE,
              }}
            >
              <SendGlyph size={13} /> Renvoyer le mail de confirmation
            </button>
          )}
          {/* N'apparaît que si un second facteur est effectivement actif : proposer
              de réinitialiser ce qui n'existe pas n'apprendrait rien à personne, et
              le serveur refuserait de toute façon. */}
          {selected?.twoFactorEnabled && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setResetErreur(null);
                if (selected) setResetTarget(selected);
              }}
              disabled={pending}
              style={{
                borderColor: "rgba(232,164,90,.4)",
                color: "var(--warn)",
                ...ACTION_BTN_STYLE,
              }}
              title="Téléphone ou codes de secours perdus : retire le second facteur, la personne se réenrôle à sa prochaine visite"
            >
              🔑 Réinitialiser la double authentification
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
            setSelectedId(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
