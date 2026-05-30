"use client";

import { useActionState, useState, useTransition } from "react";
import { initialActionState } from "@/lib/action-state";
import { saveMessagingAction, sendTestEmailAction } from "./actions";

type Props = {
  senderName: string;
  signature: string;
  smtpConfigured: boolean;
  smtpHost: string;
  smtpFrom: string;
};

export function MessagingPanel({ senderName, signature, smtpConfigured, smtpHost, smtpFrom }: Props) {
  const [state, action, pending] = useActionState(saveMessagingAction, initialActionState);
  const [testPending, startTest] = useTransition();
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function runTest() {
    setTestMsg(null);
    startTest(async () => {
      const res = await sendTestEmailAction();
      setTestMsg(
        res?.ok
          ? { ok: true, text: "E-mail de test envoyé ✓" }
          : { ok: false, text: res?.error ?? "Échec." },
      );
    });
  }

  return (
    <div>
      <div className="panel">
        <div className="panel-title" style={{ fontSize: ".82rem" }}>
          <span className="dot" />
          Transport SMTP
        </div>
        <p style={{ fontSize: ".8rem", color: "var(--muted)", marginBottom: ".6rem" }}>
          Configuré via les variables d&apos;environnement du serveur (sécurisé). Le mot de passe
          n&apos;est jamais affiché.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1.2rem", fontSize: ".82rem", marginBottom: ".75rem" }}>
          <div>
            <div style={{ fontSize: ".62rem", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--muted)" }}>Statut</div>
            <div style={{ color: smtpConfigured ? "var(--accent)" : "var(--danger)", fontWeight: 600 }}>
              {smtpConfigured ? "Configuré" : "Non configuré"}
            </div>
          </div>
          <div>
            <div style={{ fontSize: ".62rem", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--muted)" }}>Serveur</div>
            <div>{smtpHost || "—"}</div>
          </div>
          <div>
            <div style={{ fontSize: ".62rem", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--muted)" }}>Expéditeur</div>
            <div>{smtpFrom || "—"}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: ".75rem", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ghost" onClick={runTest} disabled={testPending}>
            {testPending ? "Envoi…" : "✉️ Envoyer un e-mail de test"}
          </button>
          {testMsg && (
            <span style={{ fontSize: ".8rem", color: testMsg.ok ? "var(--accent)" : "var(--danger)" }}>
              {testMsg.text}
            </span>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-title" style={{ fontSize: ".82rem" }}>
          <span className="dot" />
          Réglages des messages
        </div>
        <form action={action}>
          <div className="form-grid">
            <div className="field full">
              <label htmlFor="m-sender">Nom de l&apos;expéditeur</label>
              <input id="m-sender" name="senderName" defaultValue={senderName} placeholder="CultuRésa — Ville de Châtillon" />
            </div>
            <div className="field full">
              <label htmlFor="m-signature">Signature des e-mails</label>
              <textarea id="m-signature" name="signature" defaultValue={signature} rows={4} placeholder="Cordialement, l'équipe CultuRésa" />
            </div>
          </div>
          <div className="btn-row">
            {state?.ok && <span style={{ fontSize: ".8rem", color: "var(--accent)" }}>Enregistré ✓</span>}
            {state?.error && <span className="field-error" style={{ display: "inline" }}>{state.error}</span>}
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Enregistrement…" : "💾 Enregistrer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
