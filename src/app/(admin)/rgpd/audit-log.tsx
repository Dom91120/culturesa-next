"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ClockGlyph, HistoryGlyph, MailGlyph, RefreshGlyph } from "@/components/ui-glyphs";
import { csvCell } from "@/lib/csv";
import { Avatar, DownloadGlyph, KeyGlyph, TrashGlyph, UserOffGlyph } from "../users/account-ui";

// ════════════════════════════════════════════════════════════════════════════
//  Journal d'audit RGPD — refonte Dom 2026-09-08 : frise chronologique groupée par jour
//  (heure, pictogramme teinté par nature d'action, cible, acteur — personne avec avatar
//  ou tâche planifiée avec horloge), filtres par nature d'action avec effectifs, export
//  CSV inchangé (l'adresse IP y reste, elle n'est plus affichée à l'écran).
// ════════════════════════════════════════════════════════════════════════════

/** Personne (cible ou acteur) résolue côté serveur. */
export type AuditParty = {
  id: string;
  name: string;
  email: string;
  anonymized: boolean;
} | null;

/** Entrée de journal sérialisée pour le client. */
export type AuditEntry = {
  id: number;
  at: string; // ISO
  dateLabel: string;
  action: string;
  target: AuditParty;
  actor: AuditParty;
  ip: string | null;
};

const PAGE_SIZE = 12;

type Family = "anonymisation" | "export" | "suppression" | "preavis" | "acces";
const FAMILY_LABEL: Record<Family, string> = {
  anonymisation: "Anonymisations",
  export: "Exports",
  suppression: "Suppressions",
  preavis: "Préavis",
  acces: "Accès",
};

// Libellé lisible + famille (pictogramme, teinte) — port du legacy _rgpdActionLabel,
// complété des actions Next.
const ACTION_META: Record<string, { label: string; family: Family }> = {
  anonymize: { label: "Anonymisation", family: "anonymisation" },
  export: { label: "Export des données (art. 15)", family: "export" },
  export_json: { label: "Export des données (art. 15)", family: "export" },
  export_pdf: { label: "Export imprimable", family: "export" },
  self_delete_requested: { label: "Demande de suppression par l'usager", family: "suppression" },
  self_delete: { label: "Suppression par l'usager", family: "suppression" },
  notice_sent: { label: "Préavis d'inactivité envoyé", family: "preavis" },
  deletion_notice: { label: "Préavis d'inactivité envoyé", family: "preavis" },
  password_reset: { label: "Mot de passe réinitialisé", family: "acces" },
  password_reset_admin_trigger: { label: "Lien de réinitialisation envoyé", family: "acces" },
  hard_delete: { label: "Suppression définitive d'un compte vide", family: "suppression" },
};

function actionMeta(a: string): { label: string; family: Family } {
  return ACTION_META[a] ?? { label: a, family: "acces" };
}

function FamilyIcon({ family }: { family: Family }) {
  const cls =
    family === "suppression"
      ? "is-danger"
      : family === "anonymisation" || family === "preavis"
        ? "is-warn"
        : family === "export"
          ? "is-info"
          : "is-neutral";
  return (
    <span className={`rg-ico ${cls}`}>
      {family === "suppression" && <TrashGlyph size={14} />}
      {family === "anonymisation" && <UserOffGlyph size={14} />}
      {family === "preavis" && <MailGlyph size={14} />}
      {family === "export" && <DownloadGlyph size={14} />}
      {family === "acces" && <KeyGlyph size={14} />}
    </span>
  );
}

/** Cible : nom si connu, sinon identifiant technique en chasse fixe. */
function Target({ party }: { party: AuditParty }) {
  if (!party) return null;
  const label = party.name || party.email;
  if (!label) return <span className="rg-mono">#{party.id}</span>;
  return (
    <span style={{ color: "var(--muted)" }}>
      · {label}
      {party.anonymized && <span style={{ fontSize: ".66rem" }}> (anonymisé)</span>}
    </span>
  );
}

/** Acteur : personne (avatar) ou automate (tâche planifiée / auto-service). */
function Actor({ party, action }: { party: AuditParty; action: string }) {
  if (party?.name || party?.email) {
    const [nom, ...rest] = (party.name || "").split(" ");
    return (
      <div className="acct-who">
        <Avatar prenom={rest.join(" ")} nom={nom} email={party.email} role="administrateur" />
        <div style={{ minWidth: 0 }}>
          <div className="name" style={{ fontWeight: 500 }}>
            {party.name || party.email}
          </div>
          {party.name && party.email && <div className="mail">{party.email}</div>}
        </div>
      </div>
    );
  }
  const self = action.startsWith("self_") || action.startsWith("password_reset");
  return (
    <div className="acct-who">
      <span className="rg-ico is-neutral">
        <ClockGlyph size={14} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div className="name" style={{ fontWeight: 500 }}>
          {self ? "L'usager lui-même" : "Tâche planifiée"}
        </div>
        <div className="mail">{self ? "auto-service" : "rétention RGPD"}</div>
      </div>
    </div>
  );
}

const DAY_FMT = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
});
const TIME_FMT = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

