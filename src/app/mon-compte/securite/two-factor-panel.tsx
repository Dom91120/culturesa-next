"use client";

import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { INPUT_CHROME } from "@/components/ui-styles";
import { twoFactor } from "@/lib/auth-client";

/**
 * Enrôlement au second facteur (constat A6).
 *
 * Trois étapes, volontairement séquentielles : mot de passe → secret à enregistrer
 * dans l'application d'authentification → code de confirmation. La dernière n'est
 * pas décorative : sans elle, on activerait le second facteur d'un compte dont
 * l'usager n'a peut-être jamais réussi à enregistrer le secret — et on le
 * verrouillerait dehors à la déconnexion suivante.
 */
export function TwoFactorPanel({
  enabled,
  requis,
}: {
  enabled: boolean;
  /** Le rôle impose-t-il le second facteur ? (gestionnaire, administrateur) */
  requis: boolean;
}) {
  const router = useRouter();
  const [etape, setEtape] = useState<"repos" | "secret" | "codes">("repos");
  const [motDePasse, setMotDePasse] = useState("");
  const [code, setCode] = useState("");
  const [uri, setUri] = useState("");
  const [codesSecours, setCodesSecours] = useState<string[]>([]);
  const [erreur, setErreur] = useState("");
  const [occupe, setOccupe] = useState(false);

  /** Secret lisible, extrait de l'URI otpauth — pour une saisie manuelle. */
  const secretManuel = uri ? new URL(uri).searchParams.get("secret") : null;

  async function demarrer(e: React.FormEvent) {
    e.preventDefault();
    setErreur("");
    setOccupe(true);
    try {
      const res = await twoFactor.enable({ password: motDePasse });
      if (res.error) {
        setErreur(
          res.error.code === "INVALID_PASSWORD"
            ? "Mot de passe incorrect."
            : "Impossible de démarrer l'activation. Réessayez.",
        );
        return;
      }
      setUri(res.data?.totpURI ?? "");
      setCodesSecours(res.data?.backupCodes ?? []);
      setEtape("secret");
    } finally {
      setOccupe(false);
    }
  }

  async function confirmer(e: React.FormEvent) {
    e.preventDefault();
    setErreur("");
    setOccupe(true);
    try {
      const res = await twoFactor.verifyTotp({ code: code.trim() });
      if (res.error) {
        setErreur("Code incorrect. Vérifiez l'heure de votre téléphone, puis réessayez.");
        return;
      }
      setEtape("codes");
      router.refresh();
    } finally {
      setOccupe(false);
    }
  }

  async function desactiver(e: React.FormEvent) {
    e.preventDefault();
    setErreur("");
    setOccupe(true);
    try {
      const res = await twoFactor.disable({ password: motDePasse });
      if (res.error) {
        setErreur(
          res.error.code === "INVALID_PASSWORD"
            ? "Mot de passe incorrect."
            : "Impossible de désactiver. Réessayez.",
        );
        return;
      }
      setMotDePasse("");
      router.refresh();
    } finally {
      setOccupe(false);
    }
  }

  // ── Déjà actif ──
  if (enabled && etape !== "codes") {
    return (
      <div className="panel">
        <div className="panel-title">
          <span className="dot" />
          Double authentification — <span style={{ color: "var(--accent)" }}>activée</span>
        </div>
        <p style={{ fontSize: ".82rem", lineHeight: 1.6, marginBottom: ".9rem" }}>
          Un code à six chiffres vous est demandé à chaque connexion, en plus de votre mot de passe.
          Même si votre mot de passe était dérobé, il ne suffirait pas.
        </p>
        {requis ? (
          <p style={{ fontSize: ".8rem", color: "var(--muted)", lineHeight: 1.6 }}>
            Votre compte administrateur donne accès à l&apos;ensemble des données nominatives et aux
            opérations les plus destructrices : la double authentification est
            <strong> obligatoire</strong> et ne peut pas être désactivée.
          </p>
        ) : (
          <form onSubmit={desactiver} style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
            <input
              type="password"
              placeholder="Votre mot de passe"
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
              required
              autoComplete="current-password"
              style={{ fontSize: ".8rem", padding: ".3rem .5rem", ...INPUT_CHROME }}
            />
            <button type="submit" className="btn btn-ghost" disabled={occupe}>
              Désactiver
            </button>
            {erreur && (
              <span className="field-error" style={{ display: "block", width: "100%" }}>
                {erreur}
              </span>
            )}
          </form>
        )}
      </div>
    );
  }

  // ── Codes de secours (fin d'activation) ──
  if (etape === "codes") {
    return (
      <div className="panel">
        <div className="panel-title">
          <span className="dot" />
          Codes de secours — à conserver maintenant
        </div>
        <p style={{ fontSize: ".82rem", lineHeight: 1.6 }}>
          <strong>Ces codes ne seront plus jamais affichés.</strong> Ils sont le seul moyen de vous
          connecter si vous perdez votre téléphone. Imprimez-les ou rangez-les dans votre
          gestionnaire de mots de passe — pas sur le téléphone qui porte l&apos;application
          d&apos;authentification, sans quoi vous perdriez les deux ensemble.
        </p>
        <ul
          style={{
            fontFamily: "monospace",
            fontSize: ".9rem",
            columns: 2,
            margin: ".9rem 0",
            padding: "0 0 0 1.2rem",
          }}
        >
          {codesSecours.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setEtape("repos");
            router.refresh();
          }}
        >
          J&apos;ai conservé ces codes
        </button>
      </div>
    );
  }

  // ── Étape 2 : enregistrer le secret puis confirmer ──
  if (etape === "secret") {
    return (
      <div className="panel">
        <div className="panel-title">
          <span className="dot" />
          Double authentification — enregistrement
        </div>
        <p style={{ fontSize: ".82rem", lineHeight: 1.6 }}>
          Dans votre application d&apos;authentification (Google Authenticator, FreeOTP, Aegis,
          1Password…), ajoutez un compte en scannant ce code :
        </p>
        {/* Fond blanc explicite : en thème sombre, un QR code sur fond foncé
            devient illisible pour la plupart des appareils photo. */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            background: "#fff",
            padding: "1rem",
            borderRadius: 8,
            margin: ".9rem auto",
            width: "fit-content",
          }}
        >
          <QRCodeSVG value={uri} size={196} level="M" marginSize={0} />
        </div>
        <p style={{ fontSize: ".78rem", color: "var(--muted)", lineHeight: 1.6 }}>
          Impossible de scanner ? Saisissez cette clé à la main :
        </p>
        <p
          style={{
            fontFamily: "monospace",
            fontSize: "1rem",
            letterSpacing: ".08em",
            wordBreak: "break-all",
            background: "var(--panel-alt, rgba(127,127,127,.08))",
            padding: ".6rem .8rem",
            borderRadius: 6,
            margin: ".8rem 0",
          }}
        >
          {secretManuel ?? uri}
        </p>
        <form onSubmit={confirmer} style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="Code à 6 chiffres"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            style={{ fontSize: ".9rem", padding: ".3rem .5rem", width: 160, ...INPUT_CHROME }}
          />
          <button type="submit" className="btn btn-primary" disabled={occupe || code.length < 6}>
            {occupe ? "Vérification…" : "Confirmer"}
          </button>
          {erreur && (
            <span className="field-error" style={{ display: "block", width: "100%" }}>
              {erreur}
            </span>
          )}
        </form>
      </div>
    );
  }

  // ── Étape 1 : mot de passe ──
  return (
    <div className="panel">
      <div className="panel-title">
        <span className="dot" />
        Double authentification
      </div>
      {requis && (
        <p
          style={{
            fontSize: ".82rem",
            lineHeight: 1.6,
            borderLeft: "3px solid var(--accent)",
            paddingLeft: ".7rem",
            marginBottom: ".9rem",
          }}
        >
          Votre compte administrateur donne accès à l&apos;ensemble des données nominatives, y
          compris celles de mineurs. La double authentification est <strong>requise</strong> pour
          accéder à l&apos;administration.
        </p>
      )}
      <p style={{ fontSize: ".82rem", lineHeight: 1.6, marginBottom: ".9rem" }}>
        Un code à six chiffres, changeant toutes les trente secondes, vous sera demandé à chaque
        connexion. Il faut une application d&apos;authentification sur votre téléphone.
      </p>
      <form onSubmit={demarrer} style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
        <input
          type="password"
          placeholder="Votre mot de passe"
          value={motDePasse}
          onChange={(e) => setMotDePasse(e.target.value)}
          required
          autoComplete="current-password"
          style={{ fontSize: ".8rem", padding: ".3rem .5rem", ...INPUT_CHROME }}
        />
        <button type="submit" className="btn btn-primary" disabled={occupe || !motDePasse}>
          {occupe ? "…" : "Activer"}
        </button>
        {erreur && (
          <span className="field-error" style={{ display: "block", width: "100%" }}>
            {erreur}
          </span>
        )}
      </form>
    </div>
  );
}
