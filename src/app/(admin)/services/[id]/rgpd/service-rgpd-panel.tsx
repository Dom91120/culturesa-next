"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { AlertGlyph, CircleCheckGlyph, ShieldCheckGlyph } from "@/components/ui-glyphs";
import { DATE_FMT_FR as dateFmt } from "@/lib/format";
import { fmtSpan, GAUGE_THRESHOLD_PCT, gaugeFor } from "../../../rgpd/inactivity-format";
import { ActionIconButton, DownloadGlyph, initials, UserOffGlyph } from "../../../users/account-ui";
import { anonymizeServiceUserAction } from "./actions";

const PAGE_SIZE = 10;
const MS_PER_DAY = 86_400_000;

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

function plural(n: number, one: string, many: string): string {
  return n > 1 ? many : one;
}

/**
 * Paramètres › RGPD d'un service : droits d'accès (export) et d'effacement (anonymisation)
 * exercés usager par usager, sur les seuls usagers rattachés au service. Même famille
 * graphique que Administration › RGPD (Dom 2026-09-08) : deux cartes de droits en tête,
 * liste avatar + jauge d'inactivité, actions en pictogrammes. Le préavis, l'anonymisation
 * en masse et le journal restent globaux (renvoi en pied).
 */
export function ServiceRgpdPanel({
  serviceId,
  users,
  retentionYears,
  generatedAt,
}: {
  serviceId: string;
  users: ServiceRgpdRow[];
  retentionYears: number;
  generatedAt: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  // Instant du relevé côté serveur : base stable des délais (pas de dérive à l'hydratation).
  const nowMs = useMemo(() => new Date(generatedAt).getTime(), [generatedAt]);
  const thresholdDays = retentionYears * 365;

  const rows = useMemo(
    () =>
      users.map((u) => {
        const t = u.lastSeen ? new Date(u.lastSeen).getTime() : Number.NaN;
        const daysInactive = Number.isNaN(t)
          ? 0
          : Math.max(0, Math.floor((nowMs - t) / MS_PER_DAY));
        return { ...u, daysInactive };
      }),
    [users, nowMs],
  );
  const overCount = rows.filter((r) => r.daysInactive >= thresholdDays).length;

  const filtered = useMemo(() => {
    const q = normSearch(query.trim());
    if (!q) return rows;
    return rows.filter((u) => normSearch(`${u.nom}${u.prenom}${u.email}`).includes(q));
  }, [rows, query]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, totalPages - 1);
  const from = current * PAGE_SIZE;
  const pageRows = filtered.slice(from, from + PAGE_SIZE);
  const usagerWord = plural(users.length, "usager", "usagers");
  const cntLbl =
    query.trim() && total !== users.length
      ? `${total} / ${users.length} ${usagerWord}`
      : total === 0
        ? `0 ${usagerWord}`
        : `${from + 1}–${from + pageRows.length} sur ${total} ${plural(total, "usager", "usagers")}`;

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
      <div
        className="panel-title"
        style={{
          justifyContent: "space-between",
          gap: ".75rem",
          marginBottom: ".7rem",
          flexWrap: "wrap",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: ".6rem", whiteSpace: "nowrap" }}>
          <span className="rg-ico is-info" style={{ color: "var(--accent)" }}>
            <ShieldCheckGlyph size={16} />
          </span>
          Droits RGPD
          <span style={{ color: "var(--muted)", fontWeight: 400 }}>
            · {users.length} {usagerWord} du service
          </span>
        </span>
        <span className="acct-toolbar-right">
          {users.length > 0 &&
            (overCount === 0 ? (
              <span className="acct-pill is-ok">
                <CircleCheckGlyph size={12} strokeWidth={2.2} /> Aucun compte au-delà du seuil
              </span>
            ) : (
              <span className="acct-pill is-warn">
                <AlertGlyph size={12} strokeWidth={2.2} /> {overCount} compte
                {overCount > 1 ? "s" : ""} au-delà du seuil
              </span>
            ))}
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
              id="rgpd-service-search"
              type="text"
              aria-label="Rechercher un usager"
              placeholder="Nom, prénom, e-mail…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
          </div>
        </span>
      </div>

      {/* Les deux droits exerçables ici, à la place d'un long paragraphe d'introduction. */}
      <div className="rg-steps">
        <div className="rg-step">
          <span className="n is-ok">
            <DownloadGlyph size={13} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="l">Droit d&apos;accès · article 15</div>
            <div className="v">
              Exporter <small>profil + historique des réservations</small>
            </div>
            <div className="s">
              Ouvre une vue des données personnelles à transmettre à l&apos;usager qui en fait la
              demande. Téléchargement JSON.
            </div>
          </div>
        </div>
        <div className="rg-step">
          <span className="n is-ko">
            <UserOffGlyph size={13} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="l">Droit à l&apos;effacement · article 17</div>
            <div className="v">
              Anonymiser <small>irréversible</small>
            </div>
            <div className="s">
              Vide nom, prénom, e-mail et téléphone puis verrouille le compte. Les réservations
              passées sont conservées pour les statistiques.
            </div>
          </div>
        </div>
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
          Aucun usager rattaché à ce service.
        </div>
      ) : (
        <div className="rg-list is-service">
          <div className="rg-head">
            <span>Compte</span>
            <span title="Plus récent entre dernière connexion, dernière réservation et création">
              Dernière activité
            </span>
            <span>Inactivité</span>
            <span style={{ textAlign: "right" }}>Actions</span>
          </div>
          <div style={{ marginTop: ".35rem" }}>
            {pageRows.map((u) => {
              const fullName = `${u.nom} ${u.prenom}`.trim() || u.email;
              const { eligible, fill, text } = gaugeFor(u.daysInactive, thresholdDays);
              return (
                <div key={u.id} className={`rg-row${eligible ? " is-eligible" : ""}`}>
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
                  <div>
                    {u.lastSeen ? dateFmt.format(new Date(u.lastSeen)) : "—"}
                    <div className="cron-sub">
                      {u.daysInactive < 1 ? "aujourd'hui" : `il y a ${fmtSpan(u.daysInactive)}`}
                    </div>
                  </div>
                  <div>
                    <div className="rg-gauge">
                      <i
                        className={eligible ? "is-warn" : undefined}
                        style={{ width: `${fill}%` }}
                      />
                      <b style={{ left: `${GAUGE_THRESHOLD_PCT}%` }} />
                    </div>
                    <div
                      className="cron-sub"
                      style={eligible ? { color: "var(--warn)" } : undefined}
                    >
                      {text}
                    </div>
                  </div>
                  <div className="acct-actions">
                    <ActionIconButton
                      label="Exporter les données (RGPD art. 15)"
                      href={`/rgpd/export?userId=${u.id}`}
                    >
                      <DownloadGlyph />
                    </ActionIconButton>
                    <ActionIconButton
                      label="Anonymiser ce compte (irréversible)"
                      tone="danger"
                      disabled={pending}
                      onClick={() => anonymizeOne(u.id, fullName)}
                    >
                      <UserOffGlyph />
                    </ActionIconButton>
                  </div>
                </div>
              );
            })}
            {total === 0 && (
              <div
                style={{
                  textAlign: "center",
                  padding: "1.2rem",
                  fontSize: ".78rem",
                  color: "var(--muted)",
                  fontStyle: "italic",
                }}
              >
                Aucun usager ne correspond à la recherche.
              </div>
            )}
          </div>
        </div>
      )}

      <div className="rg-foot">
        <span>{cntLbl}</span>
        {users.length > 0 && (
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
        )}
        <span className="note">
          Seuil d&apos;inactivité : {retentionYears} an{retentionYears > 1 ? "s" : ""}. Préavis,
          anonymisation en masse et journal :{" "}
          <a href="/rgpd" style={{ color: "var(--accent)", textDecoration: "none" }}>
            Administration → RGPD
          </a>
          .
        </span>
      </div>
    </div>
  );
}