function dayLabel(iso: string, todayYmd: string, yesterdayYmd: string): string {
  const d = new Date(iso);
  const ymd = d.toISOString().slice(0, 10);
  const long = DAY_FMT.format(d);
  const cap = long.charAt(0).toUpperCase() + long.slice(1);
  if (ymd === todayYmd) return `Aujourd'hui · ${cap}`;
  if (ymd === yesterdayYmd) return `Hier · ${cap}`;
  return `${cap}${d.getFullYear() !== new Date(todayYmd).getFullYear() ? ` ${d.getFullYear()}` : ""}`;
}

export function AuditLog({ entries, generatedAt }: { entries: AuditEntry[]; generatedAt: string }) {
  const router = useRouter();
  const [page, setPage] = useState(0);
  const [family, setFamily] = useState<Family | "all">("all");
  const [pending, startTransition] = useTransition();

  const counts = useMemo(() => {
    const c: Record<Family, number> = {
      anonymisation: 0,
      export: 0,
      suppression: 0,
      preavis: 0,
      acces: 0,
    };
    for (const e of entries) c[actionMeta(e.action).family]++;
    return c;
  }, [entries]);

  const filtered = useMemo(
    () =>
      family === "all" ? entries : entries.filter((e) => actionMeta(e.action).family === family),
    [entries, family],
  );
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, totalPages - 1);
  const from = current * PAGE_SIZE;
  const pageRows = filtered.slice(from, from + PAGE_SIZE);

  const todayYmd = generatedAt.slice(0, 10);
  const yesterdayYmd = new Date(new Date(generatedAt).getTime() - 86_400_000)
    .toISOString()
    .slice(0, 10);

  function refresh() {
    startTransition(() => router.refresh());
  }

  function exportCsv() {
    const header = ["Date", "Action", "Cible", "Email cible", "Acteur", "Email acteur", "IP"];
    const lines = entries.map((e) =>
      [
        e.dateLabel,
        actionMeta(e.action).label,
        e.target?.name || e.target?.email || (e.target ? `#${e.target.id}` : ""),
        e.target?.email ?? "",
        e.actor?.name || e.actor?.email || (e.actor ? `#${e.actor.id}` : ""),
        e.actor?.email ?? "",
        e.ip ?? "",
      ]
        .map(csvCell)
        .join(";"),
    );
    // En-tête échappé comme les données ; séparateur « ; » + BOM (cohérent avec lib/csv).
    const csv = `﻿${[header.map(csvCell).join(";"), ...lines].join("\r\n")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rgpd-audit.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const headBtn = {
    padding: ".25rem .65rem",
    fontSize: ".68rem",
    display: "inline-flex",
    alignItems: "center",
    gap: ".35rem",
  } as const;

  let lastDay = "";

  return (
    <div className="panel" style={{ marginTop: "1rem" }}>
      <div
        className="panel-title"
        style={{ justifyContent: "space-between", gap: ".75rem", marginBottom: ".5rem" }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
          <span className="rg-ico is-neutral">
            <HistoryGlyph size={16} />
          </span>
          Journal d&apos;audit RGPD
          <span style={{ color: "var(--muted)", fontWeight: 400 }}>· {entries.length}</span>
        </span>
        <span style={{ display: "inline-flex", gap: ".5rem" }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={refresh}
            disabled={pending}
            style={headBtn}
          >
            <RefreshGlyph size={13} /> Rafraîchir
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={exportCsv}
            disabled={entries.length === 0}
            style={headBtn}
          >
            <DownloadGlyph size={13} /> CSV
          </button>
        </span>
      </div>

      <div className="acct-toolbar" style={{ marginBottom: ".2rem" }}>
        <button
          type="button"
          className={`acct-chip${family === "all" ? " is-on" : ""}`}
          aria-pressed={family === "all"}
          onClick={() => {
            setFamily("all");
            setPage(0);
          }}
        >
          Tout<span className="n">{entries.length}</span>
        </button>
        {(Object.keys(FAMILY_LABEL) as Family[])
          .filter((f) => counts[f] > 0)
          .map((f) => (
            <button
              key={f}
              type="button"
              className={`acct-chip${family === f ? " is-on" : ""}`}
              aria-pressed={family === f}
              onClick={() => {
                setFamily(f);
                setPage(0);
              }}
            >
              {FAMILY_LABEL[f]}
              <span className="n">{counts[f]}</span>
            </button>
          ))}
      </div>

      {total === 0 ? (
        <p style={{ fontSize: ".8rem", color: "var(--muted)", margin: ".8rem 0 0" }}>
          Aucune action RGPD journalisée pour le moment.
        </p>
      ) : (
        <div className="rg-tl">
          {pageRows.map((e) => {
            const day = dayLabel(e.at, todayYmd, yesterdayYmd);
            const showDay = day !== lastDay;
            lastDay = day;
            const meta = actionMeta(e.action);
            return (
              <div key={e.id}>
                {showDay && <div className="rg-day">{day}</div>}
                <div className="rg-ev">
                  <span style={{ color: "var(--muted)", fontSize: ".72rem" }}>
                    {TIME_FMT.format(new Date(e.at))}
                  </span>
                  <FamilyIcon family={meta.family} />
                  <div
                    style={{
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {meta.label} <Target party={e.target} />
                  </div>
                  <Actor party={e.actor} action={e.action} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="rg-foot">
        <span>
          {total === 0
            ? "Journal immuable, sans donnée nominative"
            : `${from + 1}–${from + pageRows.length} sur ${total} · journal immuable, sans donnée nominative`}
        </span>
        <span
          style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: ".4rem" }}
        >
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
      </div>
    </div>
  );
}
