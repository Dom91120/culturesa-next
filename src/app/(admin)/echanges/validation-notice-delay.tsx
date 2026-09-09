"use client";

import { useState, useTransition } from "react";
import { HourglassGlyph } from "@/components/ui-glyphs";
import { setValidationNoticeDelayAction } from "./actions";

/**
 * Réglage GLOBAL du délai de regroupement des notifications de validation, sur une ligne
 * sous le titre de « Échanges par mail » (refonte Dom 2026-09-09) : un gestionnaire qui
 * hésite (validé, dévalidé…) ne déclenche qu'un e-mail au plus, reflétant l'état final,
 * envoyé après ce délai par le cron « Notifications de validation ». 0 = envoi immédiat.
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
      setMsg({ ok: true, text: "Délai enregistré" });
    });
  }

  return (
    <div className="ex-set">
      <HourglassGlyph size={14} />
      <label htmlFor="validation-notice-delay">
        Notifications de validation regroupées pendant
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
        />
        min
      </label>
      <span className="note">
        {msg ? (
          <span style={{ color: msg.ok ? "var(--accent)" : "var(--danger)" }}>{msg.text}</span>
        ) : (
          <>
            une hésitation (validé, dévalidé…) ne produit qu&apos;un e-mail, celui de l&apos;état
            final, au passage suivant de la tâche planifiée ; 0 = immédiat
          </>
        )}
      </span>
    </div>
  );
}
