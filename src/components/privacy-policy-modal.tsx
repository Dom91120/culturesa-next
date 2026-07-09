"use client";

/**
 * Modale « Politique de confidentialité » (port du privacy-modal legacy, index.php).
 * Texte RGPD de la commune de Châtillon — ouvert depuis le formulaire d'inscription
 * (lien « Politique de confidentialité » de l'encart RGPD).
 */
export function PrivacyPolicyModal({ onClose }: { onClose: () => void }) {
  const p: React.CSSProperties = { marginBottom: ".75rem" };
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: fermeture au clic sur le fond (parité legacy)
    <div
      className="modal-overlay open"
      style={{ display: "flex" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-box" style={{ maxWidth: "80%", maxHeight: "80vh", overflowY: "auto" }}>
        <div className="modal-title">🔒 Politique de confidentialité</div>
        <div
          style={{
            fontSize: ".85rem",
            lineHeight: 1.6,
            color: "var(--text)",
            textAlign: "justify",
          }}
        >
          <p style={p}>
            <strong>Responsable du traitement&nbsp;:</strong> les données collectées sur ce logiciel
            sont recueillies par la commune de Châtillon (92320), elles sont enregistrées dans un
            fichier informatisé&nbsp;;
          </p>
          <p style={p}>
            <strong>Base légale&nbsp;:</strong> le traitement de vos données personnelles se fonde
            sur votre consentement&nbsp;;
          </p>
          <p style={p}>
            <strong>Finalités&nbsp;:</strong> les données sont collectées afin de pouvoir traiter
            votre demande de réservation, d&apos;en assurer la gestion et de vous contacter en vue
            de bénéficier des services et des informations concernant les activités, évènements et
            fonctionnement des structures culturelles de la Ville. Elles sont également destinées à
            des fins statistiques.
          </p>
          <p style={p}>
            <strong>Durée de conservation&nbsp;:</strong> les informations communiquées seront
            conservées jusqu&apos;à la suppression de votre compte. Les comptes inactifs (sans
            connexion) depuis plus de 2 ans peuvent être anonymisés automatiquement par
            l&apos;administration&nbsp;: les champs nom, prénom, e-mail et téléphone sont alors
            effacés, l&apos;historique de fréquentation est conservé sous forme anonyme à des fins
            statistiques&nbsp;;
          </p>
          <p style={p}>
            <strong>Destinataires&nbsp;:</strong> les données transmises sont destinées à la Maison
            des Enfants de la commune de Châtillon (92320) et aux autres services municipaux de la
            commune (ludo-médiathèque, maison des arts, finances…), ainsi qu&apos;au Trésor public
            et à la compagnie d&apos;assurance de la commune&nbsp;;
          </p>
          <p style={p}>
            <strong>Utilisation de mes données&nbsp;:</strong> la Commune s&apos;engage, afin de
            protéger la confidentialité des données personnelles recueillies, à ce que celles-ci ne
            soient pas confiées, ni cédées, ni échangées, ni revendues à des tiers (entreprises ou
            organismes) à des fins commerciales ou de prospection&nbsp;;
          </p>
          <p style={p}>
            <strong>Vos droits&nbsp;:</strong> conformément au règlement européen n°2016/679/UE sur
            la protection des données personnelles du 27/04/2016 et à la loi informatique et
            libertés n°78-17 du 06/01/1978, vous disposez d&apos;un droit d&apos;accès, de
            rectification, d&apos;effacement, de limitation du traitement et de portabilité, aux
            données vous concernant. À tout moment, vous pouvez retirer votre consentement et
            supprimer votre compte&nbsp;;
          </p>
          <p style={p}>
            <strong>Exercice de vos droits&nbsp;:</strong> ces droits s&apos;exercent sur simple
            demande adressée par courrier postal à Madame la Maire (Mairie de Châtillon-dpo 1 place
            de la Libération BP 88, 92322 Châtillon Cedex) ou par courrier électronique au délégué à
            la protection des données personnelles à l&apos;adresse suivante&nbsp;:{" "}
            <a href="mailto:dpo@chatillon92.fr" style={{ color: "inherit" }}>
              dpo@chatillon92.fr
            </a>
            &nbsp;;
          </p>
          <p>
            Pour plus d&apos;informations, vous pouvez consulter le site internet de la CNIL —
            Commission Nationale de l&apos;Informatique et des Libertés (
            <a
              href="https://www.cnil.fr"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "inherit" }}
            >
              www.cnil.fr
            </a>
            ) ou celui de la commune de Châtillon (
            <a
              href="https://www.ville-chatillon.fr"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "inherit" }}
            >
              www.ville-chatillon.fr
            </a>
            ). Si vous estimez, après cette démarche, que vos droits « Informatique et Libertés » ne
            sont pas respectés, vous avez la possibilité d&apos;introduire une réclamation auprès de
            la CNIL.
          </p>
        </div>

        <div className="btn-row" style={{ marginTop: "1.25rem" }}>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Fermer
          </button>
        </div>
        <button type="button" className="modal-close" onClick={onClose}>
          ×
        </button>
      </div>
    </div>
  );
}
