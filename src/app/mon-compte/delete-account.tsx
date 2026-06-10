"use client";

import { useState, useTransition } from "react";
import { requestAccountDeletionAction } from "./actions";

/**
 * Zone « danger » de Mon compte : déclenche l'envoi d'un e-mail de confirmation de
 * suppression (RGPD art. 17). La suppression effective n'a lieu qu'après clic sur le
 * lien reçu (valable 24 h).
 */
export function DeleteAccount() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onClick() {
    setError(null);
    if (
      !window.confirm(
        "Demander la suppression de votre compte ?\n\nUn e-mail de confirmation vous sera envoyé. La suppression (anonymisation irréversible de vos données) n'aura lieu qu'après avoir cliqué sur le lien reçu.",
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await requestAccountDeletionAction();
      if (res?.ok) setSent(true);
      else setError(res?.error ?? "Échec de l'envoi. Réessayez plus tard.");
    });
  }

  return (
    <div
      className="panel"
      style={{ marginTop: "1rem", borderColor: "color-mix(in srgb, #e5484d 45%, var(--border))" }}
    >
      <div className="panel-title">
        <span className="dot" style={{ background: "#e5484d" }} />
        Supprimer mon compte
      </div>
      <p style={{ fontSize: ".85rem", color: "var(--muted)", margin: ".25rem 0 .9rem" }}>
        Conformément au RGPD (droit à l'effacement), vous pouvez demander la suppression de votre
        compte. Vos données personnelles seront <strong>anonymisées de façon irréversible</strong>.
        Un e-mail de confirmation (lien valable 24&nbsp;h) vous sera envoyé.
      </p>

      {sent ? (
        <p style={{ fontSize: ".85rem", color: "var(--accent)" }}>
          ✅ Un e-mail de confirmation vient de vous être envoyé. Cliquez sur le lien qu'il contient
          pour finaliser la suppression (valable 24&nbsp;h).
        </p>
      ) : (
        <>
          <button
            type="button"
            className="btn"
            onClick={onClick}
            disabled={pending}
            style={{
              background: "#e5484d",
              color: "#fff",
              border: "none",
            }}
          >
            {pending ? "Envoi…" : "Demander la suppression de mon compte"}
          </button>
          {error && (
            <p className="field-error" style={{ display: "block", marginTop: ".5rem" }}>
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
