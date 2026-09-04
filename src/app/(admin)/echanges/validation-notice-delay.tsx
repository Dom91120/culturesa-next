"use client";

import { useState, useTransition } from "react";
import { INPUT_CHROME } from "@/components/ui-styles";
import { setValidationNoticeDelayAction } from "./actions";

/**
 * Réglage GLOBAL du délai de regroupement des notifications de validation (sous le
 * tableau « Échanges par mail ») : un gestionnaire qui hésite (validé, dévalidé…) ne
 * déclenche qu'un e-mail au plus, reflétant l'état final, envoyé après ce délai par le
 * cron « Notifications de validation ». 0 = envoi immédiat à chaque clic.
 */
export function ValidationNoticeDelayField({ initial }: { initial: number }) {
  const [value, setValue] = useState(String(initial));
  const [saved, setSaved] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function save() {
    const n = Number.parseInt(value, 10);
    if (!Number.isInteger(n) || n < 0) {
      setMsg({ ok: false, text: "Saisissez un nombre de minutes (0 = immédiat)." });
      return;
    }
    if (n === saved) return;
    setMsg(null);
    startTransition(async () => {
      const res = await setValidationNoticeDelayAction(n);
      if (res && !res.ok) {
        setMsg({ ok: false, text: res.error ?? "Échec de l'enregistrement." });
        return;
      }
      setSaved(n);
      setMsg({ ok: true, text: "Délai enregistré ✓" });
    });
  }

  return (
    <div style={{ marginTop: "1.25rem", paddingTop: "1rem", borderTop: "1px solid var(--border)" }}>
      <label htmlFor="validation-notice-delay" style={{ display: "block", marginBottom: ".35rem" }}>
        Délai de regroupement des notifications de validation
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: ".5rem", flexWrap: "wrap" }}>
        <input
          id="validation-notice-delay"
          type="number"
          min={0}
          max={1440}
          step={1}
          value={value}
          disabled={pending}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
          style={{ ...INPUT_CHROME, width: 80, padding: ".3rem .5rem", fontSize: ".85rem" }}
        />
        <span style={{ fontSize: ".85rem" }}>minutes</span>
        {msg && (
          <span style={{ fontSize: ".8rem", color: msg.ok ? "var(--accent)" : "var(--danger)" }}>
            {msg.text}
          </span>
        )}
      </div>
      <p style={{ fontSize: ".8rem", lineHeight: 1.5, color: "var(--muted)", margin: ".5rem 0 0" }}>
        Quand un gestionnaire valide ou remet en attente une réservation, l&apos;e-mail part après
        ce délai et ne reflète que l&apos;<strong>état final</strong> : une hésitation (validé,
        dévalidé, validé…) ne produit qu&apos;un e-mail au plus, aucun si l&apos;état revient à
        celui que l&apos;usager connaissait. <strong>0</strong> = envoi immédiat à chaque clic. Le
        délai effectif s&apos;étend jusqu&apos;au passage suivant de la tâche planifiée (toutes les
        5 minutes).
      </p>
    </div>
  );
}
