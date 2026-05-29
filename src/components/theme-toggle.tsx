"use client";

import { useEffect, useState } from "react";

/** Bascule clair/sombre (ajoute/retire la classe `light` sur <html>), persistée. */
export function ThemeToggle() {
  const [light, setLight] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const isLight = stored ? stored === "light" : true;
    setLight(isLight);
    document.documentElement.classList.toggle("light", isLight);
  }, []);

  function toggle() {
    const next = !light;
    setLight(next);
    document.documentElement.classList.toggle("light", next);
    localStorage.setItem("theme", next ? "light" : "dark");
  }

  return (
    <button type="button" className="btn-theme" onClick={toggle} title="Changer le thème">
      {light ? "🌙" : "☀️"}
    </button>
  );
}
