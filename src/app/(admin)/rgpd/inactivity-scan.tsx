"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ConfirmPasswordModal } from "@/components/confirm-password-modal";
import { INPUT_CHROME } from "@/components/ui-styles";
import { DATE_FMT_FR as dateFmt } from "@/lib/format";
import {
  anonymizeInactiveAction,
  sendInactivityNoticesAction,
  setGraceDaysAction,
  setRetentionYearsAction,
} from "./actions";

const PAGE_SIZE = 10;
const MS_PER_DAY = 86_400_000;

/** Ligne sérialisée reçue du serveur (dates en ISO string). */
export type InactiveRow = {
  id: string;
  nom: string;
  prenom: string;
  email: string;
  deletionNoticeSentAt: string | null;
  daysInactive: number;
  lastSeen: string;
  lastSeenSource: "connexion" | "réservation" | "création";
};

// "il y a 2 ans 3 mois" / "il y a 4 jours" / "aujourd'hui" (calque _rgpdFmtDuration).
function fmtDuration(days: number): string {
  if (days < 1) return "aujourd'hui";
  if (days < 30) return `il y a ${days} jour${days > 1 ? "s" : ""}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `il y a ${months} mois`;
  const years = Math.floor(days / 365);
  const remMonths = Math.floor((days - years * 365) / 30);
  return remMonths
    ? `il y a ${years} an${years > 1 ? "s" : ""} ${remMonths} mois`
    : `il y a ${years} an${years > 1 ? "s" : ""}`;
}

function countWord(n: number): string {
  return n > 1 ? "comptes utilisateurs" : "compte utilisateur";
}

/** Âge du préavis en jours, ou -1 si jamais envoyé. */
function noticeAge(sentAt: string | null): number {
  if (!sentAt) return -1;
  const t = new Date(sentAt).getTime();
  if (Number.isNaN(t)) return -1;
  return Math.floor((Date.now() - t) / MS_PER_DAY);
}

// Statut RGPD d'un compte — RÈGLE UNIQUE d'éligibilité, partagée par le décompte global et
// l'affichage par ligne (évite que les deux divergent). « ineligible » : inactivité < seuil ;
// « needNotice » : éligible, préavis jamais envoyé ; « needWait » : préavis envoyé mais délai
// de grâce non atteint ; « canAnonymize » : préavis + grâce écoulés.
type RgpdStatus = "ineligible" | "needNotice" | "needWait" | "canAnonymize";
function classifyUser(
  u: { daysInactive: number; deletionNoticeSentAt: string | null },
  thresholdDays: number,
  grace: number,
): RgpdStatus {
  if (u.daysInactive < thresholdDays) return "ineligible";
  if (!u.deletionNoticeSentAt) return "needNotice";
  return noticeAge(u.deletionNoticeSentAt) >= grace ? "canAnonymize" : "needWait";
}

/** Cellule « Préavis » selon l'état d'éligibilité et l'âge du préavis. */
function NoticeCell({
  row,
  eligible,
  graceDays,
}: {
  row: InactiveRow;
  eligible: boolean;
  graceDays: number;
}): ReactNode {
  if (!eligible) return <span style={{ color: "var(--muted)" }}>—</span>;
  if (!row.deletionNoticeSentAt) {
    return <span style={{ color: "#e8a45a", fontWeight: 600 }}>à envoyer</span>;
  }
  const sentLbl = dateFmt.format(new Date(row.deletionNoticeSentAt));
  const remain = graceDays - noticeAge(row.deletionNoticeSentAt);
  if (remain > 0) {
    return (
      <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>
        envoyé le {sentLbl} · <span style={{ color: "#e8a45a" }}>J−{remain}</span>
      </span>
    );
  }
  return (
    <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>
      envoyé le {sentLbl} ·{" "}
      <span style={{ color: "var(--danger)", fontWeight: 600 }}>délai écoulé</span>
    </span>
  );
}

export function InactivityScan({
  rows,
  retentionYears,
  graceDays,
}: {
  rows: InactiveRow[];
  retentionYears: number;
  graceDays: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [years, setYears] = useState(retentionYears);
  const [cible, setCible] = useState<{ ids: string[]; libelle: string } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [grace, setGrace] = useState(graceDays);
  const [page, setPage] = useState(0);

  const thresholdDays = years * 365;

  // Compteurs et classification recalculés localement à partir des props.
  const { needNoticeIds, canAnonymizeIds } = useMemo(() => {
    const needNotice: string[] = [];
    const canAnon: string[] = [];
    for (const u of rows) {
      const s = classifyUser(u, thresholdDays, grace);
      if (s === "needNotice") needNotice.push(u.id);
      else if (s === "canAnonymize") canAnon.push(u.id);
    }
    return { needNoticeIds: needNotice, canAnonymizeIds: canAnon };
  }, [rows, thresholdDays, grace]);

  const needNoticeCount = needNoticeIds.length;
  const canAnonymizeCount = canAnonymizeIds.length;

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, totalPages - 1);
  const from = current * PAGE_SIZE;
  const pageRows = rows.slice(from, from + PAGE_SIZE);

  // Persistance différée (debounce) : la classification/les compteurs sont recalculés
  // localement (useMemo sur rows + threshold), donc l'UI répond immédiatement à la frappe.
  // Le réglage n'est écrit en base (config lue par le cron / au prochain chargement) qu'après
  // une courte pause — inutile d'appeler une server action + router.refresh à chaque touche.
  const yearsSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const graceSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (yearsSaveRef.current) clearTimeout(yearsSaveRef.current);
      if (graceSaveRef.current) clearTimeout(graceSaveRef.current);
    },
    [],
  );

  function onYearsChange(raw: string) {
    const v = Number.parseInt(raw, 10);
    if (!Number.isFinite(v) || v < 0 || v > 3) return;
    setYears(v);
    if (yearsSaveRef.current) clearTimeout(yearsSaveRef.current);
    yearsSaveRef.current = setTimeout(() => {
      setRetentionYearsAction(v).catch(() => {});
    }, 500);
  }

  function onGraceChange(raw: string) {
    const v = Number.parseInt(raw, 10);
    if (!Number.isFinite(v) || v < 1 || v > 365) return;
    setGrace(v);
    if (graceSaveRef.current) clearTimeout(graceSaveRef.current);
    graceSaveRef.current = setTimeout(() => {
      setGraceDaysAction(v).catch(() => {});
    }, 500);
  }

  function refresh() {
    startTransition(() => {
      router.refresh();
    });
  }

  function sendNotices() {
    if (needNoticeCount === 0) return;
    if (
      !confirm(
        `Envoyer le préavis de suppression à ${needNoticeCount} ${countWord(needNoticeCount)} éligible(s) sans préavis ? Un délai de ${grace} jours s'appliquera avant tout effacement.`,
      )
    )
      return;
    const ids = needNoticeIds.slice();
    startTransition(async () => {
      await sendInactivityNoticesAction(ids);
      router.refresh();
    });
  }

  function anonymizeAll() {
    if (canAnonymizeCount === 0) return;
    setCible({
      ids: canAnonymizeIds.slice(),
      libelle: `${canAnonymizeCount} ${countWord(canAnonymizeCount)} inactif(s)`,
    });
  }

  function anonymizeOne(id: string, label: string) {
    setCible({ ids: [id], libelle: `le compte de ${label}` });
  }

  // Ré-authentification avant une anonymisation IRRÉVERSIBLE, et de masse dans le
  // premier cas (constat BAC3).
  function confirmer(password: string) {
    if (!cible) return;
    setErreur(null);
    startTransition(async () => {
      const res = await anonymizeInactiveAction(cible.ids, password);
      if (res && !res.ok) {
        setErreur(res.error ?? "Échec de l'anonymisation.");
        return;
      }
      setCible(null);
      router.refresh();
    });
  }

  return (
    <div>
      {cible && (
        <ConfirmPasswordModal
          titre="🗑️ Anonymiser"
          libelleAction="Anonymiser"
          pending={pending}
          erreur={erreur}
          onCancel={() => setCible(null)}
          onConfirm={confirmer}
        >
          <p style={{ marginBottom: ".5rem" }}>
            Vous êtes sur le point d&apos;anonymiser <strong>{cible.libelle}</strong>.
          </p>
          <p style={{ color: "var(--muted)", fontSize: ".8rem" }}>
            L&apos;opération est <strong>irréversible</strong> : ces comptes ne pourront plus être
            ré-identifiés. Les réservations sont conservées, rattachées à un compte anonyme.
          </p>
        </ConfirmPasswordModal>
      )}
      <div className="panel-title" style={{ padding: ".3rem 0" }}>
        <span className="dot" style={{ background: "var(--warn)" }} />
        Scan d&apos;inactivité
      </div>
      <p
        style={{
          fontSize: ".78rem",
          color: "var(--muted)",
          marginBottom: "1rem",
          lineHeight: 1.5,
        }}
      >
        Liste tous les utilisateurs (hors gestionnaires et administrateurs) triés par durée
        d&apos;inactivité décroissante. Le bouton « Effacer » apparaît pour ceux qui dépassent le
        seuil défini ci-dessous.
      </p>

      {/* Barre de contrôles : seuil + actions. La rangée ne s'enroule PAS (nowrap) : quand
          la place manque, les libellés s'empilent dans leur propre groupe et les boutons
          restent groupés à droite (jamais rejetés sous les libellés). */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "1rem",
          marginBottom: ".75rem",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "1rem",
            flexWrap: "wrap",
            minWidth: 0,
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: ".4rem",
              fontSize: ".65rem",
              color: "var(--muted)",
              whiteSpace: "nowrap",
            }}
          >
            Seuil d&apos;inactivité
            <input
              type="number"
              min={0}
              max={3}
              value={years}
              onChange={(e) => onYearsChange(e.target.value)}
              style={{
                width: 36,
                fontSize: ".7rem",
                padding: ".15rem .35rem",
                ...INPUT_CHROME,
              }}
            />
            an{years > 1 ? "s" : ""}
          </label>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: ".4rem",
              fontSize: ".65rem",
              color: "var(--muted)",
              whiteSpace: "nowrap",
            }}
          >
            Délai de grâce
            <input
              type="number"
              min={1}
              max={365}
              value={grace}
              onChange={(e) => onGraceChange(e.target.value)}
              style={{
                width: 44,
                fontSize: ".7rem",
                padding: ".15rem .35rem",
                ...INPUT_CHROME,
              }}
            />
            jour{grace > 1 ? "s" : ""}
          </label>
        </div>
        <div
          style={{
            marginLeft: "auto",
            minWidth: 0,
            display: "flex",
            gap: ".4rem",
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            className="btn btn-ghost"
            onClick={refresh}
            disabled={pending}
            style={{ padding: ".15rem .55rem", fontSize: ".7rem" }}
          >
            🔄 Rafraîchir
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={sendNotices}
            disabled={pending || needNoticeCount === 0}
            style={{
              padding: ".15rem .55rem",
              fontSize: ".7rem",
              borderColor: "rgba(232,164,90,.4)",
              color: "#e8a45a",
              opacity: needNoticeCount === 0 ? 0.4 : 1,
            }}
          >
            📧 Envoyer le préavis ({needNoticeCount})
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={anonymizeAll}
            disabled={pending || canAnonymizeCount === 0}
            title={
              canAnonymizeCount === 0
                ? `Aucun compte éligible n'a de préavis ≥ ${grace} jours envoyé`
                : undefined
            }
            style={{
              padding: ".15rem .55rem",
              fontSize: ".7rem",
              borderColor: "rgba(224,107,107,.4)",
              color: "var(--danger)",
              opacity: canAnonymizeCount === 0 ? 0.4 : 1,
            }}
          >
            🗑️ Effacer tous les comptes éligibles ({canAnonymizeCount})
          </button>
        </div>
      </div>

      {/* Tableau du scan */}
      <div className="admin-table-wrap">
        <table className="admin-table zebra">
          <thead>
            <tr>
              {/* Nom et E-mail se partagent à parts égales la place laissée par les colonnes
                  étroites ; « Dernière activité » est réduite à la largeur de son entête. */}
              <th style={{ textAlign: "center", width: "30%" }}>Identité</th>
              <th style={{ textAlign: "center", width: "30%" }}>E-mail</th>
              <th
                style={{ textAlign: "center", width: "1%", whiteSpace: "nowrap" }}
                title="Plus récent entre dernière connexion et dernière réservation"
              >
                Dernière activité
              </th>
              <th style={{ textAlign: "center" }}>Préavis</th>
              <th style={{ textAlign: "center" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((u) => {
              const status = classifyUser(u, thresholdDays, grace);
              const eligible = status !== "ineligible";
              const canDelete = status === "canAnonymize";
              const fullName = `${u.nom} ${u.prenom}`.trim() || u.email;

              let actionCell: ReactNode;
              if (canDelete) {
                actionCell = (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => anonymizeOne(u.id, fullName)}
                    disabled={pending}
                    style={{
                      padding: ".05rem .5rem",
                      fontSize: ".72rem",
                      borderColor: "rgba(224,107,107,.4)",
                      color: "var(--danger)",
                    }}
                  >
                    🗑️ Effacer
                  </button>
                );
              } else if (eligible) {
                actionCell = (
                  <span
                    style={{ color: "var(--muted)" }}
                    title={`Le préavis doit avoir été envoyé il y a au moins ${grace} jours`}
                  >
                    ⏳ préavis requis
                  </span>
                );
              } else {
                actionCell = <span style={{ color: "var(--muted)" }}>—</span>;
              }

              return (
                <tr key={u.id}>
                  <td>{fullName}</td>
                  <td style={{ color: "var(--muted)" }}>{u.email}</td>
                  <td style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>
                    <span title={`via ${u.lastSeenSource}`}>
                      {dateFmt.format(new Date(u.lastSeen))}
                    </span>{" "}
                    ·{" "}
                    <span
                      style={eligible ? { color: "var(--danger)", fontWeight: 600 } : undefined}
                    >
                      {fmtDuration(u.daysInactive)}
                    </span>
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <NoticeCell row={u} eligible={eligible} graceDays={grace} />
                  </td>
                  <td style={{ textAlign: "center" }}>{actionCell}</td>
                </tr>
              );
            })}
            {/* Lignes vides de complément : hauteur de page constante (10 lignes) */}
            {total > 0 &&
              pageRows.length < PAGE_SIZE &&
              Array.from({ length: PAGE_SIZE - pageRows.length }, (_, i) => (
                // biome-ignore lint/a11y/noAriaHiddenOnFocusable: ligne purement décorative (aucun contenu focusable) — le masquage aux lecteurs d'écran est voulu
                <tr key={`filler-${i}`} aria-hidden="true">
                  <td colSpan={5}>&nbsp;</td>
                </tr>
              ))}
            {total === 0 && (
              <tr>
                <td
                  colSpan={5}
                  style={{
                    textAlign: "center",
                    padding: "1.5rem",
                    color: "var(--muted)",
                    fontStyle: "italic",
                  }}
                >
                  Aucun compte utilisateur à traiter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", alignItems: "center", marginTop: ".6rem" }}>
        <span style={{ flex: 1, fontSize: ".7rem", color: "var(--muted)" }}>
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
    </div>
  );
}
