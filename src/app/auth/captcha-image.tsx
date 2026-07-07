"use client";

import { type Ref, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

export type CaptchaHandle = { refresh: () => void };

/**
 * CAPTCHA image auto-hébergé. Charge un défi depuis `/api/captcha` (SVG + token),
 * affiche l'image et un champ de saisie, et remonte `{ token, answer }` au parent
 * via `onChange`. Le parent peut demander un nouveau défi via la ref (`refresh()`),
 * typiquement après un échec d'inscription (token à usage unique / expiré).
 */
// React 19 : `ref` est une prop normale (plus de forwardRef).
export function CaptchaImage({
  onChange,
  ref,
}: {
  onChange: (state: { token: string; answer: string }) => void;
  ref?: Ref<CaptchaHandle>;
}) {
  const [svg, setSvg] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);

  // La callback est gardée dans une ref pour que `load` reste stable (sinon l'effet
  // de chargement initial se redéclencherait à chaque rendu du parent).
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const load = useCallback(async () => {
    setLoading(true);
    setAnswer("");
    try {
      const res = await fetch("/api/captcha", { cache: "no-store" });
      const data = (await res.json()) as { svg: string; token: string };
      setSvg(data.svg);
      setToken(data.token);
      onChangeRef.current({ token: data.token, answer: "" });
    } catch {
      setSvg(null);
      setToken("");
      onChangeRef.current({ token: "", answer: "" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useImperativeHandle(ref, () => ({ refresh: load }));

  function onAnswer(v: string) {
    setAnswer(v);
    onChangeRef.current({ token, answer: v });
  }

  return (
    <div className="field">
      <label htmlFor="c-captcha">
        Recopiez le code <span className="required-star">*</span>
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: ".5rem", flexWrap: "wrap" }}>
        {svg && (
          // Image servie par notre route (SVG en <path>, contexte <img> = aucun script).
          <img
            src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`}
            alt="Code de vérification à recopier"
            width={230}
            height={72}
            style={{
              borderRadius: 8,
              border: "1px solid var(--border, #2a2f3a)",
              display: "block",
            }}
          />
        )}
        <button
          type="button"
          className="btn btn-ghost"
          onClick={load}
          disabled={loading}
          title="Afficher un autre code"
          aria-label="Afficher un autre code"
          style={{ fontSize: "1.1rem", lineHeight: 1, padding: ".45rem .6rem" }}
        >
          ↻
        </button>
      </div>
      <input
        id="c-captcha"
        type="text"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder="Code de l'image"
        value={answer}
        onChange={(e) => onAnswer(e.target.value)}
      />
      <p style={{ fontSize: ".8rem", opacity: 0.7, marginTop: ".25rem" }}>
        Lettres et chiffres · pas sensible à la casse
      </p>
    </div>
  );
}
