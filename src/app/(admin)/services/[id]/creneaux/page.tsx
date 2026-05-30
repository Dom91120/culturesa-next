import Link from "next/link";

export default async function CreneauxPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="panel">
      <div className="panel-title">
        <span className="dot" />
        Créneaux
      </div>
      <p style={{ fontSize: ".85rem", color: "var(--muted)" }}>
        La gestion des créneaux se fait pour l&apos;instant dans l&apos;onglet{" "}
        <Link href={`/services/${id}`} style={{ color: "var(--accent)", textDecoration: "underline" }}>
          Paramètres
        </Link>
        . Une vue dédiée arrivera ici.
      </p>
    </div>
  );
}
