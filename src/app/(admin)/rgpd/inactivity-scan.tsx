"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ConfirmPasswordModal } from "@/components/confirm-password-modal";
import {
  AlertGlyph,
  ArrowRightGlyph,
  CircleCheckGlyph,
  MailGlyph,
  RefreshGlyph,
  ShieldCheckGlyph,
} from "@/components/ui-glyphs";
import { DATE_FMT_FR as dateFmt } from "@/lib/format";
import { ActionIconButton, DownloadGlyph, initials, UserOffGlyph } from "../users/account-ui";
import {
  anonymizeInactiveAction,
  sendInactivityNoticesAction,
  setGraceDaysAction,
  setRetentionYearsAction,
} from "./actions";

// ════════════════════════════════════════════════════════════════════════════
//  Conservation des données (ex-« Scan d'inactivité ») — refonte Dom 2026-09-08 :
//  parcours en trois étapes (inactivité tolérée → préavis → anonymisation) avec les
//  effectifs à chaque étape, seuils réglables dessous, comptes REGROUPÉS par situation
//  (au-delà du seuil d'abord) avec jauge d'inactivité graduée et lecture en clair,
//  pastille de préavis, actions au survol (export RGPD, préavis, anonymisation), actions
//  groupées en pied.
// ════════════════════════════════════════════════════════════════════════════

const PAGE_SIZE = 10;
const MS_PER_DAY = 86_400_000;
// Position du repère « seuil » sur la jauge : ce qui reste à droite montre le dépassement.
const GAUGE_THRESHOLD_PCT = 86;

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

/** « 2 ans 3 mois », « 4 jours », « aujourd'hui » (sans « il y a »). */
function fmtSpan(days: number): string {
  if (days < 1) return "aujourd'hui";
  if (days < 30) return `${days} jour${days > 1 ? "s" : ""}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} mois`;
  let years = Math.floor(days / 365);
  let remMonths = Math.floor((days - years * 365) / 30);
  // 365 j = 12,17 mois de 30 j : le reste peut atteindre 12 → on bascule sur l'année.
  if (remMonths >= 12) {
    years += 1;
    remMonths = 0;
  }
  return remMonths
    ? `${years} an${years > 1 ? "s" : ""} ${remMonths} mois`
    : `${years} an${years > 1 ? "s" : ""}`;
}

function countWord(n: number): string {
  return n > 1 ? "comptes utilisateurs" : "compte utilisateur";
}

/** Âge du préavis en jours, ou -1 si jamais envoyé. */
function noticeAge(sentAt: string | null, nowMs: number): number {
  if (!sentAt) return -1;
  const t = new Date(sentAt).getTime();
  if (Number.isNaN(t)) return -1;
  return Math.floor((nowMs - t) / MS_PER_DAY);
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
  nowMs: number,
): RgpdStatus {
  if (u.daysInactive < thresholdDays) return "ineligible";
  if (!u.deletionNoticeSentAt) return "needNotice";
  return noticeAge(u.deletionNoticeSentAt, nowMs) >= grace ? "canAnonymize" : "needWait";
}

