"use client";

import { useEffect, useState, useTransition } from "react";
import { requestAccountDeletionAction } from "./actions";

/**
 * Zone « danger » de Mon compte : déclenche l'envoi d'un e-mail de confirmation de
 * suppression (RGPD art. 17). La suppression effective n'a lieu qu'après clic sur le
 * lien reçu (valable 24 h). La confirmation se fait dans une modale.
 */
export function DeleteAccount() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // Fermeture de la modale de confirmation par la touche Échap (sauf pendant l'envoi).
  useEffect(() => {
    if (!confirmOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) setConfirmOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirmOpen, pending]);

  function confirmDeletion() {
    setError(null);
    startTransition(async () => {
      const res = await requestAccountDeletionAction();
      if (res?.ok) {
        setSent(true);
        setConfirmOpen(false);
      } else {
        setError(res?.error ?? "Échec de l'envoi. Réessayez plus tard.");
      }
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
            onClick={() => {
              setError(null);
              setConfirmOpen(true);
            }}
            style={{
              background: "#e5484d",
              color: "#fff",
              border: "none",
            }}
          >
            Demander la suppression de mon compte
          </button>

          {confirmOpen && (
            // biome-ignore lint/a11y/useKeyWithClickEvents: fermeture clavier gérée globalement (Échap)
            <div
              className="modal-overlay open"
              style={{ display: "flex" }}
              // Clic sur le fond → ferme (sauf pendant l'envoi).
              onClick={(e) => {
                if (e.target === e.currentTarget && !pending) setConfirmOpen(false);
              }}
            >
              <div className="modal-box" style={{ maxWidth: 460 }}>
                <div className="modal-title">
                  <span className="dot" style={{ background: "#e5484d" }} />
                  Supprimer mon compte ?
                </div>
                <p style={{ fontSize: ".85rem", lineHeight: 1.5, color: "var(--text)", margin: 0 }}>
                  Un e-mail de confirmation vous sera envoyé. La suppression (anonymisation{" "}
                  <strong>irréversible</strong> de vos données) n&apos;aura lieu qu&apos;après avoir
                  cliqué sur le lien reçu (valable 24&nbsp;h).
                </p>
                {error && (
                  <p className="field-error" style={{ display: "block", marginTop: ".6rem" }}>
                    {error}
                  </p>
                )}
                <div
                  style={{
                    display: "flex",
                    gap: ".5rem",
                    justifyContent: "flex-end",
                    marginTop: "1rem",
                  }}
                >
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setConfirmOpen(false)}
                    disabled={pending}
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={confirmDeletion}
                    disabled={pending}
                    style={{ background: "#e5484d", color: "#fff", border: "none" }}
                  >
                    {pending ? "Envoi…" : "Confirmer la suppression"}
                  </button>
                </div>
                {!pending && (
                  <button
                    type="button"
                    className="modal-close"
                    onClick={() => setConfirmOpen(false)}
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
