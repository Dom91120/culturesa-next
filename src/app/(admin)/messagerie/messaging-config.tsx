"use client";

import { useMemo, useState, useTransition } from "react";
import { type MailConfigInput, saveMailConfigAction, sendTestMailAction } from "./actions";

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
};

const reqStar = <span className="required-star"> *</span>;

export function MessagingConfig({ config }: { config: MailConfig }) {
  const [driver, setDriver] = useState<Driver>(
    config.driver === "mail" || config.driver === "sendmail" ? config.driver : "smtp",
  );
  const [from, setFrom] = useState(config.from);
  const [fromName, setFromName] = useState(config.fromName);
  const [host, setHost] = useState(config.host);
  const [port, setPort] = useState(config.port || "587");
  const [security, setSecurity] = useState<Security>(
    config.security === "tls" || config.security === "ssl" ? config.security : "",
  );
  const [username, setUsername] = useState(config.username);
  const [password, setPassword] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const [testTo, setTestTo] = useState("");
  const [testPending, startTest] = useTransition();
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const smtpOn = driver === "smtp";

  // État « modifié » : on ne compare jamais le mot de passe (jamais ré-affiché),
  // mais le saisir compte comme modification.
  const initialSig = useMemo(
    () =>
      [
        config.driver === "mail" || config.driver === "sendmail" ? config.driver : "smtp",
        config.from,
        config.fromName,
        config.host,
        config.port || "587",
        config.security === "tls" || config.security === "ssl" ? config.security : "",
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
    const payload: MailConfigInput = {
      driver,
      from: from.trim(),
      fromName: fromName.trim(),
      host: host.trim(),
      port: port.trim(),
      security,
      username: username.trim(),
      password,
    };
    startTransition(async () => {
      const res = await saveMailConfigAction(payload);
      if (res && !res.ok) {
        setError(res.error ?? "Échec de l'enregistrement.");
        return;
      }
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
          ? { ok: true, text: "E-mail de test envoyé ✓" }
          : { ok: false, text: res?.error ?? "Échec de l'envoi." },
      );
    });
  }

  return (
    <div className="panel" id="mail-config-panel">
      <div className="panel-title" style={{ justifyContent: "space-between" }}>
        <span style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
          <span className="dot" style={{ background: "var(--warn)" }} />
          Configuration messagerie
        </span>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={save}
          disabled={pending}
          style={{ padding: ".3rem .75rem", fontSize: ".78rem" }}
        >
          {pending ? "Enregistrement…" : "💾 Enregistrer"}
        </button>
      </div>

      <div className="form-grid">
        <div className="field">
          <label htmlFor="mail-driver">Mode d&apos;envoi</label>
          <select
            id="mail-driver"
            value={driver}
            onChange={(e) => {
              touch();
              setDriver(e.target.value as Driver);
            }}
          >
            <option value="smtp">SMTP</option>
            <option value="mail">Fonction mail système</option>
            <option value="sendmail">Sendmail</option>
          </select>
        </div>

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
        </div>

        {/* Champs SMTP : display:contents pour qu'ils coulent directement dans la
            grille 2-colonnes (cf. legacy #smtp-fields-wrap). */}
        <div
          id="smtp-fields-wrap"
          style={{
            display: "contents",
            opacity: smtpOn ? 1 : 0.4,
            pointerEvents: smtpOn ? "auto" : "none",
          }}
        >
          <div className="field">
            <label htmlFor="mail-host">Serveur SMTP{reqStar}</label>
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

          <div style={{ display: "flex", gap: ".75rem", alignItems: "flex-end", minWidth: 0 }}>
            <div className="field" style={{ flex: 3, minWidth: 0 }}>
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
            <div className="field" style={{ flex: 5, minWidth: 0 }}>
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
            <label htmlFor="mail-username">Nom d&apos;utilisateur SMTP</label>
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
            <label htmlFor="mail-password">Mot de passe SMTP</label>
            <input
              id="mail-password"
              type="password"
              value={password}
              placeholder="••••••••"
              autoComplete="new-password"
              disabled={!smtpOn}
              onChange={(e) => {
                touch();
                setPassword(e.target.value);
              }}
            />
            <span className="field-hint">Laissez vide pour conserver le mot de passe actuel.</span>
          </div>
        </div>
      </div>

      <div
        style={{ borderTop: "1px solid var(--border)", marginTop: "1.25rem", paddingTop: "1rem" }}
      >
        <div className="panel-title" style={{ marginBottom: ".75rem", fontSize: ".8rem" }}>
          <span
            className="dot"
            style={{ background: "var(--accent)", width: ".45rem", height: ".45rem" }}
          />
          Envoyer un e-mail de test
        </div>
        <div style={{ display: "flex", gap: ".65rem", alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="field" style={{ flex: 1, minWidth: 200, margin: 0 }}>
            <label htmlFor="mail-test-to" style={{ fontSize: ".72rem" }}>
              Destinataire
            </label>
            <input
              id="mail-test-to"
              type="email"
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
              padding: ".38rem .9rem",
              fontSize: ".78rem",
              borderColor: "color-mix(in srgb, var(--accent) 40%, transparent)",
              color: "var(--accent)",
            }}
          >
            {testPending ? "Envoi…" : "🖅 Envoyer le test"}
          </button>
        </div>
        {testMsg && (
          <span
            style={{
              display: "inline-block",
              marginTop: ".5rem",
              fontSize: ".8rem",
              color: testMsg.ok ? "var(--accent)" : "var(--danger)",
            }}
          >
            {testMsg.text}
          </span>
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: ".5rem",
          marginTop: ".75rem",
        }}
      >
        {error && (
          <span className="field-error" style={{ display: "inline" }}>
            {error}
          </span>
        )}
        {saved && !dirty && (
          <span style={{ fontSize: ".8rem", color: "var(--accent)" }}>Enregistré ✓</span>
        )}
      </div>
    </div>
  );
}
