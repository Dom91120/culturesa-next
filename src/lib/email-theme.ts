// Habillage HTML des e-mails — thème « Ville de Châtillon » (vert foncé + vert anis
// + fond vert pâle). Mise en page table + styles inline pour la compatibilité des
// clients mail, avec un <style> complémentaire pour les clients qui le supportent.
// Module pur (aucune dépendance serveur) : utilisable côté serveur (envoi) ET client
// (aperçu de l'éditeur). Le `innerHtml` est le corps du message (rendu des gabarits).

const THEME = {
  pageBg: "#f4f6ec",
  card: "#ffffff",
  border: "#e3e8d2",
  accent: "#9fc93c", // vert anis (feuille)
  headerBg: "#eef3d6", // vert pâle (panneau)
  green: "#1e6b47", // vert foncé (titres / pied)
  text: "#1f2a22",
  muted: "#5a7a4f",
};

/** Bouton d'action (CTA) thématisé pour les e-mails — injecté en variable brute `{{bouton}}`. */
export function emailButton(href: string, label: string): string {
  const safe = href.replace(/"/g, "%22");
  return `<a href="${safe}" style="display:inline-block;background:#1e6b47;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:6px;font-weight:bold;font-family:Arial,Helvetica,sans-serif;">${label}</a>`;
}

export function wrapEmailHtml(
  innerHtml: string,
  opts?: { preheader?: string; logoSrc?: string },
): string {
  const t = THEME;
  // Source du logo : par défaut la pièce jointe inline CID (e-mails réels) ; l'aperçu
  // de l'éditeur passe l'URL publique "/email-logo.png".
  const logoSrc = opts?.logoSrc ?? "cid:culturesa-logo";
  const preheader = opts?.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${opts.preheader}</div>`
    : "";
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<style>
  a { color: ${t.green}; }
  .em-body h1, .em-body h2, .em-body h3 { color: ${t.green}; margin: 0 0 12px; line-height: 1.25; }
  .em-body p { margin: 0 0 12px; }
  .em-body ul, .em-body ol { margin: 0 0 12px 20px; padding: 0; }
  .em-body li { margin: 4px 0; }
  .em-body blockquote { margin: 0 0 12px; padding-left: 12px; border-left: 3px solid ${t.accent}; color: ${t.muted}; }
  .em-body table { border-collapse: collapse; }
  .em-body td, .em-body th { border: 1px solid ${t.border}; padding: 6px 10px; }
  .em-body img { max-width: 100%; height: auto; }
</style>
</head>
<body style="margin:0;padding:0;background:${t.pageBg};">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${t.pageBg};padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${t.card};border:1px solid ${t.border};border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
      <tr><td style="height:6px;background:${t.accent};font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td style="background:${t.headerBg};padding:18px 28px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:middle;width:1px;white-space:nowrap;"><img src="${logoSrc}" alt="Ville de Châtillon" height="54" style="display:block;border:0;height:54px;width:auto;"></td>
          <td style="vertical-align:middle;padding-left:14px;font-size:20px;font-weight:bold;color:${t.green};font-family:Arial,Helvetica,sans-serif;">Ville de Châtillon</td>
          <td align="right" style="font-size:12px;color:${t.muted};font-family:Arial,Helvetica,sans-serif;letter-spacing:.04em;vertical-align:middle;">CultuRésa</td>
        </tr></table>
      </td></tr>
      <tr><td class="em-body" style="padding:28px;font-size:15px;line-height:1.6;color:${t.text};font-family:Arial,Helvetica,sans-serif;">
${innerHtml}
      </td></tr>
      <tr><td style="background:${t.green};padding:16px 28px;color:${t.headerBg};font-size:12px;line-height:1.5;font-family:Arial,Helvetica,sans-serif;">
        Ville de Châtillon — service CultuRésa<br>
        Message automatique, merci de ne pas répondre à cet e-mail.
      </td></tr>
    </table>
    <div style="font-size:11px;color:${t.muted};padding:12px;font-family:Arial,Helvetica,sans-serif;">© Ville de Châtillon</div>
  </td></tr>
</table>
</body>
</html>`;
}
