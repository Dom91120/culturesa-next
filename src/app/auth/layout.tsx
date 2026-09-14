import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Cadre commun des écrans d'authentification (connexion, inscription, mot de passe
 * oublié / réinitialisation, vérification d'e-mail, suppression de compte). Refonte
 * Dom 2026-09-14 : même grammaire que le shell connecté — volet sombre à gauche aux
 * couleurs de la sidebar (logo, accroche, bascule de thème en bas, à la place de la
 * barre utilisateur), contenu au thème courant à droite. Styles : `.auth-*` dans
 * app-legacy.css ; en mobile le volet devient un bandeau.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-shell">
      <aside className="auth-brand">
        <div>
          <div className="logo">
            Cultu<em>Résa</em>
          </div>
          <div className="tagline">Réservation d&apos;activités culturelles</div>
        </div>
        <div className="auth-brand-body">
          <div className="auth-brand-title">
            Vos créneaux culturels,
            <br />
            réservés <em>en quelques clics</em>.
          </div>
          <ul className="auth-brand-list">
            <li>
              <span className="dot" />
              <span>Choisissez un service et un créneau directement dans l&apos;agenda.</span>
            </li>
            <li>
              <span className="dot" />
              <span>Suivez la validation de vos demandes en temps réel.</span>
            </li>
            <li>
              <span className="dot" />
              <span>Recevez vos confirmations par e-mail.</span>
            </li>
          </ul>
        </div>
        <div className="auth-brand-foot">
          <span>Espace usagers &amp; gestionnaires</span>
          <ThemeToggle />
        </div>
      </aside>
      <main className="auth-main">{children}</main>
    </div>
  );
}
