"use client";

import { useState, useTransition } from "react";
import { setMailTriggerAction, setTriggerKindAction, setTriggerRecipientAction } from "./actions";
import type { RoutingRow } from "./mail-rows";

const RECIPIENT_OPTS: { value: string; label: string }[] = [
  { value: "usager", label: "L'usager concerné" },
  { value: "gestionnaires", label: "Les gestionnaires du service" },
  { value: "administrateurs", label: "Les administrateurs" },
  { value: "fixe", label: "Adresse(s) e-mail…" },
];

/**
 * Sous-onglet « Échanges par mail » : une ligne par ACTION (déclencheur).
 *  - « Type d'e-mail » : menu déroulant — re-route l'action vers un autre type d'e-mail.
 *  - « Destinataire » : qui reçoit l'e-mail de CETTE action (défaut : l'usager concerné).
 *  - « Envoyer » : active/désactive l'envoi pour CETTE action.
 * Le CONTENU des e-mails se règle dans le sous-onglet « Modèles d'e-mails ».
 */
export function MailRoutingTable({
  rows,
  kindOptions,
  serviceId,
}: {
  rows: RoutingRow[];
  kindOptions: { value: string; label: string }[];
  serviceId: string;
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
      const res = await setTriggerKindAction(t, value, serviceId);
      if (res && !res.ok) {
        setKind((s) => ({ ...s, [t]: prev }));
        setMsg({ ok: false, text: res.error ?? "Échec de l'enregistrement." });
      } else {
        setMsg({ ok: true, text: "Type d'e-mail enregistré ✓" });
      }
    });
  }

  function toggle(t: string, value: boolean) {
    setMsg(null);
    setEnabled((s) => ({ ...s, [t]: value }));
    startTransition(async () => {
      const res = await setMailTriggerAction(t, value, serviceId);
      if (res && !res.ok) {
        setEnabled((s) => ({ ...s, [t]: !value }));
        setMsg({ ok: false, text: res.error ?? "Échec de l'enregistrement." });
      } else {
        setMsg({ ok: true, text: "Préférence enregistrée ✓" });
      }
    });
  }

  function persistRecipient(t: string, k: string, a: string, prevK: string, prevA: string) {
    startTransition(async () => {
      const res = await setTriggerRecipientAction(t, k, a, serviceId);
      if (res && !res.ok) {
        setRecip((s) => ({ ...s, [t]: prevK }));
        setAddr((s) => ({ ...s, [t]: prevA }));
        setMsg({ ok: false, text: res.error ?? "Échec de l'enregistrement." });
      } else {
        setMsg({ ok: true, text: "Destinataire enregistré ✓" });
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

  const th: React.CSSProperties = {
    textAlign: "left",
    padding: ".5rem .6rem",
    borderBottom: "1px solid var(--border)",
    color: "var(--muted)",
    fontWeight: 600,
  };
  const cell: React.CSSProperties = {
    padding: ".55rem .6rem",
    borderBottom: "1px solid var(--border)",
  };
  const selStyle: React.CSSProperties = {
    fontSize: ".82rem",
    padding: ".25rem .4rem",
    borderRadius: "var(--rad-sm)",
    border: "1px solid var(--border)",
    background: "var(--surface2)",
    color: "var(--text)",
    maxWidth: "100%",
  };

  return (
    <div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".85rem" }}>
        <thead>
          <tr>
            <th style={th}>Déclencheur</th>
            <th style={th}>Type d&apos;e-mail</th>
            <th style={th}>Destinataire</th>
            <th style={{ ...th, textAlign: "center", width: 90 }}>Envoyer</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.triggerKey}>
              <td style={cell}>{r.action}</td>
              <td style={cell}>
                <select
                  aria-label={`Type d'e-mail : ${r.action}`}
                  value={kind[r.triggerKey]}
                  disabled={pending}
                  onChange={(e) => changeKind(r.triggerKey, e.target.value)}
                  style={selStyle}
                >
                  {kindOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </td>
              <td style={cell}>
                <select
                  aria-label={`Destinataire : ${r.action}`}
                  value={recip[r.triggerKey]}
                  disabled={pending}
                  onChange={(e) => changeRecip(r.triggerKey, e.target.value)}
                  style={selStyle}
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
                    style={{ ...selStyle, display: "block", marginTop: ".35rem", width: "100%" }}
                  />
                )}
              </td>
              <td style={{ ...cell, textAlign: "center" }}>
                <input
                  type="checkbox"
                  aria-label={`Envoyer : ${r.action}`}
                  checked={enabled[r.triggerKey] ?? true}
                  disabled={pending}
                  onChange={(e) => toggle(r.triggerKey, e.target.checked)}
                  style={{ width: 18, height: 18, cursor: pending ? "default" : "pointer" }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {msg && (
        <span
          style={{
            display: "inline-block",
            marginTop: ".75rem",
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
