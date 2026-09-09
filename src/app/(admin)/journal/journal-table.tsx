"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  ArrowRightGlyph,
  DatabaseExportGlyph,
  HistoryGlyph,
  MailGlyph,
  RefreshGlyph,
  RestoreGlyph,
  ShieldLockGlyph,
  UploadGlyph,
} from "@/components/ui-glyphs";
import { csvCell } from "@/lib/csv";
import { dayLabel, TIME_FMT } from "../rgpd/audit-log";
import {
  Avatar,
  BuildingGlyph,
  DownloadGlyph,
  KeyGlyph,
  LogoutGlyph,
  PencilGlyph,
  TrashGlyph,
  UsersGlyph,
} from "../users/account-ui";

// ════════════════════════════════════════════════════════════════════════════
//  Journal des actions privilégiées — refonte Dom 2026-09-09, dans la famille du
//  journal d'audit RGPD : frise chronologique par jour (heure, pictogramme teinté
//  par nature d'action, libellé + détail, acteur avec avatar, adresse IP), filtres
//  par famille avec effectifs, recherche libre, export CSV.
//  L'adresse IP reste à l'écran (choix Dom : c'est un journal d'exploitation, on
//  cherche d'où vient un acte), contrairement au journal RGPD.
// ════════════════════════════════════════════════════════════════════════════

/** Entrée sérialisée pour le client (date déjà formatée côté serveur). */
export type JournalEntry = {
  id: number;
  at: string; // ISO
  dateLabel: string;
  action: string;
  actorLabel: string;
  actorRole: string;
  /** Prénom / nom de l'acteur si son compte existe encore (avatar, libellé). */
  actorPrenom: string;
  actorNom: string;
  target: string | null;
  /** Résumé lisible des détails (tooltip, CSV). */
  details: string | null;
  /** Détails « avant → après » quand ils existent (rôle, affiliation). */
  change: { avant: string; apres: string } | null;
  ip: string | null;
};

const PAGE_SIZE = 25;

type Family = "comptes" | "acces" | "affiliations" | "sauvegardes" | "configuration" | "services";
const FAMILY_LABEL: Record<Family, string> = {
  comptes: "Comptes",
  acces: "Accès",
  affiliations: "Affiliations",
  sauvegardes: "Sauvegardes",
  configuration: "Configuration",
  services: "Services",
};

type Tone = "neutral" | "ok" | "info" | "warn" | "danger";

// Libellés lisibles, famille (filtre) et teinte (pictogramme). Une action inconnue
// (ancienne entrée, ou clé ajoutée depuis) s'affiche telle quelle plutôt que de
// disparaître : un journal ne doit jamais masquer ce qu'il ne sait pas nommer.
const ACTION_META: Record<string, { label: string; family: Family; tone: Tone }> = {
  "user.created": { label: "Compte créé", family: "comptes", tone: "ok" },
  "user.updated": { label: "Compte modifié", family: "comptes", tone: "ok" },
  "user.deleted": { label: "Compte supprimé", family: "comptes", tone: "danger" },
  "user.password_reset_sent": {
    label: "Lien de mot de passe envoyé",
    family: "comptes",
    tone: "ok",
  },
  "user.role_changed": { label: "Changement de rôle", family: "acces", tone: "warn" },
  "user.two_factor_reset": {
    label: "Double authentification réinitialisée",
    family: "acces",
    tone: "warn",
  },
  "user.sessions_revoked": { label: "Déconnexion forcée", family: "acces", tone: "warn" },
  "user.affiliation_changed": {
    label: "Catégorie / structure changée par l'usager",
    family: "affiliations",
    tone: "neutral",
  },
  "backup.created": { label: "Sauvegarde créée", family: "sauvegardes", tone: "info" },
  "backup.restored": { label: "Base restaurée", family: "sauvegardes", tone: "danger" },
  "backup.deleted": { label: "Sauvegarde supprimée", family: "sauvegardes", tone: "danger" },
  "backup.downloaded": { label: "Sauvegarde téléchargée", family: "sauvegardes", tone: "info" },
  "backup.uploaded": { label: "Sauvegarde téléversée", family: "sauvegardes", tone: "info" },
  "config.mail_changed": {
    label: "Configuration SMTP modifiée",
    family: "configuration",
    tone: "warn",
  },
  "service.deleted": { label: "Service supprimé", family: "services", tone: "danger" },
};

/** Actions dont la portée justifie une mise en évidence (libellé en gras). */
const CRITIQUES = new Set([
  "user.role_changed",
  "user.two_factor_reset",
  "user.sessions_revoked",
  "backup.restored",
  "service.deleted",
]);

