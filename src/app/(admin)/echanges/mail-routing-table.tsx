"use client";

import { useState, useTransition } from "react";
import { CircleCheckGlyph, ClockGlyph } from "@/components/ui-glyphs";
import { MailOffGlyph, UsersGlyph } from "../users/account-ui";
import { setMailTriggerAction, setTriggerKindAction, setTriggerRecipientAction } from "./actions";
import type { RoutingRow, TriggerActor, TriggerFamily } from "./mail-rows";

// ════════════════════════════════════════════════════════════════════════════
//  « Échanges par mail » — refonte Dom 2026-09-09 : déclencheurs regroupés par
//  famille (Réservations / Rappels et absences / Liste d'attente), pastille d'acteur
//  devant chaque libellé (usager, gestionnaire, automatisme), interrupteur d'envoi
//  (ligne estompée quand l'envoi est coupé). Les réglages restent enregistrés au
//  changement, un par un, comme avant.
// ════════════════════════════════════════════════════════════════════════════

const RECIPIENT_OPTS: { value: string; label: string }[] = [
  { value: "usager", label: "L'usager concerné" },
  // « Le service » = e-mail de contact du service s'il est renseigné, sinon ses
  // gestionnaires — expliqué une fois dans le pied du panneau (Dom 2026-09-08).
  { value: "gestionnaires", label: "Le service" },
  { value: "administrateurs", label: "Les administrateurs" },
  { value: "fixe", label: "Adresse(s) e-mail…" },
];

const FAMILY_ORDER: TriggerFamily[] = ["reservations", "rappels", "attente"];
const FAMILY_LABEL: Record<TriggerFamily, string> = {
  reservations: "Réservations",
  rappels: "Rappels et absences",
  attente: "Liste d'attente",
};

/** Pastille d'acteur : usager (vert), gestionnaire (orange), automatisme (gris). */
function ActorBadge({ actor }: { actor: TriggerActor }) {
  const title =
    actor === "usager"
      ? "Déclenché par l'usager"
      : actor === "gestionnaire"
        ? "Déclenché par un gestionnaire"
        : "Déclenché automatiquement";
  return (
    <span className={`ex-actor is-${actor}`} title={title} aria-label={title}>
      {actor === "auto" ? <ClockGlyph size={12} /> : <UsersGlyph size={12} />}
    </span>
  );
}

