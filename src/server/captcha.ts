import { randomBytes } from "node:crypto";
import { create } from "svg-captcha";
import { hmacSign, timingSafeEqualStr } from "@/server/crypto";
import { prisma } from "@/server/db";

/**
 * CAPTCHA image auto-hébergé (port de l'ancien captcha_img.php du legacy), sans
 * service tiers ni clés. svg-captcha rend les caractères en `<path>` vectoriels
 * (la réponse n'apparaît donc pas en clair dans le markup), et le défi est lié à
 * sa vérification par un **token HMAC sans état** : aucune session ni table en BDD.
 *
 *   token = `${exp}.${nonce}.${HMAC_SHA256(secret, "REPONSE|exp|nonce")}`
 *
 * Le client renvoie ce token + la saisie utilisateur ; le serveur recalcule la
 * signature à partir de la saisie et la compare en temps constant. Un token est
 * valable `TTL_MS` puis expire.
 */

const TTL_MS = 5 * 60 * 1000; // 5 minutes
// Jeu de caractères non ambigu (ni 0/O, ni 1/I/L) — comme le legacy.
const CHAR_PRESET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const normalize = (s: string) => s.trim().toUpperCase();

// Signature du défi sous une clé dédiée au captcha (séparation de domaine, cf. server/crypto).
function sign(answer: string, exp: number, nonce: string): string {
  return hmacSign("captcha", `${normalize(answer)}|${exp}|${nonce}`);
}

// ── Anti-rejeu : un défi résolu ne doit être accepté qu'UNE fois ──
//
// Sans cela, un même couple {token, réponse} reste valide pendant tout le TTL :
// création de comptes en boucle avec un seul captcha résolu.
//
// Les nonces consommés vivaient en MÉMOIRE (constat A3). Un redémarrage du conteneur
// vidait la table : un captcha déjà résolu redevenait valide pour le reste de son TTL
// de 5 minutes. Une protection correctement conçue, annulée par un `docker compose
// restart` — et l'attaquant n'avait même pas à provoquer le redémarrage, il lui
// suffisait d'attendre le déploiement suivant.
//
// La CONSOMMATION est désormais l'INSERTION elle-même : une violation de clé primaire
// signifie « déjà servi ». Vérifier puis écrire laisserait deux requêtes simultanées
// franchir le contrôle avec le même token — l'ancienne version ne s'en tirait que par
// l'absence de point d'attente entre la lecture et l'écriture, propriété du modèle
// mono-thread de Node qu'un simple `await` inséré au mauvais endroit aurait suffi à
// détruire, sans que rien ne le signale.
async function consumeNonce(nonce: string, exp: number): Promise<boolean> {
  try {
    // `skipDuplicates` → `ON CONFLICT DO NOTHING` : `count` vaut 1 si le nonce était
    // neuf, 0 s'il avait déjà servi. Aussi atomique qu'une insertion qui échoue, mais
    // SANS exception — et c'est ce qui compte ici : un rejeu est une condition
    // ATTENDUE, pas une anomalie. La version qui rattrapait l'erreur de contrainte
    // faisait journaliser à Prisma une trace complète à chaque tentative, si bien que
    // le fonctionnement normal de la protection remplissait les journaux d'erreurs.
    // Des erreurs qui apparaissent quand tout va bien sont des erreurs qu'on cesse de
    // lire — y compris celles qui, un jour, signaleront quelque chose.
    const { count } = await prisma.captchaNonce.createMany({
      data: [{ nonce, expiresAt: new Date(exp) }],
      skipDuplicates: true,
    });
    return count === 1;
  } catch (e) {
    // ÉCHEC FERMÉ : ne pas pouvoir enregistrer la consommation, c'est ne pas pouvoir
    // garantir l'unicité. Accepter le captcha « en attendant » rendrait l'anti-rejeu
    // inopérant précisément quand la base vacille.
    console.error("[captcha] consommation du nonce impossible, défi refusé:", e);
    return false;
  }
}

/** Purge des nonces expirés (tâche de rétention). */
export async function purgeExpiredCaptchaNonces(): Promise<number> {
  const { count } = await prisma.captchaNonce.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}

export function createCaptcha(): { svg: string; token: string } {
  const { text, data } = create({
    size: 6,
    charPreset: CHAR_PRESET,
    noise: 4,
    color: false,
    inverse: true, // glyphes clairs sur fond sombre
    background: "#252933", // gris très sombre (sans virer au noir)
    width: 230,
    height: 72,
    fontSize: 56,
  });
  const exp = Date.now() + TTL_MS;
  const nonce = randomBytes(9).toString("base64url");
  return { svg: data, token: `${exp}.${nonce}.${sign(text, exp, nonce)}` };
}

export async function verifyCaptcha(
  token: string | null | undefined,
  answer: string | null | undefined,
): Promise<boolean> {
  if (!token || !answer) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expStr, nonce, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;

  // La signature est vérifiée AVANT toute écriture : sans cela, n'importe qui
  // pourrait faire grossir la table en présentant des nonces inventés.
  if (!timingSafeEqualStr(sig, sign(answer, exp, nonce))) return false;

  return consumeNonce(nonce, exp);
}