function actionMeta(a: string): { label: string; family: Family; tone: Tone } {
  return ACTION_META[a] ?? { label: a, family: "configuration", tone: "neutral" };
}

const TONE_CLASS: Record<Tone, string> = {
  danger: "is-danger",
  warn: "is-warn",
  info: "is-info",
  ok: "is-ok",
  neutral: "is-neutral",
};

function ActionIcon({ action }: { action: string }) {
  const { tone } = actionMeta(action);
  const size = 14;
  let glyph: React.ReactNode;
  switch (action) {
    case "user.created":
      glyph = <UsersGlyph size={size} />;
      break;
    case "user.updated":
      glyph = <PencilGlyph size={size} />;
      break;
    case "user.password_reset_sent":
    case "config.mail_changed":
      glyph = <MailGlyph size={size} />;
      break;
    case "user.role_changed":
      glyph = <KeyGlyph size={size} />;
      break;
    case "user.two_factor_reset":
      glyph = <ShieldLockGlyph size={size} />;
      break;
    case "user.sessions_revoked":
      glyph = <LogoutGlyph size={size} />;
      break;
    case "user.affiliation_changed":
      glyph = <BuildingGlyph size={size} />;
      break;
    case "backup.created":
      glyph = <DatabaseExportGlyph size={size} />;
      break;
    case "backup.restored":
      glyph = <RestoreGlyph size={size} />;
      break;
    case "backup.downloaded":
      glyph = <DownloadGlyph size={size} />;
      break;
    case "backup.uploaded":
      glyph = <UploadGlyph size={size} />;
      break;
    case "user.deleted":
    case "backup.deleted":
    case "service.deleted":
      glyph = <TrashGlyph size={size} />;
      break;
    default:
      glyph = <HistoryGlyph size={size} />;
  }
  return <span className={`rg-ico ${TONE_CLASS[tone]}`}>{glyph}</span>;
}

/** Acteur : avatar teinté par rôle, nom ou adresse, rôle (« lui-même » quand il agit sur son compte). */
function Actor({ e }: { e: JournalEntry }) {
  const role =
    e.actorRole === "administrateur" || e.actorRole === "gestionnaire"
      ? e.actorRole
      : "utilisateur";
  const self = e.target !== null && e.target === e.actorLabel && role === "utilisateur";
  const name = `${e.actorPrenom} ${e.actorNom}`.trim();
  return (
    <div className="acct-who">
      <Avatar prenom={e.actorPrenom} nom={e.actorNom} email={e.actorLabel} role={role} />
      <div style={{ minWidth: 0 }}>
        <div className="name" style={{ fontWeight: 500 }} title={e.actorLabel}>
          {name || e.actorLabel}
        </div>
        <div className="mail">
          {name ? `${e.actorLabel} · ` : ""}
          {e.actorRole || "système"}
          {self ? " · lui-même" : ""}
        </div>
      </div>
    </div>
  );
}

/** Sous-ligne : « avant → après » pour un changement, sinon la cible (chasse fixe pour les fichiers). */
function Detail({ e }: { e: JournalEntry }) {
  if (e.change) {
    return (
      <div className="jr-sub">
        {e.change.avant}
        <ArrowRightGlyph size={11} />
        {e.change.apres}
      </div>
    );
  }
  if (!e.target) return null;
  const isFile = /\.(sql|gz|enc)(\.|$)/.test(e.target);
  return <div className={`jr-sub${isFile ? " rg-mono" : ""}`}>{e.target}</div>;
}