export function MailRoutingTable({
  rows,
  kindOptions,
}: {
  rows: RoutingRow[];
  kindOptions: { value: string; label: string }[];
}) {
  const [kind, setKind] = useState<Record<string, string>>(
    Object.fromEntries(rows.map((r) => [r.triggerKey, r.kind])),
  );
  const [enabled, setEnabled] = useState<Record<string, boolean>>(
    Object.fromEntries(rows.map((r) => [r.triggerKey, r.enabled])),
  );
  const [recip, setRecip] = useState<Record<string, string>>(
    Object.fromEntries(rows.map((r) => [r.triggerKey, r.recipientKind])),
  );
  const [addr, setAddr] = useState<Record<string, string>>(
    Object.fromEntries(rows.map((r) => [r.triggerKey, r.recipientAddr])),
  );
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function changeKind(t: string, value: string) {
    const prev = kind[t];
    setMsg(null);
    setKind((s) => ({ ...s, [t]: value }));
    startTransition(async () => {
      const res = await setTriggerKindAction(t, value);
      if (res && !res.ok) {
        setKind((s) => ({ ...s, [t]: prev }));
        setMsg({ ok: false, text: res.error ?? "Échec de l'enregistrement." });
      } else {
        setMsg({ ok: true, text: "Type d'e-mail enregistré" });
      }
    });
  }

  function toggle(t: string, value: boolean) {
    setMsg(null);
    setEnabled((s) => ({ ...s, [t]: value }));
    startTransition(async () => {
      const res = await setMailTriggerAction(t, value);
      if (res && !res.ok) {
        setEnabled((s) => ({ ...s, [t]: !value }));
        setMsg({ ok: false, text: res.error ?? "Échec de l'enregistrement." });
      } else {
        setMsg({ ok: true, text: value ? "Envoi activé" : "Envoi désactivé" });
      }
    });
  }

  function persistRecipient(t: string, k: string, a: string, prevK: string, prevA: string) {
    startTransition(async () => {
      const res = await setTriggerRecipientAction(t, k, a);
      if (res && !res.ok) {
        setRecip((s) => ({ ...s, [t]: prevK }));
        setAddr((s) => ({ ...s, [t]: prevA }));
        setMsg({ ok: false, text: res.error ?? "Échec de l'enregistrement." });
      } else {
        setMsg({ ok: true, text: "Destinataire enregistré" });
      }
    });
  }

  function changeRecip(t: string, value: string) {
    const prevK = recip[t];
    const prevA = addr[t];
    setMsg(null);
    setRecip((s) => ({ ...s, [t]: value }));
    if (value !== "fixe") {
      persistRecipient(t, value, "", prevK, prevA);
    } else if ((addr[t] ?? "").includes("@")) {
      // Re-sélection de « fixe » avec une adresse déjà saisie → on enregistre.
      persistRecipient(t, "fixe", addr[t], prevK, prevA);
    }
    // Sinon (« fixe » sans adresse) : on attend la saisie (enregistrée au blur).
  }

  function blurAddr(t: string) {
    if (recip[t] !== "fixe") return;
    persistRecipient(t, "fixe", addr[t] ?? "", "fixe", addr[t] ?? "");
  }

  const total = rows.length;
  const sent = rows.filter((r) => enabled[r.triggerKey] ?? true).length;

  return (
    <div className="ex-list">
      <div className="ex-count">
        {total} action{total > 1 ? "s" : ""}, {sent} envoyée{sent > 1 ? "s" : ""}
        {msg && (
          <span
            className="ex-msg"
            style={{ color: msg.ok ? "var(--accent)" : "var(--danger)" }}
            role="status"
          >
            {msg.ok ? <CircleCheckGlyph size={12} /> : <MailOffGlyph size={12} />}
            {msg.text}
          </span>
        )}
      </div>
      {FAMILY_ORDER.map((fam) => {
        const items = rows.filter((r) => r.family === fam);
        if (items.length === 0) return null;
        return (
          <div key={fam}>
            <div className="ms-grp">{FAMILY_LABEL[fam]}</div>
            <div className="ex-head">
              <span>Déclencheur</span>
              <span>Type d&apos;e-mail</span>
              <span>Destinataire</span>
              <span style={{ textAlign: "center" }}>Envoi</span>
            </div>
            {items.map((r) => {
              const on = enabled[r.triggerKey] ?? true;
              return (
                <div key={r.triggerKey} className={`ex-row${on ? "" : " is-off"}`}>
                  <div className="ex-trig">
                    <ActorBadge actor={r.actor} />
                    <span>{r.action}</span>
                  </div>
                  <select
                    aria-label={`Type d'e-mail : ${r.action}`}
                    value={kind[r.triggerKey]}
                    disabled={pending}
                    onChange={(e) => changeKind(r.triggerKey, e.target.value)}
                    className="ex-sel"
                  >
                    {kindOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <div style={{ display: "grid", gap: ".25rem", minWidth: 0 }}>
                    <select
                      aria-label={`Destinataire : ${r.action}`}
                      value={recip[r.triggerKey]}
                      disabled={pending}
                      onChange={(e) => changeRecip(r.triggerKey, e.target.value)}
                      className="ex-sel"
                    >
                      {RECIPIENT_OPTS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {recip[r.triggerKey] === "fixe" && (
                      <input
                        type="text"
                        aria-label={`Adresses e-mail : ${r.action}`}
                        placeholder="adresse1@ex.fr, adresse2@ex.fr"
                        value={addr[r.triggerKey] ?? ""}
                        disabled={pending}
                        onChange={(e) => setAddr((s) => ({ ...s, [r.triggerKey]: e.target.value }))}
                        onBlur={() => blurAddr(r.triggerKey)}
                        className="ex-sel"
                      />
                    )}
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={`Envoyer : ${r.action}`}
                    title={
                      on
                        ? "Envoi activé — cliquer pour couper"
                        : "Envoi coupé — cliquer pour activer"
                    }
                    className={`ex-sw${on ? " is-on" : ""}`}
                    disabled={pending}
                    onClick={() => toggle(r.triggerKey, !on)}
                  />
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
