import { escapeHtml } from "@/lib/email-theme";

// Moteur de gabarits d'e-mails — SOURCE UNIQUE, pure et isomorphe (serveur ET client).
// Utilisé côté serveur pour l'envoi réel (mail-templates.ts / mail-send.ts) ET côté
// client pour l'aperçu de l'éditeur (échanges) — un seul moteur pour que l'aperçu ne
// mente jamais sur l'e-mail effectivement envoyé.

/** Salutation d'e-mail (SOURCE UNIQUE) : « Bonjour Prénom, » avec prénom, « Bonjour, » sans. */
export function greeting(name?: string | null): string {
  const n = name?.trim();
  return n ? `Bonjour ${n},` : "Bonjour,";
}

/** Résout les blocs conditionnels {{#if nom}}…{{/if}} (gardés si la variable est non vide). */
function applyConditionals(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_m, key, inner) =>
    (vars[key] ?? "").trim() ? inner : "",
  );
}

/**
 * Rend le corps HTML : conditionnels puis variables. Les `vars` sont échappées
 * (valeurs de confiance limitée), les `rawVars` sont injectées telles quelles
 * (HTML de confiance généré par l'app, ex. le bouton d'action `{{bouton}}`).
 */
export function renderHtmlTemplate(
  tpl: string,
  vars: Record<string, string>,
  rawVars: Record<string, string> = {},
): string {
  return applyConditionals(tpl, { ...vars, ...rawVars }).replace(/\{\{(\w+)\}\}/g, (_m, key) =>
    key in rawVars ? rawVars[key] : escapeHtml(vars[key] ?? "").replace(/\n/g, "<br>"),
  );
}

/** Rend le sujet : conditionnels puis variables brutes, sur une seule ligne. */
export function renderSubjectTemplate(tpl: string, vars: Record<string, string>): string {
  return applyConditionals(tpl, vars)
    .replace(/\{\{(\w+)\}\}/g, (_m, key) => vars[key] ?? "")
    .replace(/\s+/g, " ")
    .trim();
}
