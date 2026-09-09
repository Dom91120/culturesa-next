"use client";

import { useEffect, useState, useTransition } from "react";
import {
  AlertGlyph,
  BugGlyph,
  CalendarTimeGlyph,
  CircleCheckGlyph,
  InfoGlyph,
  LinkGlyph,
  MapPinGlyph,
  RefreshGlyph,
  SettingsGlyph,
} from "@/components/ui-glyphs";
import type { ActionState } from "@/lib/action-state";
import { DATETIME_FMT_FR as dtFmt, relativeLabel } from "@/lib/format";
import { MailOffGlyph, UsersGlyph } from "../users/account-ui";
import {
  refreshSchoolHolidaysAction,
  setAgendaRefreshAction,
  setAppUrlAction,
  setDebugModeAction,
  setReservationsRefreshAction,
  setSchoolZoneAction,
} from "./actions";

// ════════════════════════════════════════════════════════════════════════════
//  Configuration — refonte Dom 2026-09-09 : une ligne par réglage (pictogramme,
//  libellé, description en une phrase, contrôle à droite), groupes nommés, zone en
//  sélecteur segmenté, calendrier des vacances avec date du dernier import, adresse
//  publique avec pastille « IP locale », mode debug en interrupteur, pastille
//  « enregistré » dans l'en-tête. Chaque réglage s'enregistre dès qu'il change.
// ════════════════════════════════════════════════════════════════════════════

type Props = {
  zone: string;
  holidayCount: number;
  holidaysImportedAt: string | null; // ISO
  refreshSeconds: number;
  agendaRefreshSeconds: number;
  debugMode: boolean;
  appUrl: string;
};

// Choix proposés pour l'auto-rafraîchissement (en secondes).
const REFRESH_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Désactivé" },
  { value: 15, label: "15 secondes" },
  { value: 30, label: "30 secondes" },
  { value: 60, label: "1 minute" },
  { value: 120, label: "2 minutes" },
  { value: 300, label: "5 minutes" },
];

/**
 * Adresse « locale » : IP privée, localhost ou nom en .local. Elle part telle quelle dans
 * les e-mails (lien « Portail CultuRésa ») et ne sera pas joignable de l'extérieur.
 */
function isLocalUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return (
      h === "localhost" ||
      h.endsWith(".local") ||
      /^127\./.test(h) ||
      /^10\./.test(h) ||
      /^192\.168\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
      h === "::1"
    );
  } catch {
    return false;
  }
}

