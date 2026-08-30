"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { SIDEBAR_WRAP_STYLE, SidebarBrand, SidebarToggle, UserBar } from "@/components/app-shell";
import { useSidebarCollapse } from "@/components/use-sidebar-collapse";

export type ServiceItem = { id: string; label: string; icon: string | null };
type Tab = { href: string; label: string; icon: string };

const ADMIN_TABS: Tab[] = [
  { href: "/configuration", label: "Configuration", icon: "⚙️" },
  { href: "/users", label: "Utilisateurs", icon: "👥" },
  { href: "/echanges", label: "Échanges", icon: "📨" },
  { href: "/messagerie", label: "Messagerie", icon: "✉️" },
  { href: "/taches-planifiees", label: "Tâches planifiées", icon: "⏰" },
  { href: "/rgpd", label: "RGPD", icon: "🛡️" },
  { href: "/journal", label: "Journal", icon: "📜" },
];

function serviceTabs(id: string): Tab[] {
  return [
    { href: `/services/${id}/agenda`, label: "Agenda", icon: "📆" },
    { href: `/services/${id}/editions`, label: "Éditions", icon: "📋" },
    { href: `/services/${id}/stats`, label: "Statistiques", icon: "📈" },
    { href: `/services/${id}`, label: "Paramètres", icon: "🔧" },
  ];
}

export function ConnectedShell({
  user,
  services,
  isAdmin,
  children,
}: {
  user: { name: string; email: string; role?: string };
  services: ServiceItem[];
  // Seuls les administrateurs voient l'« Administration » (Configuration, Utilisateurs,
  // Messagerie, RGPD) ; les gestionnaires se limitent à leurs services.
  isAdmin: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  // Repli sidebar (préférence persistée + fenêtre étroite), cf. useSidebarCollapse.
  const { effCollapsed, narrow, toggleSidebar } = useSidebarCollapse();

  const serviceMatch = pathname.match(/^\/services\/([^/]+)/);
  const activeServiceId = serviceMatch ? serviceMatch[1] : null;
  const adminActive = !activeServiceId && pathname !== "/mon-compte";
  // Onglets d'administration réservés aux administrateurs.
  const tabs = activeServiceId ? serviceTabs(activeServiceId) : isAdmin ? ADMIN_TABS : [];

  // Onglet actif = le href le plus long qui préfixe le chemin courant.
  let activeHref = "";
  for (const t of tabs) {
    if (
      (pathname === t.href || pathname.startsWith(`${t.href}/`)) &&
      t.href.length > activeHref.length
    ) {
      activeHref = t.href;
    }
  }

  // Mémorise le dernier sous-onglet ouvert PAR service (agenda / editions / stats / periodes…)
  // pour y revenir quand on rouvre ce service. La racine `/services/{id}` (qui redirige) n'est
  // pas mémorisée afin de conserver le dernier onglet réel.
  useEffect(() => {
    if (!activeServiceId) return;
    const prefix = `/services/${activeServiceId}/`;
    if (!pathname.startsWith(prefix)) return;
    const sub = pathname.slice(prefix.length);
    if (!sub) return;
    try {
      sessionStorage.setItem(`svc-tab:${activeServiceId}`, sub);
    } catch {}
  }, [pathname, activeServiceId]);

  // Mémorise le dernier onglet d'ADMINISTRATION ouvert (Configuration / Utilisateurs /
  // Échanges / Messagerie / Tâches planifiées / RGPD) pour y revenir via le bouton
  // « Administration ».
  useEffect(() => {
    if (!adminActive || !activeHref) return;
    try {
      sessionStorage.setItem("admin-tab", activeHref);
    } catch {}
  }, [adminActive, activeHref]);

  // Bouton « Administration » : revient sur le dernier onglet admin utilisé (défaut Configuration).
  function goToAdmin() {
    let target = "/configuration";
    try {
      const remembered = sessionStorage.getItem("admin-tab");
      if (remembered) target = remembered;
    } catch {}
    router.push(target);
  }

  // Changement de service depuis la barre latérale : on revient sur le dernier onglet ouvert
  // pour CE service ; s'il n'a jamais été visité, on conserve l'onglet courant (même onglet
  // que le service actif).
  function goToService(id: string) {
    let target = "agenda";
    try {
      const remembered = sessionStorage.getItem(`svc-tab:${id}`);
      if (remembered) {
        target = remembered;
      } else if (activeServiceId) {
        const prefix = `/services/${activeServiceId}/`;
        if (pathname.startsWith(prefix)) {
          const cur = pathname.slice(prefix.length);
          if (cur) target = cur;
        }
      }
    } catch {}
    router.push(`/services/${id}/${target}`);
  }

  return (
    <>
      <main>
        <div className="app-layout">
          <div
            id="service-sidebar-wrap"
            className={effCollapsed ? "collapsed" : ""}
            style={SIDEBAR_WRAP_STYLE}
          >
            <SidebarToggle narrow={narrow} toggleSidebar={toggleSidebar} />
            <SidebarBrand />

            <div className="sidebar-label">Services</div>
            <div id="service-sidebar">
              {/* Sidebar repliée : seuls les icônes restent visibles → info-bulle native
                  (title) avec le libellé au survol. Dépliée : pas de title (redondant). */}
              {services.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={activeServiceId === s.id ? "active" : ""}
                  title={effCollapsed ? s.label : undefined}
                  onClick={() => goToService(s.id)}
                >
                  <span className="sb-icon">{s.icon || "📄"}</span>
                  <span className="sb-label">{s.label}</span>
                </button>
              ))}

              {isAdmin && (
                <button
                  type="button"
                  id="sidebar-admin-btn"
                  className={`sidebar-admin-btn${adminActive ? " active" : ""}`}
                  style={{ marginTop: "1rem" }}
                  title={effCollapsed ? "Administration" : undefined}
                  onClick={goToAdmin}
                >
                  <span className="sb-icon">⚙️</span>
                  <span className="sb-label">Administration</span>
                </button>
              )}

              {/* (Plus d'entrée « Mon compte » ici : elle vit dans le menu du bloc
                  utilisateur ci-dessous — elle figurait en double, Dom 2026-08-30.) */}
            </div>

            {/* Barre utilisateur épinglée en BAS de la sidebar (cf. UserBar). */}
            <UserBar user={user} />
          </div>

          <div className="app-main">
            <div className="tabs-nav">
              {tabs.map((t) => (
                <button
                  key={t.href}
                  type="button"
                  className={`tab-nav-btn${t.href === activeHref ? " active" : ""}`}
                  onClick={() => router.push(t.href)}
                >
                  <span className="tab-icon">{t.icon}</span> {t.label}
                </button>
              ))}
            </div>
            {children}
          </div>
        </div>
      </main>
    </>
  );
}
