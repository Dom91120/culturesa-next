import Link from "next/link";

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

  return (
    <div className="panel" style={{ textAlign: "center", padding: "2rem 1.5rem" }}>
      <div style={{ fontSize: "2.5rem", marginBottom: ".75rem" }}>📧</div>
      <div className="panel-title" style={{ justifyContent: "center", marginBottom: ".5rem" }}>
        <span className="dot" />
        Vérifiez votre boîte mail
      </div>
      <p style={{ fontSize: ".88rem", color: "var(--muted)", lineHeight: 1.6, marginBottom: "1.25rem" }}>
        Un e-mail de confirmation {email ? <>a été envoyé à <strong>{email}</strong></> : "vous a été envoyé"}.
        <br />
        Cliquez sur le lien qu&apos;il contient pour activer votre compte.
      </p>
      <p style={{ fontSize: ".78rem", color: "var(--muted)" }}>Le lien est valable 24 heures.</p>
      <div style={{ marginTop: "1.25rem" }}>
        <Link className="btn btn-ghost" href="/auth/login" style={{ fontSize: ".82rem", textDecoration: "none" }}>
          J&apos;ai confirmé → Se connecter
        </Link>
      </div>
    </div>
  );
}
