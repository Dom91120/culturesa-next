"use client";

import { useState, useTransition } from "react";
import { CircleCheckGlyph, InfoGlyph, RefreshGlyph, RepeatGlyph } from "@/components/ui-glyphs";
import { DATETIME_FMT_FR as dtFmt, relativeLabel } from "@/lib/format";
import { MailOffGlyph, TrashGlyph } from "../users/account-ui";
import {
  deleteFailedMailAction,
  retryAllFailedMailsAction,
  retryFailedMailAction,
} from "./actions";

// E-mails en échec — refonte Dom 2026-09-09 : lignes avec pictogramme rouge, objet,
// destinataire et date relative, cause en chasse fixe, nombre d'essais en pastille,
// actions au survol (renvoyer / abandonner), explication en pied.

export type FailedMailRow = {
  id: number;
  toAddr: string;
  subject: string;
  error: string;
  attempts: number;
  createdAt: string; // ISO
  lastTriedAt: string; // ISO
};

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dtFmt.format(d);
}

export function FailedMailsPanel({ mails, nowMs }: { mails: FailedMailRow[]; nowMs: number }) {
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
          ? { ok: true, text: "E-mail renvoyé" }
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
          ? { ok: true, text: `${sent} e-mail${sent > 1 ? "s" : ""} renvoyé${sent > 1 ? "s" : ""}` }
          : {
              ok: false,
              text: `${sent} envoyé${sent > 1 ? "s" : ""}, ${failed} toujours en échec.`,
            },
      );
    });
  }

  const headBtn = {
    padding: ".25rem .65rem",
    fontSize: ".68rem",
    display: "inline-flex",
    alignItems: "center",
    gap: ".35rem",
  } as const;

  return (
    <div className="panel" id="failed-mails-panel">
      <div className="panel-title" style={{ justifyContent: "space-between", gap: ".75rem" }}>
        <span style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
          <span className={`rg-ico ${mails.length ? "is-danger" : "is-ok"}`}>
            {mails.length ? <MailOffGlyph size={16} /> : <CircleCheckGlyph size={16} />}
          </span>
          E-mails en échec
          {mails.length > 0 && (
            <span style={{ color: "var(--muted)", fontWeight: 400 }}>· {mails.length}</span>
          )}
        </span>
        {mails.length > 0 && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={retryAll}
            disabled={pending}
            style={headBtn}
          >
            <RefreshGlyph size={13} /> {pending && busyId === null ? "Envoi…" : "Tout renvoyer"}
          </button>
        )}
      </div>

      {mails.length === 0 ? (
        <p style={{ fontSize: ".8rem", color: "var(--muted)", margin: ".25rem 0 0" }}>
          Aucun e-mail en échec. Les notifications qui n&apos;ont pas pu être envoyées apparaîtront
          ici et pourront être renvoyées.
        </p>
      ) : (
        <div className="ms-list">
          {mails.map((m) => (
            <div key={m.id} className="ms-row">
              <span className="rg-ico is-danger">
                <MailOffGlyph size={14} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div className="ms-subj">{m.subject || "(sans objet)"}</div>
                <div className="ms-sub">
                  À {m.toAddr} · {relativeLabel(m.createdAt, nowMs)} ({fmt(m.createdAt)})
                  {m.attempts > 1 ? ` · dernier essai ${relativeLabel(m.lastTriedAt, nowMs)}` : ""}
                </div>
                {m.error && (
                  <div className="ms-err" title={m.error}>
                    {m.error}
                  </div>
                )}
              </div>
              <span className={`ms-pill ${m.attempts > 1 ? "is-warn" : "is-neutral"}`}>
                <RepeatGlyph size={11} /> {m.attempts} essai{m.attempts > 1 ? "s" : ""}
              </span>
              <div className="ms-acts">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => retryOne(m.id)}
                  disabled={pending}
                  style={{
                    ...headBtn,
                    padding: ".2rem .55rem",
                    borderColor: "color-mix(in srgb, var(--accent) 40%, transparent)",
                    color: "var(--accent)",
                  }}
                >
                  <RefreshGlyph size={12} /> {busyId === m.id && pending ? "…" : "Renvoyer"}
                </button>
                <button
                  type="button"
                  className="acct-action is-danger"
                  onClick={() => discardOne(m.id)}
                  disabled={pending}
                  title="Abandonner cet envoi"
                  aria-label="Abandonner cet envoi"
                >
                  <TrashGlyph size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="rg-foot">
        <InfoGlyph size={13} />
        <span style={{ flex: 1 }}>
          Un e-mail qui échoue est gardé ici avec sa cause. « Renvoyer » réessaie avec la
          configuration actuelle ; la corbeille abandonne l&apos;envoi. Rien n&apos;est renvoyé
          automatiquement.
        </span>
        {msg && (
          <span
            style={{
              color: msg.ok ? "var(--accent)" : "var(--danger)",
              display: "inline-flex",
              alignItems: "center",
              gap: ".3rem",
            }}
          >
            {msg.ok ? <CircleCheckGlyph size={13} /> : <MailOffGlyph size={13} />}
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