export function InactivityScan({
  rows,
  retentionYears,
  graceDays,
  generatedAt,
}: {
  rows: InactiveRow[];
  retentionYears: number;
  graceDays: number;
  /** Instant du relevé serveur (ISO) : base des calculs de délais, stable à l'hydratation. */
  generatedAt: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [years, setYears] = useState(retentionYears);
  const [cible, setCible] = useState<{ ids: string[]; libelle: string } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [grace, setGrace] = useState(graceDays);
  const [page, setPage] = useState(0);
  const [nowMs, setNowMs] = useState(() => new Date(generatedAt).getTime());
  useEffect(() => {
    setNowMs(new Date(generatedAt).getTime());
  }, [generatedAt]);

  const thresholdDays = years * 365;

  // Classification et compteurs recalculés localement à partir des props.
  const { statusById, needNoticeIds, needWaitIds, canAnonymizeIds } = useMemo(() => {
    const map = new Map<string, RgpdStatus>();
    const needNotice: string[] = [];
    const needWait: string[] = [];
    const canAnon: string[] = [];
    for (const u of rows) {
      const s = classifyUser(u, thresholdDays, grace, nowMs);
      map.set(u.id, s);
      if (s === "needNotice") needNotice.push(u.id);
      else if (s === "needWait") needWait.push(u.id);
      else if (s === "canAnonymize") canAnon.push(u.id);
    }
    return {
      statusById: map,
      needNoticeIds: needNotice,
      needWaitIds: needWait,
      canAnonymizeIds: canAnon,
    };
  }, [rows, thresholdDays, grace, nowMs]);

  const needNoticeCount = needNoticeIds.length;
  const canAnonymizeCount = canAnonymizeIds.length;
  const eligibleCount = needNoticeCount + needWaitIds.length + canAnonymizeCount;
  const oldest = rows[0]; // trié par inactivité décroissante côté serveur

  // Éligibles d'abord (ordre serveur = inactivité décroissante, donc déjà le cas), puis
  // pagination sur l'ensemble ; les en-têtes de groupe apparaissent au changement de
  // situation à l'intérieur de la page.
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, totalPages - 1);
  const from = current * PAGE_SIZE;
  const pageRows = rows.slice(from, from + PAGE_SIZE);

  // Persistance différée (debounce) : la classification/les compteurs sont recalculés
  // localement, donc l'UI répond immédiatement à la frappe ; le réglage n'est écrit en base
  // (config lue par le cron / au prochain chargement) qu'après une courte pause.
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

  function sendNotices(ids: string[]) {
    if (ids.length === 0) return;
    if (
      !confirm(
        `Envoyer le préavis de suppression à ${ids.length} ${countWord(ids.length)} éligible(s) sans préavis ? Un délai de ${grace} jours s'appliquera avant tout effacement.`,
      )
    )
      return;
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

  const headBtn = {
    padding: ".25rem .65rem",
    fontSize: ".68rem",
    display: "inline-flex",
    alignItems: "center",
    gap: ".35rem",
  } as const;

  let lastGroup: "eligible" | "active" | null = null;

  return (
    <div className="panel">
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

      <div
        className="panel-title"
        style={{ justifyContent: "space-between", gap: ".75rem", marginBottom: ".7rem" }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
          <span className="rg-ico is-info" style={{ color: "var(--accent)" }}>
            <ShieldCheckGlyph size={16} />
          </span>
          Conservation des données
          <span style={{ color: "var(--muted)", fontWeight: 400 }}>· {total} comptes</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: ".5rem" }}>
          {eligibleCount === 0 ? (
            <span className="acct-pill is-ok">
              <CircleCheckGlyph size={12} strokeWidth={2.2} /> Rien à traiter
            </span>
          ) : (
            <span className="acct-pill is-warn">
              <AlertGlyph size={12} strokeWidth={2.2} /> {eligibleCount} compte
              {eligibleCount > 1 ? "s" : ""} à traiter
            </span>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={refresh}
            disabled={pending}
            style={headBtn}
          >
            <RefreshGlyph size={13} /> Rafraîchir
          </button>
        </span>
      </div>

      {/* Parcours : inactivité tolérée → préavis → anonymisation. */}
      <div className="rg-steps">
        <div className="rg-step">
          <span className="n is-ok">1</span>
          <div style={{ minWidth: 0 }}>
            <div className="l">Inactivité tolérée</div>
            <div className="v">
              {years} an{years > 1 ? "s" : ""} <small>sans activité</small>
            </div>
            <div className="s">
              {total} compte{total > 1 ? "s" : ""} suivi{total > 1 ? "s" : ""}
              {oldest ? ` · plus ancien : ${fmtSpan(oldest.daysInactive)}` : ""}
            </div>
          </div>
        </div>
        <span className="rg-arrow">
          <ArrowRightGlyph size={14} />
        </span>
        <div className="rg-step">
          <span className="n is-warn">2</span>
          <div style={{ minWidth: 0 }}>
            <div className="l">Préavis par e-mail</div>
            <div className="v">
              {eligibleCount} <small>au-delà du seuil</small>
            </div>
            <div className="s">
              {needNoticeCount > 0
                ? `${needNoticeCount} préavis à envoyer`
                : needWaitIds.length > 0
                  ? `${needWaitIds.length} préavis en cours`
                  : "aucun préavis en cours"}
            </div>
          </div>
        </div>
        <span className="rg-arrow">
          <ArrowRightGlyph size={14} />
        </span>
        <div className="rg-step">
          <span className="n is-ko">3</span>
          <div style={{ minWidth: 0 }}>
            <div className="l">Anonymisation</div>
            <div className="v">
              {grace} jour{grace > 1 ? "s" : ""} <small>après le préavis</small>
            </div>
            <div className="s">
              {canAnonymizeCount} compte{canAnonymizeCount > 1 ? "s" : ""} éligible
              {canAnonymizeCount > 1 ? "s" : ""} · réservations conservées
            </div>
          </div>
        </div>
      </div>
      <div className="rg-settings">
        <label>
          Seuil
          <input
            type="number"
            min={0}
            max={3}
            value={years}
            onChange={(e) => onYearsChange(e.target.value)}
            className="input"
          />
          an{years > 1 ? "s" : ""}
        </label>
        <label>
          Délai de grâce
          <input
            type="number"
            min={1}
            max={365}
            value={grace}
            onChange={(e) => onGraceChange(e.target.value)}
            className="input"
          />
          jour{grace > 1 ? "s" : ""}
        </label>
        <span className="note">
          La tâche planifiée « Rétention RGPD » applique ces règles chaque nuit.
        </span>
      </div>

      {total === 0 && (
        <p style={{ fontSize: ".8rem", color: "var(--muted)", margin: ".8rem 0 0" }}>
          Aucun compte utilisateur à traiter.
        </p>
      )}

      {/* Liste : défile horizontalement à l'étroit au lieu de déborder du panneau. */}
      <div className="rg-list">
        {total > 0 && (
          <div className="rg-head">
            <span>Compte</span>
            <span title="Plus récent entre dernière connexion et dernière réservation">
              Dernière activité
            </span>
            <span>Inactivité</span>
            <span>Préavis</span>
            <span style={{ textAlign: "right" }} title="Exporter, envoyer le préavis, anonymiser">
              Actions
            </span>
          </div>
        )}

        {pageRows.map((u) => {
          const status = statusById.get(u.id) ?? "ineligible";
          const eligible = status !== "ineligible";
          const group = eligible ? "eligible" : "active";
          const showHeader = group !== lastGroup;
          lastGroup = group;
          const fullName = `${u.nom} ${u.prenom}`.trim() || u.email;
          // Jauge : le repère « seuil » est à GAUGE_THRESHOLD_PCT ; au-delà, la barre file
          // jusqu'au bout en orange.
          const ratio = thresholdDays > 0 ? u.daysInactive / thresholdDays : 1;
          const fill = eligible
            ? 100
            : Math.max(1, Math.min(GAUGE_THRESHOLD_PCT, ratio * GAUGE_THRESHOLD_PCT));
          const remain = thresholdDays - u.daysInactive;
          const gaugeText = eligible
            ? thresholdDays > 0
              ? `${fmtSpan(u.daysInactive)} · seuil dépassé de ${fmtSpan(u.daysInactive - thresholdDays)}`
              : `${fmtSpan(u.daysInactive)} · seuil à 0`
            : `${fmtSpan(u.daysInactive)} · encore ${fmtSpan(remain)}`;
          const age = noticeAge(u.deletionNoticeSentAt, nowMs);
          const graceLeft = grace - age;
          return (
            <div key={u.id}>
              {showHeader && (
                <div className="rg-group">
                  {group === "eligible" ? (
                    <>
                      <AlertGlyph size={13} strokeWidth={2} />
                      <span style={{ color: "var(--warn)" }}>Au-delà du seuil</span>
                      <span>· {eligibleCount}</span>
                    </>
                  ) : (
                    <>
                      <CircleCheckGlyph size={13} strokeWidth={2} />
                      <span style={{ color: "var(--accent)" }}>Actifs</span>
                      <span>· {total - eligibleCount}</span>
                    </>
                  )}
                </div>
              )}
              <div className={`rg-row${eligible ? " is-eligible" : ""}`}>
                <div className="acct-who">
                  <span
                    className={`acct-avatar ${eligible ? "role-gestionnaire" : "role-utilisateur"}`}
                  >
                    {initials(u.prenom, u.nom, u.email)}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div className="name" title={fullName}>
                      {fullName}
                    </div>
                    <div className="mail" title={u.email}>
                      {u.email}
                    </div>
                  </div>
                </div>
                <div
                  title={`Plus récent entre dernière connexion et dernière réservation (via ${u.lastSeenSource})`}
                >
                  {dateFmt.format(new Date(u.lastSeen))}
                  <div className="cron-sub">
                    {u.daysInactive < 1 ? "aujourd'hui" : `il y a ${fmtSpan(u.daysInactive)}`}
                  </div>
                </div>
                <div>
                  <div className="rg-gauge">
                    <i className={eligible ? "is-warn" : undefined} style={{ width: `${fill}%` }} />
                    <b style={{ left: `${GAUGE_THRESHOLD_PCT}%` }} />
                  </div>
                  <div className="cron-sub" style={eligible ? { color: "var(--warn)" } : undefined}>
                    {gaugeText}
                  </div>
                </div>
                <div>
                  {/* Compte actif : cellule vide (le groupe « Actifs » le dit déjà — une
                    colonne de tirets attirait l'œil pour rien, Dom 2026-09-08). */}
                  {status === "needNotice" && (
                    <span className="acct-pill is-warn">
                      <MailGlyph size={12} strokeWidth={2} /> préavis à envoyer
                    </span>
                  )}
                  {status === "needWait" && u.deletionNoticeSentAt && (
                    <>
                      <span className="acct-pill is-warn">
                        <MailGlyph size={12} strokeWidth={2} /> préavis J+{age}
                      </span>
                      <div className="cron-sub">
                        envoyé le {dateFmt.format(new Date(u.deletionNoticeSentAt))} · anonymisation
                        dans {graceLeft} j
                      </div>
                    </>
                  )}
                  {status === "canAnonymize" && u.deletionNoticeSentAt && (
                    <>
                      <span className="acct-pill is-warn" style={{ color: "var(--danger)" }}>
                        <MailGlyph size={12} strokeWidth={2} /> délai écoulé
                      </span>
                      <div className="cron-sub">
                        préavis du {dateFmt.format(new Date(u.deletionNoticeSentAt))}
                      </div>
                    </>
                  )}
                </div>
                <div className="acct-actions">
                  <ActionIconButton
                    label="Exporter les données (RGPD art. 15)"
                    href={`/rgpd/export?userId=${u.id}`}
                  >
                    <DownloadGlyph />
                  </ActionIconButton>
                  {status === "needNotice" && (
                    <ActionIconButton
                      label="Envoyer le préavis de suppression"
                      tone="warn"
                      disabled={pending}
                      onClick={() => sendNotices([u.id])}
                    >
                      <MailGlyph />
                    </ActionIconButton>
                  )}
                  {status === "canAnonymize" && (
                    <ActionIconButton
                      label="Anonymiser ce compte (irréversible ; réservations conservées)"
                      tone="danger"
                      disabled={pending}
                      onClick={() => anonymizeOne(u.id, fullName)}
                    >
                      <UserOffGlyph />
                    </ActionIconButton>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="rg-foot">
        <span>
          {total === 0
            ? "0 compte"
            : `${from + 1}–${from + pageRows.length} sur ${total} compte${total > 1 ? "s" : ""}`}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: ".4rem" }}>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: ".1rem .45rem", fontSize: ".72rem" }}
            disabled={current === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            ‹
          </button>
          {current + 1} / {totalPages}
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: ".1rem .45rem", fontSize: ".72rem" }}
            disabled={current >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
          >
            ›
          </button>
        </span>
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: ".4rem" }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => sendNotices(needNoticeIds.slice())}
            disabled={pending || needNoticeCount === 0}
            style={{
              ...headBtn,
              borderColor: "rgba(232,164,90,.4)",
              color: "var(--warn)",
              opacity: needNoticeCount === 0 ? 0.45 : 1,
            }}
          >
            <MailGlyph size={13} /> Envoyer les préavis ({needNoticeCount})
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
              ...headBtn,
              borderColor: "rgba(224,107,107,.4)",
              color: "var(--danger)",
              opacity: canAnonymizeCount === 0 ? 0.45 : 1,
            }}
          >
            <UserOffGlyph size={13} /> Anonymiser les éligibles ({canAnonymizeCount})
          </button>
        </span>
      </div>
    </div>
  );
}
