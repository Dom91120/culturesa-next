/**
 * Seed d'INSTALLATION — CultuRésa.
 *
 * Initialise une base VIERGE pour une mise en service sur un nouveau serveur :
 *   - les référentiels SYSTÈME d'e-mails (déclencheurs + types intégrés), requis
 *     pour que l'onglet Administration › Échanges et l'envoi des e-mails fonctionnent ;
 *   - UN SEUL compte administrateur (email/mot de passe lus dans l'environnement).
 *
 * AUCUNE donnée de démonstration (demandeurs, structures, niveaux, vacances,
 * services, périodes, créneaux, usagers fictifs, réservations). Tout le reste se
 * crée ensuite depuis l'interface d'administration. Pour un jeu de démo complet,
 * utiliser `pnpm db:seed` (prisma/seed.ts) à la place.
 *
 * Idempotent : relançable sans dupliquer ni écraser le contenu édité par l'admin.
 *
 *   ADMIN_EMAIL=admin@mon-asso.fr ADMIN_PASSWORD='MotDePasse12!' pnpm db:init
 */
import { defaultMailTypes, SYSTEM_MAIL_KINDS } from "@/app/(admin)/echanges/mail-rows";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db";
import { defaultMailTriggers } from "@/server/services/mail-prefs";
import { DEFAULT_TEMPLATES } from "@/server/services/mail-templates";

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

async function seedMailReferentials() {
  // ── Déclencheurs d'e-mails (référentiel persisté en base) ──
  const triggers = defaultMailTriggers();
  for (const t of triggers) {
    await prisma.mailTrigger.upsert({
      where: { key: t.key },
      update: { label: t.label, defaultKind: t.defaultKind, position: t.position },
      create: { key: t.key, label: t.label, defaultKind: t.defaultKind, position: t.position },
    });
  }
  console.log(`✓ ${triggers.length} déclencheurs d'e-mails (référentiel).`);

  // ── Types d'e-mail INTÉGRÉS (lignes globales de mail_types : métadonnées + contenu) ──
  const systemSet = new Set<string>(SYSTEM_MAIL_KINDS);
  const mailTypes = defaultMailTypes();
  let mtPos = 0;
  for (const { key, meta } of mailTypes) {
    mtPos += 1;
    const def = (DEFAULT_TEMPLATES as Record<string, { subject: string; html: string }>)[key];
    await prisma.mailType.upsert({
      where: { serviceId_key: { serviceId: "", key } },
      // Le CONTENU n'est PAS écrasé à la mise à jour → préserve les éditions admin.
      update: {
        label: meta.label,
        description: meta.description,
        recipient: meta.recipient,
        builtin: true,
        system: systemSet.has(key),
        position: mtPos,
      },
      create: {
        serviceId: "",
        key,
        label: meta.label,
        description: meta.description,
        recipient: meta.recipient,
        subject: def?.subject ?? "",
        html: def?.html ?? "",
        builtin: true,
        system: systemSet.has(key),
        position: mtPos,
      },
    });
  }
  console.log(`✓ ${mailTypes.length} types d'e-mail intégrés (métadonnées + contenu).`);
}

async function seedAdmin() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error(
      "ADMIN_EMAIL et ADMIN_PASSWORD doivent être définis dans l'environnement " +
        "(ex. dans .env) pour créer le compte administrateur.",
    );
  }
  if (ADMIN_PASSWORD.length < 12) {
    throw new Error("ADMIN_PASSWORD doit faire au moins 12 caractères.");
  }

  // Idempotent : crée le compte admin s'il est absent ; sinon ne touche PAS au
  // profil existant (on (re)cale seulement le mot de passe sur la valeur fournie).
  const ctx = await auth.$context;
  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: {},
    create: {
      email: ADMIN_EMAIL,
      emailVerified: true,
      name: "Admin ADMIN",
      prenom: "Admin",
      nom: "ADMIN",
      role: "administrateur",
      rgpdOk: true,
    },
  });

  const hash = await ctx.password.hash(ADMIN_PASSWORD);
  const cred = await prisma.account.findFirst({
    where: { userId: admin.id, providerId: "credential" },
  });
  if (cred) {
    await prisma.account.update({ where: { id: cred.id }, data: { password: hash } });
  } else {
    await prisma.account.create({
      data: { accountId: admin.id, providerId: "credential", userId: admin.id, password: hash },
    });
  }
  console.log(`✓ Compte administrateur : ${ADMIN_EMAIL}`);
}

async function main() {
  await seedMailReferentials();
  await seedAdmin();
  console.log("✓ Initialisation terminée (base prête, compte admin uniquement).");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? `✗ ${e.message}` : e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
