import { getConfigMany } from "@/server/config";
import { countSchoolHolidays } from "@/server/services/holidays";
import Link from "next/link";
import { ConfigurationPanel } from "./configuration-panel";

const LINKS = [
  { href: "/periods", label: "Périodes", desc: "Périodes et exercices annuels" },
  { href: "/structures", label: "Structures", desc: "Structures rattachées aux demandeurs" },
  { href: "/niveaux", label: "Niveaux", desc: "Référentiel des niveaux scolaires" },
];

export default async function ConfigurationPage() {
  const cfg = await getConfigMany(["school.zone"]);
  const zone = cfg["school.zone"] || "A";
  const holidayCount = await countSchoolHolidays(zone);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <ConfigurationPanel zone={zone} holidayCount={holidayCount} />

      <div className="panel">
        <div className="panel-title">
          <span className="dot" />
          Référentiels
        </div>
        <p style={{ fontSize: ".85rem", color: "var(--muted)", marginBottom: "1rem" }}>
          Paramètres généraux et référentiels.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: ".5rem", maxWidth: 480 }}>
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="btn btn-ghost"
              style={{
                textDecoration: "none",
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: ".15rem",
                padding: ".6rem .9rem",
              }}
            >
              <span style={{ fontWeight: 600 }}>{l.label}</span>
              <span style={{ fontSize: ".72rem", color: "var(--muted)" }}>{l.desc}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
