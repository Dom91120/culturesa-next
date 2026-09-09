"use client";

import { useMemo, useState, useTransition } from "react";
import { ConfirmPasswordModal } from "@/components/confirm-password-modal";
import {
  CircleCheckGlyph,
  LockGlyph,
  MailGlyph,
  SaveGlyph,
  ServerGlyph,
  SettingsGlyph,
} from "@/components/ui-glyphs";
import { DATETIME_FMT_FR as dtFmt, relativeLabel } from "@/lib/format";
import { MailOffGlyph, SendGlyph } from "../users/account-ui";
import { type MailConfigInput, saveMailConfigAction, sendTestMailAction } from "./actions";

// ════════════════════════════════════════════════════════════════════════════
//  Messagerie — refonte Dom 2026-09-09, famille graphique des Exports / RGPD :
//  tuiles d'état (relais, expéditeur tel que vu par le destinataire, dernier test
//  mémorisé, e-mails en échec), mode d'envoi en sélecteur segmenté dans l'en-tête,
//  formulaire en trois groupes (Expéditeur / Relais SMTP / Vérifier l'envoi),
//  pastille « modifié », mot de passe « conservé » quand il existe en base.
// ════════════════════════════════════════════════════════════════════════════

type Driver = "smtp" | "mail" | "sendmail";
type Security = "" | "tls" | "ssl";

export type MailConfig = {
  driver: string;
  from: string;
  fromName: string;
  host: string;
  port: string;
  security: string;
  username: string;
  /** Un mot de passe SMTP existe en base (jamais renvoyé, seulement sa présence). */
  hasPassword: boolean;
};

/** Résultat du dernier e-mail de test, mémorisé en configuration par l'action. */
export type LastTest = { at: string; to: string; ok: boolean; error: string; ms: number };

const DRIVER_LABEL: Record<Driver, string> = {
  smtp: "SMTP",
  mail: "mail système",
  sendmail: "Sendmail",
};
const SECURITY_LABEL: Record<Security, string> = {
  "": "sans chiffrement",
  tls: "STARTTLS",
  ssl: "SSL/TLS",
};

const reqStar = <span className="required-star"> *</span>;

function asDriver(v: string): Driver {
  return v === "mail" || v === "sendmail" ? v : "smtp";
}
function asSecurity(v: string): Security {
  return v === "tls" || v === "ssl" ? v : "";
}

