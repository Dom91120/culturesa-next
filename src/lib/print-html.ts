/**
 * Imprime un document HTML autonome SANS pop-up : le HTML est injecté dans un iframe
 * caché (srcdoc, même origine), dont on déclenche l'impression — `print()` sur l'iframe
 * n'imprime QUE son document, sans toucher à la page hôte. L'iframe est retiré après
 * l'impression (`afterprint`), avec un filet de sécurité.
 *
 * Avantages vs `window.open` : aucune fenêtre visible, aucun bloqueur de pop-ups, pas de
 * script inline (l'impression est déclenchée depuis la page hôte → compatible CSP).
 *
 * `html` doit être un document complet (`<!DOCTYPE html>… <style>…</style> …`).
 */
export function printHtmlDocument(html: string): void {
  if (typeof document === "undefined") return;
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  iframe.onload = () => {
    const win = iframe.contentWindow;
    if (!win) {
      iframe.remove();
      return;
    }
    win.addEventListener("afterprint", () => iframe.remove());
    win.focus();
    win.print();
    // Filet de sécurité : certains navigateurs n'émettent pas toujours `afterprint`.
    setTimeout(() => iframe.remove(), 60_000);
  };
  iframe.srcdoc = html;
  document.body.appendChild(iframe);
}
