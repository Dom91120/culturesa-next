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
  const [etape, setEtape] = useState<"repos" | "avertissement" | "secret" | "codes">("repos");
  /**
   * Réenrôlement d'un compte QUI A DÉJÀ un second facteur (nouveau téléphone, codes
   * de secours épuisés), par opposition à une première activation.
   *
   * Ce n'est pas qu'une nuance d'affichage. MESURÉ sur le vrai flux : `enable`
   * détruit l'ancien secret DÈS SON APPEL, avant toute confirmation, et le nouveau
   * n'est pas actif tant qu'il n'est pas vérifié. Entre les deux, ni l'ancien code ni
   * le nouveau ne sont acceptés — et `twoFactorEnabled` reste vrai, donc la connexion
   * en réclame toujours un. **Un réenrôlement abandonné en cours de route verrouille
   * le compte**, les codes de secours étant alors le seul recours.
   *
   * D'où deux garde-fous : un avertissement AVANT de commencer, et l'affichage des
   * nouveaux codes de secours EN MÊME TEMPS que le QR code — et non après
   * vérification comme lors d'une première activation. Ainsi, même un parcours
   * interrompu laisse une porte d'entrée à l'écran.
   */
  const [reinitialisation, setReinitialisation] = useState(false);
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
  // `etape === "repos"` et non `!== "codes"` : depuis l'ajout de la réinitialisation,
  // un compte déjà protégé traverse aussi « avertissement » puis « secret ». La
  // condition d'origine interceptait ces deux étapes et renvoyait indéfiniment sur
  // le panneau « activée » — le bouton semblait sans effet.
  if (enabled && etape === "repos") {
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
        {/* Réenrôlement : nouveau téléphone, codes de secours épuisés, ou doute sur
            le secret. Proposé À TOUS, administrateurs compris — eux ne peuvent pas
            désactiver, et sans ce bouton un changement de téléphone les obligerait à
            solliciter un autre administrateur, voire une écriture en base (cf. A6). */}
        <p style={{ fontSize: ".82rem", lineHeight: 1.6, marginBottom: ".6rem" }}>
          Nouveau téléphone, codes de secours épuisés, ou doute sur la sécurité de votre clé&nbsp;?
          Vous pouvez repartir d&apos;un nouveau code QR.
        </p>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            setErreur("");
            setMotDePasse("");
            setEtape("avertissement");
          }}
          style={{ marginBottom: requis ? ".9rem" : ".6rem" }}
        >
          🔑 Réinitialiser la double authentification
        </button>

        {requis ? (
          <p style={{ fontSize: ".8rem", color: "var(--muted)", lineHeight: 1.6 }}>
            Votre compte administrateur donne accès à l&apos;ensemble des données nominatives et aux
            opérations les plus destructrices : la double authentification est
            <strong> obligatoire</strong> et ne peut pas être désactivée — seulement réinitialisée.
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

  // ── Avertissement AVANT une réinitialisation ──
  // Sa raison d'être est mesurée, pas prudentielle : dès que le formulaire est validé,
  // l'ancien téléphone cesse de fonctionner et le nouveau n'est pas encore actif.
  // L'usager doit savoir qu'il s'engage dans un passage qu'il faut terminer.
  if (etape === "avertissement") {
    return (
      <div className="panel">
        <div className="panel-title">
          <span className="dot" />
          Réinitialiser la double authentification
        </div>
        <p style={{ fontSize: ".82rem", lineHeight: 1.6 }}>
          Vous allez enregistrer une <strong>nouvelle clé</strong> et recevoir{" "}
          <strong>dix nouveaux codes de secours</strong>.
        </p>
        <p
          style={{
            fontSize: ".82rem",
            lineHeight: 1.6,
            color: "var(--warn)",
            fontWeight: 600,
            borderLeft: "3px solid var(--warn)",
            paddingLeft: ".7rem",
            margin: ".9rem 0",
          }}
        >
          ⚠️ Dès la validation de ce formulaire, votre téléphone actuel et vos anciens codes de
          secours <strong>cessent immédiatement de fonctionner</strong> — avant même que la nouvelle
          clé ne soit confirmée. Allez jusqu&apos;au bout de la procédure, et conservez les codes de
          secours affichés à l&apos;écran suivant : ils sont votre seule issue si vous ne parvenez
          pas à scanner le code QR.
        </p>
        <p style={{ fontSize: ".8rem", color: "var(--muted)", lineHeight: 1.6 }}>
          Ayez votre application d&apos;authentification sous la main avant de continuer.
        </p>
        <form
          onSubmit={(e) => {
            setReinitialisation(true);
            demarrer(e);
          }}
          style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", marginTop: ".9rem" }}
        >
          <input
            type="password"
            placeholder="Votre mot de passe"
            value={motDePasse}
            onChange={(e) => setMotDePasse(e.target.value)}
            required
            autoComplete="current-password"
            style={{ fontSize: ".8rem", padding: ".3rem .5rem", ...INPUT_CHROME }}
          />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setMotDePasse("");
              setErreur("");
              setEtape("repos");
            }}
          >
            Annuler
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={occupe || !motDePasse}
            style={{ background: "var(--warn)", border: "none", color: "var(--text)" }}
          >
            {occupe ? "…" : "Réinitialiser"}
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

  // ── Codes de secours (fin d'activation) ──
  if (etape === "codes") {
    return (
      <div className="panel">
        <div className="panel-title">
          <span className="dot" />
          Codes de secours — à conserver maintenant
        </div>
        {/* Le conseil « rangez-les dans votre gestionnaire de mots de passe » a été
            retiré : si celui-ci contient déjà le mot de passe du compte, les DEUX
            facteurs y vivent ensemble, et une seule compromission les emporte tous
            les deux. Le second facteur ne protège plus rien. Même raisonnement que
            pour le téléphone, une couche plus loin. */}
        <p style={{ fontSize: ".82rem", lineHeight: 1.6 }}>
          <strong>Ces codes ne seront plus jamais affichés.</strong> Ils sont le seul moyen de vous
          connecter si vous perdez votre téléphone. Imprimez-les et rangez-les en lieu sûr.
        </p>
        <p style={{ fontSize: ".82rem", lineHeight: 1.6, color: "var(--warn)" }}>
          Ni sur le téléphone qui porte l&apos;application d&apos;authentification — vous perdriez
          les deux ensemble —{" "}
          <strong>ni dans le gestionnaire où se trouve votre mot de passe</strong>, sans quoi une
          seule intrusion suffirait à obtenir les deux facteurs.
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
            setReinitialisation(false);
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
          Double authentification — {reinitialisation ? "nouvelle clé" : "enregistrement"}
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
        {/* RÉINITIALISATION : les codes sont affichés ICI, et non après vérification.
            L'ancien facteur est déjà mort à ce stade ; si l'usager s'interrompt
            maintenant, ces dix codes sont sa seule entrée. Les réserver à l'écran
            suivant reviendrait à ne les donner qu'à ceux qui n'en ont pas besoin. */}
        {reinitialisation && codesSecours.length > 0 && (
          <div
            style={{
              borderLeft: "3px solid var(--warn)",
              paddingLeft: ".7rem",
              margin: "1rem 0",
            }}
          >
            <p style={{ fontSize: ".82rem", lineHeight: 1.6, fontWeight: 600 }}>
              Vos nouveaux codes de secours —{" "}
              <span style={{ color: "var(--warn)" }}>notez-les maintenant</span>
            </p>
            <p style={{ fontSize: ".78rem", color: "var(--muted)", lineHeight: 1.6 }}>
              Vos anciens codes ne fonctionnent plus. Si vous quittez cette page sans confirmer,
              ceux-ci seront votre seul moyen de vous reconnecter.
            </p>
            <ul
              style={{
                fontFamily: "monospace",
                fontSize: ".9rem",
                columns: 2,
                margin: ".6rem 0",
                padding: "0 0 0 1.2rem",
              }}
            >
              {codesSecours.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        )}
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