export function MessagingConfig({
  config,
  lastTest,
  failedCount,
  oldestFailedAt,
  nowMs,
}: {
  config: MailConfig;
  lastTest: LastTest | null;
  failedCount: number;
  oldestFailedAt: string | null;
  nowMs: number;
}) {
  const [driver, setDriver] = useState<Driver>(asDriver(config.driver));
  const [from, setFrom] = useState(config.from);
  const [fromName, setFromName] = useState(config.fromName);
  const [host, setHost] = useState(config.host);
  const [port, setPort] = useState(config.port || "587");
  const [security, setSecurity] = useState<Security>(asSecurity(config.security));
  const [username, setUsername] = useState(config.username);
  const [password, setPassword] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const [testTo, setTestTo] = useState(lastTest?.to ?? "");
  const [testPending, startTest] = useTransition();
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Confirmation par mot de passe de L'ADMINISTRATEUR avant d'écrire la config SMTP
  // (constat BAC3) — à ne pas confondre avec le mot de passe SMTP du formulaire.
  const [aConfirmer, setAConfirmer] = useState<MailConfigInput | null>(null);

  const smtpOn = driver === "smtp";

  // État « modifié » : on ne compare jamais le mot de passe (jamais ré-affiché),
  // mais le saisir compte comme modification.
  const initialSig = useMemo(
    () =>
      [
        asDriver(config.driver),
        config.from,
        config.fromName,
        config.host,
        config.port || "587",
        asSecurity(config.security),
        config.username,
      ].join("|"),
    [config],
  );
  const currentSig = [driver, from, fromName, host, port, security, username].join("|");
  const dirty = currentSig !== initialSig || password !== "";

  function touch() {
    setSaved(false);
    setError(null);
  }

  function save() {
    setError(null);
    if (smtpOn && (!host.trim() || !from.trim())) {
      setError("Serveur SMTP et adresse expéditeur sont requis.");
      return;
    }
    setAConfirmer({
      driver,
      from: from.trim(),
      fromName: fromName.trim(),
      host: host.trim(),
      port: port.trim(),
      security,
      username: username.trim(),
      password,
    });
  }

  function confirmer(motDePasseAdmin: string) {
    const payload = aConfirmer;
    if (!payload) return;
    setError(null);
    startTransition(async () => {
      const res = await saveMailConfigAction(payload, motDePasseAdmin);
      if (res && !res.ok) {
        setError(res.error ?? "Échec de l'enregistrement.");
        return;
      }
      setAConfirmer(null);
      // Après save, on ne ré-affiche jamais le mot de passe.
      setPassword("");
      setSaved(true);
    });
  }

  function runTest() {
    setTestMsg(null);
    const to = testTo.trim();
    if (!to) {
      setTestMsg({ ok: false, text: "Indiquez un destinataire." });
      return;
    }
    startTest(async () => {
      const res = await sendTestMailAction(to);
      setTestMsg(
        res?.ok
          ? { ok: true, text: "E-mail de test envoyé" }
          : { ok: false, text: res?.error ?? "Échec de l'envoi." },
      );
    });
  }

  // ── Tuiles d'état : ce qui est ENREGISTRÉ (pas le brouillon du formulaire) ──
  const savedDriver = asDriver(config.driver);
  const relayReady = savedDriver !== "smtp" || !!config.host;
  const relayTone = relayReady ? "is-ok" : "is-warn";
  const testTone = lastTest ? (lastTest.ok ? "is-info" : "is-danger") : "is-neutral";
  const failedTone = failedCount > 0 ? "is-danger" : "is-ok";

  const headBtn = {
    padding: ".25rem .65rem",
    fontSize: ".68rem",
    display: "inline-flex",
    alignItems: "center",
    gap: ".35rem",
  } as const;

  return (
    <>
      <div className="ms-tiles">
        <div className={`ms-tile ${relayTone}`}>
          <span className={`rg-ico ${relayTone}`}>
            <ServerGlyph size={15} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="l">Relais SMTP</div>
            {savedDriver !== "smtp" ? (
              <>
                <div className="v">{DRIVER_LABEL[savedDriver]}</div>
                <div className="s">envoi confié au système hôte</div>
              </>
            ) : config.host ? (
              <>
                <div className="v" title={config.host}>
                  {config.host}
                </div>
                <div className="s">
                  port {config.port || "587"} · {SECURITY_LABEL[asSecurity(config.security)]}
                  {config.username ? " · authentifié" : " · anonyme"}
                </div>
              </>
            ) : (
              <>
                <div className="v">non configuré</div>
                <div className="s">aucun e-mail ne peut partir</div>
              </>
            )}
          </div>
        </div>

        <div className="ms-tile">
          <span className="rg-ico is-neutral">
            <MailGlyph size={15} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="l">Expéditeur</div>
            <div className="v" title={config.from}>
              {config.fromName || config.from || "—"}
            </div>
            <div className="s">
              {config.fromName ? config.from || "adresse manquante" : "sans nom affiché"}
            </div>
          </div>
        </div>

        <div className={`ms-tile ${lastTest && !lastTest.ok ? "is-danger" : ""}`}>
          <span className={`rg-ico ${testTone}`}>
            <SendGlyph size={15} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="l">Dernier test</div>
            {lastTest ? (
              <>
                <div className="v" title={dtFmt.format(new Date(lastTest.at))}>
                  {relativeLabel(lastTest.at, nowMs)} · {lastTest.ok ? "réussi" : "échoué"}
                </div>
                <div className="s" title={lastTest.ok ? undefined : lastTest.error}>
                  vers {lastTest.to}
                  {lastTest.ok && lastTest.ms > 0 ? ` en ${(lastTest.ms / 1000).toFixed(1)} s` : ""}
                </div>
              </>
            ) : (
              <>
                <div className="v">aucun</div>
                <div className="s">envoyez un e-mail de test ci-dessous</div>
              </>
            )}
          </div>
        </div>

        <div className={`ms-tile ${failedCount > 0 ? "is-danger" : ""}`}>
          <span className={`rg-ico ${failedTone}`}>
            {failedCount > 0 ? <MailOffGlyph size={15} /> : <CircleCheckGlyph size={15} />}
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="l">En échec</div>
            <div className="v">
              {failedCount === 0 ? "aucun" : `${failedCount} e-mail${failedCount > 1 ? "s" : ""}`}
            </div>
            <div className="s">
              {failedCount > 0 && oldestFailedAt
                ? `le plus ancien ${relativeLabel(oldestFailedAt, nowMs)}`
                : "tous les envois ont abouti"}
            </div>
          </div>
        </div>
      </div>

      <div className="panel" id="mail-config-panel">
        {aConfirmer && (
          <ConfirmPasswordModal
            titre="⚙️ Modifier la configuration SMTP"
            libelleAction="Enregistrer"
            pending={pending}
            erreur={error}
            onCancel={() => setAConfirmer(null)}
            onConfirm={confirmer}
          >
            <p style={{ color: "var(--muted)", fontSize: ".8rem" }}>
              Le relais SMTP émet les courriels au nom de la Ville. En détourner la configuration
              permettrait d&apos;envoyer des messages authentiquement signés par elle, et
              d&apos;intercepter les liens de réinitialisation de mot de passe.
            </p>
          </ConfirmPasswordModal>
        )}

        <div
          className="panel-title"
          style={{ justifyContent: "space-between", gap: ".75rem", flexWrap: "wrap" }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
            <span className="rg-ico is-warn">
              <SettingsGlyph size={16} />
            </span>
            Configuration messagerie
            {dirty && <span className="ms-pill is-warn">modifié</span>}
            {saved && !dirty && (
              <span className="ms-pill is-ok">
                <CircleCheckGlyph size={11} /> enregistré
              </span>
            )}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: ".6rem" }}>
            {/* biome-ignore lint/a11y/useSemanticElements: groupe de boutons à état pressé (sélecteur segmenté) */}
            <span className="ms-seg" role="group" aria-label="Mode d'envoi">
              {(Object.keys(DRIVER_LABEL) as Driver[]).map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`acct-chip${driver === d ? " is-on" : ""}`}
                  aria-pressed={driver === d}
                  onClick={() => {
                    touch();
                    setDriver(d);
                  }}
                >
                  {DRIVER_LABEL[d]}
                </button>
              ))}
            </span>
            <button
              type="button"
              className={`btn ${dirty ? "btn-primary" : "btn-ghost"}`}
              onClick={save}
              disabled={pending}
              style={headBtn}
            >
              <SaveGlyph size={13} /> {pending ? "Enregistrement…" : "Enregistrer"}
            </button>
          </span>
        </div>

        <div className="ms-grp">Expéditeur</div>
        <div className="form-grid" style={{ marginBottom: 0 }}>
          <div className="field">
            <label htmlFor="mail-from">Adresse expéditeur{reqStar}</label>
            <input
              id="mail-from"
              type="email"
              value={from}
              placeholder="noreply@example.com"
              onChange={(e) => {
                touch();
                setFrom(e.target.value);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="mail-from-name">Nom expéditeur</label>
            <input
              id="mail-from-name"
              type="text"
              value={fromName}
              placeholder="CultuRésa"
              onChange={(e) => {
                touch();
                setFromName(e.target.value);
              }}
            />
            <span className="field-hint">
              Ce que voit le destinataire :{" "}
              {fromName.trim()
                ? `« ${fromName.trim()} <${from.trim() || "…"}> »`
                : `« ${from.trim() || "…"} »`}
            </span>
          </div>
        </div>

        <div className="ms-grp">Relais SMTP</div>
        {/* Champs SMTP : estompés et inertes quand l'envoi est confié au système. */}
        <div
          id="smtp-fields-wrap"
          className="form-grid"
          style={{
            marginBottom: 0,
            opacity: smtpOn ? 1 : 0.4,
            pointerEvents: smtpOn ? "auto" : "none",
          }}
        >
          <div className="field">
            <label htmlFor="mail-host">Serveur{reqStar}</label>
            <input
              id="mail-host"
              type="text"
              value={host}
              placeholder="smtp.example.com"
              disabled={!smtpOn}
              onChange={(e) => {
                touch();
                setHost(e.target.value);
              }}
            />
          </div>

          <div style={{ display: "flex", gap: ".75rem", alignItems: "flex-start", minWidth: 0 }}>
            <div className="field" style={{ flex: "0 0 92px", minWidth: 0 }}>
              <label htmlFor="mail-port">Port</label>
              <input
                id="mail-port"
                type="number"
                value={port}
                min={1}
                max={65535}
                disabled={!smtpOn}
                onChange={(e) => {
                  touch();
                  setPort(e.target.value);
                }}
              />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 0 }}>
              <label htmlFor="mail-security">Chiffrement</label>
              <select
                id="mail-security"
                value={security}
                disabled={!smtpOn}
                onChange={(e) => {
                  touch();
                  setSecurity(e.target.value as Security);
                }}
              >
                <option value="">Aucun</option>
                <option value="tls">STARTTLS</option>
                <option value="ssl">SSL/TLS</option>
              </select>
            </div>
          </div>

          <div className="field">
            <label htmlFor="mail-username">Identifiant</label>
            <input
              id="mail-username"
              type="text"
              value={username}
              placeholder="user@example.com"
              autoComplete="off"
              disabled={!smtpOn}
              onChange={(e) => {
                touch();
                setUsername(e.target.value);
              }}
            />
          </div>

          <div className="field">
            <label htmlFor="mail-password">Mot de passe</label>
            <div className="ms-pwd">
              <input
                id="mail-password"
                type="password"
                value={password}
                placeholder={config.hasPassword ? "••••••••" : "aucun"}
                autoComplete="new-password"
                disabled={!smtpOn}
                onChange={(e) => {
                  touch();
                  setPassword(e.target.value);
                }}
              />
              {config.hasPassword && password === "" && (
                <span className="ms-pill is-ok" title="Un mot de passe est enregistré, chiffré">
                  <LockGlyph size={11} /> conservé
                </span>
              )}
            </div>
            <span className="field-hint">
              {config.hasPassword
                ? "Laissez vide pour garder le mot de passe actuel. "
                : "Requis si le relais demande une authentification. "}
              L&apos;enregistrement demande votre mot de passe d&apos;administrateur.
            </span>
          </div>
        </div>

        {error && !aConfirmer && (
          <p className="field-error" style={{ display: "block", marginTop: ".6rem" }}>
            {error}
          </p>
        )}

        <div className="ms-grp">Vérifier l&apos;envoi</div>
        <div style={{ display: "flex", gap: ".65rem", alignItems: "center", flexWrap: "wrap" }}>
          <div className="field" style={{ flex: "1 1 220px", margin: 0 }}>
            <input
              id="mail-test-to"
              type="email"
              aria-label="Destinataire du test"
              value={testTo}
              placeholder="destinataire@example.com"
              onChange={(e) => setTestTo(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={runTest}
            disabled={testPending}
            style={{
              ...headBtn,
              padding: ".38rem .9rem",
              borderColor: "color-mix(in srgb, var(--accent) 40%, transparent)",
              color: "var(--accent)",
            }}
          >
            <SendGlyph size={13} /> {testPending ? "Envoi…" : "Envoyer le test"}
          </button>
          {testMsg ? (
            <span
              style={{
                fontSize: ".74rem",
                color: testMsg.ok ? "var(--accent)" : "var(--danger)",
                display: "inline-flex",
                alignItems: "center",
                gap: ".3rem",
              }}
            >
              {testMsg.ok ? <CircleCheckGlyph size={13} /> : <MailOffGlyph size={13} />}
              {testMsg.text}
            </span>
          ) : lastTest ? (
            <span
              style={{
                fontSize: ".74rem",
                color: lastTest.ok ? "var(--accent)" : "var(--danger)",
                display: "inline-flex",
                alignItems: "center",
                gap: ".3rem",
              }}
              title={lastTest.ok ? undefined : lastTest.error}
            >
              {lastTest.ok ? <CircleCheckGlyph size={13} /> : <MailOffGlyph size={13} />}
              {lastTest.ok ? "Reçu" : "Échec"} {relativeLabel(lastTest.at, nowMs)} (
              {dtFmt.format(new Date(lastTest.at))})
              {lastTest.ok && lastTest.ms > 0 ? ` en ${(lastTest.ms / 1000).toFixed(1)} s` : ""}
            </span>
          ) : null}
        </div>
        {lastTest && !lastTest.ok && !testMsg && (
          <p className="rg-mono" style={{ margin: ".35rem 0 0", color: "var(--danger)" }}>
            {lastTest.error}
          </p>
        )}
      </div>
    </>
  );
}