export function JournalTable({
  entries,
  generatedAt,
  maxEntries,
}: {
  entries: JournalEntry[];
  generatedAt: string;
  maxEntries: number;
}) {
  const router = useRouter();
  const [filtre, setFiltre] = useState("");
  const [family, setFamily] = useState<Family | "all">("all");
  const [page, setPage] = useState(0);
  const [pending, startTransition] = useTransition();

  const counts = useMemo(() => {
    const c: Record<Family, number> = {
      comptes: 0,
      acces: 0,
      affiliations: 0,
      sauvegardes: 0,
      configuration: 0,
      services: 0,
    };
    for (const e of entries) c[actionMeta(e.action).family]++;
    return c;
  }, [entries]);

  const filtrees = useMemo(() => {
    const q = filtre.trim().toLowerCase();
    return entries.filter((e) => {
      if (family !== "all" && actionMeta(e.action).family !== family) return false;
      if (!q) return true;
      return [
        e.action,
        actionMeta(e.action).label,
        e.actorLabel,
        `${e.actorPrenom} ${e.actorNom}`,
        e.target ?? "",
        e.details ?? "",
        e.ip ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [entries, filtre, family]);

  const total = filtrees.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const courante = Math.min(page, pages - 1);
  const from = courante * PAGE_SIZE;
  const visibles = filtrees.slice(from, from + PAGE_SIZE);

  const todayYmd = generatedAt.slice(0, 10);
  const yesterdayYmd = new Date(new Date(generatedAt).getTime() - 86_400_000)
    .toISOString()
    .slice(0, 10);

  function refresh() {
    startTransition(() => router.refresh());
  }

  function exporter() {
    const lignes = [
      ["Date", "Action", "Acteur", "Rôle", "Cible", "Détails", "IP"],
      ...filtrees.map((e) => [
        e.dateLabel,
        actionMeta(e.action).label,
        e.actorLabel,
        e.actorRole,
        e.target ?? "",
        e.details ?? "",
        e.ip ?? "",
      ]),
    ];
    const body = lignes.map((c) => c.map(csvCell).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([`﻿${body}`], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "journal-audit.csv";
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
    <div className="panel">
      <div
        className="panel-title"
        style={{ justifyContent: "space-between", gap: ".75rem", marginBottom: ".5rem" }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
          <span className="rg-ico is-neutral">
            <HistoryGlyph size={16} />
          </span>
          Journal des actions privilégiées
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
            onClick={exporter}
            disabled={filtrees.length === 0}
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
        <div className="acct-toolbar-right">
          <div className="search-wrap">
            {/* biome-ignore lint/a11y/noSvgWithoutTitle: icône décorative (même loupe que les autres listes) */}
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
              type="search"
              aria-label="Filtrer le journal"
              placeholder="Acteur, cible, détail, IP…"
              value={filtre}
              onChange={(e) => {
                setFiltre(e.target.value);
                setPage(0);
              }}
            />
          </div>
        </div>
      </div>

      {entries.length === 0 ? (
        <p
          style={{ fontSize: ".8rem", color: "var(--muted)", lineHeight: 1.6, margin: ".8rem 0 0" }}
        >
          Aucune action privilégiée enregistrée pour l&apos;instant. Le journal se remplit lors des
          changements de rôle, des opérations sur les sauvegardes, des modifications de la
          configuration SMTP et des suppressions de service.
        </p>
      ) : total === 0 ? (
        <p style={{ fontSize: ".8rem", color: "var(--muted)", margin: ".8rem 0 0" }}>
          Aucune entrée ne correspond à ce filtre.
        </p>
      ) : (
        <div className="rg-tl">
          {visibles.map((e) => {
            const day = dayLabel(e.at, todayYmd, yesterdayYmd);
            const showDay = day !== lastDay;
            lastDay = day;
            const meta = actionMeta(e.action);
            return (
              <div key={e.id}>
                {showDay && <div className="rg-day">{day}</div>}
                <div className="rg-ev jr-ev">
                  <span style={{ color: "var(--muted)", fontSize: ".72rem" }}>
                    {TIME_FMT.format(new Date(e.at))}
                  </span>
                  <ActionIcon action={e.action} />
                  <div style={{ minWidth: 0 }}>
                    <div
                      className="jr-lbl"
                      style={{ fontWeight: CRITIQUES.has(e.action) ? 700 : 500 }}
                      title={e.details ?? undefined}
                    >
                      {meta.label}
                      {e.details && !e.change && (
                        <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                          {" "}
                          · {e.details}
                        </span>
                      )}
                    </div>
                    <Detail e={e} />
                  </div>
                  <Actor e={e} />
                  <span className="rg-mono" title="Adresse IP vue par le serveur">
                    {e.ip ?? "—"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="rg-foot">
        <span>
          {total > 0 && `${from + 1}–${from + visibles.length} sur ${total} · `}
          {`${maxEntries.toLocaleString("fr-FR")} entrées au plus, conservées deux ans · droits des personnes dans l'onglet RGPD`}
        </span>
        <span
          style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: ".4rem" }}
        >
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: ".1rem .45rem", fontSize: ".72rem" }}
            disabled={courante === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            ‹
          </button>
          {courante + 1} / {pages}
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: ".1rem .45rem", fontSize: ".72rem" }}
            disabled={courante >= pages - 1}
            onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
          >
            ›
          </button>
        </span>
      </div>
    </div>
  );
}
