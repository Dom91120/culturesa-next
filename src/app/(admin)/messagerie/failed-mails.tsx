"use client";

import { useState, useTransition } from "react";
import {
  deleteFailedMailAction,
  retryAllFailedMailsAction,
  retryFailedMailAction,
} from "./actions";

export type FailedMailRow = {
  id: number;
  toAddr: string;
  subject: string;
  error: string;
  attempts: number;
  createdAt: string; // ISO
  lastTriedAt: string; // ISO
};

const dateFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateFmt.format(d);
}

export function FailedMailsPanel({ mails }: { mails: FailedMailRow[] }) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function retryOne(id: number) {
    setMsg(null);
    setBusyId(id);
    startTransition(async () => {
      const res = await retryFailedMailAction(id);
      setBusyId(null);
      setMsg(
        res?.ok
          ? { ok: true, text: "E-mail renvoyé ✓" }
          : { ok: false, text: res?.error ?? "Échec de l'envoi." },
      );
    });
  }

  function discardOne(id: number) {
    setMsg(null);
    setBusyId(id);
    startTransition(async () => {
      await deleteFailedMailAction(id);
      setBusyId(null);
    });
  }

  function retryAll() {
    setMsg(null);
    startTransition(async () => {
      const res = await retryAllFailedMailsAction();
      const sent = res?.sent ?? 0;
      const failed = res?.failed ?? 0;
      setMsg(
        res?.ok
          ? { ok: true, text: `${sent} e-mail(s) renvoyé(s) ✓` }
          : { ok: false, text: `${sent} envoyé(s), ${failed} en échec.` },
      );
    });
  }

  return (
    <div className="panel" id="failed-mails-panel" style={{ marginTop: "1rem" }}>
      <div className="panel-title" style={{ justifyContent: "space-between" }}>
        <span style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
          <span
            className="dot"
            style={{ background: mails.length ? "var(--danger)" : "var(--accent)" }}
          />
          E-mails en échec{mails.length > 0 ? ` (${mails.length})` : ""}
        </span>
        {mails.length > 0 && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={retryAll}
            disabled={pending}
            style={{ padding: ".3rem .75rem", fontSize: ".78rem" }}
          >
            {pending ? "Envoi…" : "↻ Tout renvoyer"}
          </button>
        )}
      </div>

      {mails.length === 0 ? (
        <p style={{ fontSize: ".82rem", color: "var(--muted)", margin: ".25rem 0 0" }}>
          Aucun e-mail en échec. Les notifications qui n&apos;ont pas pu être envoyées
          apparaîtront ici et pourront être renvoyées.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: ".5rem", marginTop: ".25rem" }}>
          {mails.map((m) => (
            <div
              key={m.id}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: ".55rem .7rem",
                display: "flex",
                gap: ".75rem",
                alignItems: "flex-start",
                justifyContent: "space-between",
                flexWrap: "wrap",
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: ".82rem", fontWeight: 600 }}>
                  {m.subject || "(sans objet)"}
                </div>
                <div style={{ fontSize: ".74rem", color: "var(--muted)" }}>
                  À : {m.toAddr} · {fmt(m.createdAt)}
                  {m.attempts > 1 ? ` · ${m.attempts} essais` : ""}
                </div>
                {m.error && (
                  <div style={{ fontSize: ".72rem", color: "var(--danger)", marginTop: ".15rem" }}>
                    {m.error}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: ".4rem", flexShrink: 0 }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => retryOne(m.id)}
                  disabled={pending}
                  style={{
                    padding: ".3rem .6rem",
                    fontSize: ".76rem",
                    borderColor: "color-mix(in srgb, var(--accent) 40%, transparent)",
                    color: "var(--accent)",
                  }}
                >
                  {busyId === m.id && pending ? "…" : "↻ Renvoyer"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => discardOne(m.id)}
                  disabled={pending}
                  style={{ padding: ".3rem .6rem", fontSize: ".76rem", color: "var(--danger)" }}
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {msg && (
        <span
          style={{
            display: "inline-block",
            marginTop: ".5rem",
            fontSize: ".8rem",
            color: msg.ok ? "var(--accent)" : "var(--danger)",
          }}
        >
          {msg.text}
        </span>
      )}
    </div>
  );
}