export function ConfigurationPanel({
  zone: initialZone,
  holidayCount,
  holidaysImportedAt,
  refreshSeconds: initialRefresh,
  agendaRefreshSeconds: initialAgendaRefresh,
  debugMode: initialDebug,
  appUrl: initialAppUrl,
}: Props) {
  const [zone, setZone] = useState(initialZone === "B" || initialZone === "C" ? initialZone : "A");
  const [count, setCount] = useState(holidayCount);
  const [importedAt, setImportedAt] = useState(holidaysImportedAt);
  const [refreshSeconds, setRefreshSeconds] = useState(initialRefresh);
  const [agendaRefresh, setAgendaRefresh] = useState(initialAgendaRefresh);
  const [appUrl, setAppUrl] = useState(initialAppUrl);
  const [savedUrl, setSavedUrl] = useState(initialAppUrl.trim());
  const [pending, startTransition] = useTransition();
  // Message d'état de l'en-tête : « enregistré » après chaque sauvegarde, ou une erreur.
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  // Résultat du dernier import de vacances (sur la ligne du calendrier).
  const [info, setInfo] = useState<{ ok: boolean; text: string } | null>(null);

  function done(res: ActionState | null | undefined, ok = "enregistré") {
    setStatus(
      res?.ok === false ? { ok: false, text: res.error ?? "échec" } : { ok: true, text: ok },
    );
  }

  // URL de l'application (lien « Portail CultuRésa » des e-mails) — enregistrée à la
  // perte de focus.
  function saveAppUrl() {
    const v = appUrl.trim();
    if (v === savedUrl) return;
    startTransition(async () => {
      const res = await setAppUrlAction(v);
      if (res?.ok) setSavedUrl(v.replace(/\/$/, ""));
      done(res);
    });
  }

  function onRefreshChange(value: number) {
    setRefreshSeconds(value);
    startTransition(async () => done(await setReservationsRefreshAction(value)));
  }

  function onAgendaRefreshChange(value: number) {
    setAgendaRefresh(value);
    startTransition(async () => done(await setAgendaRefreshAction(value)));
  }

  // Mode debug : source de vérité SERVEUR (app_config `debug.mode`, lu côté serveur).
  // On garde en plus localStorage + classe body pour le style debug legacy côté client.
  const [debug, setDebug] = useState(initialDebug);
  useEffect(() => {
    // Synchronise le client (localStorage/body) sur la valeur serveur au chargement.
    localStorage.setItem("rc_debug", initialDebug ? "1" : "0");
    document.body.classList.toggle("debug-mode", initialDebug);
  }, [initialDebug]);

  function onZoneChange(z: string) {
    setZone(z);
    setInfo(null);
    startTransition(async () => done(await setSchoolZoneAction(z)));
  }

  function refresh() {
    setInfo({ ok: true, text: "Chargement…" });
    startTransition(async () => {
      const res = await refreshSchoolHolidaysAction(zone);
      if (res?.ok) {
        if (typeof res.count === "number") setCount(res.count);
        setImportedAt(new Date().toISOString());
        setInfo({ ok: true, text: `${res.imported ?? 0} période(s) importée(s)` });
      } else {
        setInfo({ ok: false, text: res?.error ?? "Échec du rafraîchissement" });
      }
    });
  }

  function onDebugChange(on: boolean) {
    setDebug(on);
    // Client (style debug legacy) + serveur (source de vérité lue par les écrans).
    localStorage.setItem("rc_debug", on ? "1" : "0");
    document.body.classList.toggle("debug-mode", on);
    startTransition(async () =>
      done(await setDebugModeAction(on), on ? "debug activé" : "enregistré"),
    );
  }

  const localUrl = isLocalUrl(savedUrl);
  const nowMs = Date.now();

  return (
    <div className="panel">
      <div
        className="panel-title"
        style={{ justifyContent: "space-between", gap: ".75rem", marginBottom: ".5rem" }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
          <span className="rg-ico is-warn">
            <SettingsGlyph size={16} />
          </span>
          Configuration
        </span>
        {status && (
          <span className={`ms-pill ${status.ok ? "is-ok" : "is-warn"}`} role="status">
            {status.ok ? <CircleCheckGlyph size={11} /> : <AlertGlyph size={11} />}
            {status.text}
          </span>
        )}
      </div>

      <div className="ms-grp">Vacances scolaires</div>
      <div className="cf-row">
        <span className="rg-ico is-info">
          <MapPinGlyph size={14} />
        </span>
        <div>
          <div className="cf-nm">Zone académique</div>
          <div className="cf-ds">
            Commande les jours de vacances de l&apos;agenda et des ouvertures des services.
          </div>
        </div>
        <div className="cf-ctl">
          {/* biome-ignore lint/a11y/useSemanticElements: groupe de boutons à état pressé (sélecteur segmenté) */}
          <span className="ms-seg" role="group" aria-label="Zone académique">
            {(["A", "B", "C"] as const).map((z) => (
              <button
                key={z}
                type="button"
                className={`acct-chip${zone === z ? " is-on" : ""}`}
                aria-pressed={zone === z}
                disabled={pending}
                onClick={() => onZoneChange(z)}
              >
                {z}
              </button>
            ))}
          </span>
        </div>
      </div>
      <div className="cf-row">
        <span className="rg-ico is-info">
          <CalendarTimeGlyph size={14} />
        </span>
        <div>
          <div className="cf-nm">Calendrier des vacances</div>
          <div className="cf-ds">
            {count} période{count > 1 ? "s" : ""} en base pour la zone {zone}
            {importedAt
              ? ` · importées ${relativeLabel(importedAt, nowMs)} (${dtFmt.format(new Date(importedAt))})`
              : " · date du dernier import inconnue"}{" "}
            depuis data.education.gouv.fr
          </div>
        </div>
        <div className="cf-ctl">
          {info && (
            <span
              style={{
                fontSize: ".7rem",
                color: info.ok ? "var(--accent)" : "var(--danger)",
                display: "inline-flex",
                alignItems: "center",
                gap: ".3rem",
              }}
            >
              {info.ok ? <CircleCheckGlyph size={12} /> : <MailOffGlyph size={12} />}
              {info.text}
            </span>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={refresh}
            disabled={pending}
            title="Rafraîchir depuis data.education.gouv.fr"
            style={{
              padding: ".25rem .65rem",
              fontSize: ".68rem",
              display: "inline-flex",
              alignItems: "center",
              gap: ".35rem",
              borderColor: "color-mix(in srgb, var(--accent) 40%, transparent)",
              color: "var(--accent)",
            }}
          >
            <RefreshGlyph size={12} /> Mettre à jour
          </button>
        </div>
      </div>

      <div className="ms-grp">Application</div>
      <div className="cf-row">
        <span className="rg-ico is-neutral">
          <LinkGlyph size={14} />
        </span>
        <div>
          <div className="cf-nm">Adresse publique</div>
          <div className="cf-ds">
            Lien « Portail CultuRésa » des e-mails. Vide : aucun lien dans les e-mails.
          </div>
        </div>
        <div className="cf-ctl">
          <label className={`cf-url${localUrl ? " has-pill" : ""}`} htmlFor="cf-app-url">
            <input
              id="cf-app-url"
              type="url"
              value={appUrl}
              placeholder="https://culturesa.exemple.fr"
              onChange={(e) => setAppUrl(e.target.value)}
              onBlur={saveAppUrl}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              disabled={pending}
              aria-label="Adresse publique de l'application"
            />
            {localUrl && (
              <span
                className="ms-pill is-warn"
                title="Adresse privée : les liens des e-mails ne seront pas joignables hors du réseau local"
              >
                <AlertGlyph size={11} /> IP locale
              </span>
            )}
          </label>
        </div>
      </div>

      <div className="ms-grp">Rafraîchissement automatique</div>
      <div className="cf-row">
        <span className="rg-ico is-ok">
          <UsersGlyph size={14} />
        </span>
        <div>
          <div className="cf-nm">Réservations, côté usager</div>
          <div className="cf-ds">
            Fréquence de mise à jour de la disponibilité des créneaux affichés.
          </div>
        </div>
        <div className="cf-ctl">
          <select
            aria-label="Rafraîchissement des réservations"
            value={refreshSeconds}
            onChange={(e) => onRefreshChange(Number(e.target.value))}
            disabled={pending}
          >
            {REFRESH_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="cf-row">
        <span className="rg-ico is-warn">
          <UsersGlyph size={14} />
        </span>
        <div>
          <div className="cf-nm">Agenda, côté gestionnaire</div>
          <div className="cf-ds">
            Fréquence de mise à jour de l&apos;agenda ouvert sur un poste.
          </div>
        </div>
        <div className="cf-ctl">
          <select
            aria-label="Rafraîchissement de l'agenda"
            value={agendaRefresh}
            onChange={(e) => onAgendaRefreshChange(Number(e.target.value))}
            disabled={pending}
          >
            {REFRESH_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="ms-grp">Avancé</div>
      <div className="cf-row">
        <span className={`rg-ico ${debug ? "is-danger" : "is-neutral"}`}>
          <BugGlyph size={14} />
        </span>
        <div>
          <div className="cf-nm">Mode debug</div>
          <div className="cf-ds">
            Affiche les identifiants techniques et les repères de mise en page. À couper en
            exploitation.
          </div>
        </div>
        <div className="cf-ctl">
          <button
            type="button"
            role="switch"
            aria-checked={debug}
            aria-label="Mode debug"
            className={`ex-sw${debug ? " is-on" : ""}`}
            disabled={pending}
            onClick={() => onDebugChange(!debug)}
          />
        </div>
      </div>

      <div className="rg-foot">
        <InfoGlyph size={13} />
        <span style={{ flex: 1, lineHeight: 1.45 }}>
          Chaque réglage s&apos;enregistre dès qu&apos;il change. Les origines de confiance
          (adresses autorisées à ouvrir une session) se règlent côté serveur, dans le fichier
          d&apos;environnement, pas ici.
        </span>
      </div>
    </div>
  );
}
