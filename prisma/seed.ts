/**
 * Seed CultuRésa — données de démonstration (équivalent à install/culturesa.sql).
 * Idempotent : peut être relancé sans dupliquer.
 *   pnpm db:seed
 */
import { prisma } from "@/server/db";
import { auth } from "@/server/auth";

async function main() {
  // ── Demandeurs ──
  const demandeurs = [
    { id: 1, label: "Ecole maternelle" },
    { id: 2, label: "Ecole élémentaire" },
    { id: 3, label: "Accueil de loisir maternel" },
    { id: 4, label: "Accueil de loisir élémentaire" },
    { id: 5, label: "Assistante maternelle" },
  ];
  for (const d of demandeurs) {
    await prisma.demandeur.upsert({ where: { id: d.id }, update: {}, create: d });
  }

  // ── Niveaux scolaires ──
  const niveaux = [
    { id: 1, label: "Petit", demandeurId: 1, position: 0 },
    { id: 2, label: "Moyen", demandeurId: 1, position: 1 },
    { id: 3, label: "Grand", demandeurId: 1, position: 2 },
    { id: 4, label: "CP", demandeurId: 2, position: 3 },
    { id: 5, label: "CE1", demandeurId: 2, position: 4 },
    { id: 6, label: "CE2", demandeurId: 2, position: 5 },
    { id: 7, label: "CM1", demandeurId: 2, position: 6 },
    { id: 8, label: "CM2", demandeurId: 2, position: 7 },
  ];
  for (const n of niveaux) {
    await prisma.niveau.upsert({ where: { id: n.id }, update: {}, create: n });
  }

  // ── Vacances scolaires (zone C — à ajuster selon l'académie) ──
  const holidays = [
    { id: 24, zone: "C", dateStart: "2025-07-04", dateEnd: "2025-08-31", label: "Vacances d'Été" },
    { id: 25, zone: "C", dateStart: "2025-12-19", dateEnd: "2026-01-04", label: "Vacances de Noël" },
    { id: 20, zone: "C", dateStart: "2026-02-20", dateEnd: "2026-03-08", label: "Vacances d'Hiver" },
    { id: 21, zone: "C", dateStart: "2026-04-17", dateEnd: "2026-05-03", label: "Vacances de Printemps" },
    { id: 26, zone: "C", dateStart: "2026-07-03", dateEnd: "2026-08-30", label: "Vacances d'Été" },
    { id: 27, zone: "C", dateStart: "2026-10-16", dateEnd: "2026-11-01", label: "Vacances de la Toussaint" },
  ];
  for (const h of holidays) {
    await prisma.schoolHoliday.upsert({
      where: { id: h.id },
      update: {},
      create: {
        id: h.id,
        zone: h.zone,
        dateStart: new Date(h.dateStart),
        dateEnd: new Date(h.dateEnd),
        label: h.label,
      },
    });
  }

  // ── Périodes par défaut (année scolaire 2025-2026) ──
  const periods = [
    { id: 1, label: "Période 1", dateStart: "2025-09-01", dateEnd: "2025-12-31", color: "#6dceaa", position: 1 },
    { id: 2, label: "Période 2", dateStart: "2026-01-01", dateEnd: "2026-03-31", color: "#e8a45a", position: 2 },
    { id: 3, label: "Période 3", dateStart: "2026-04-01", dateEnd: "2026-06-30", color: "#a07dd4", position: 3 },
  ];
  for (const p of periods) {
    await prisma.period.upsert({
      where: { id: p.id },
      update: {},
      create: {
        id: p.id,
        label: p.label,
        dateStart: new Date(p.dateStart),
        dateEnd: new Date(p.dateEnd),
        color: p.color,
        position: p.position,
      },
    });
  }

  // ── Services de démonstration ──
  const services = [
    { id: "svc_001", label: "Visite guidée", position: 1 },
    { id: "svc_002", label: "Atelier créatif", position: 2 },
  ];
  for (const s of services) {
    await prisma.service.upsert({ where: { id: s.id }, update: {}, create: s });
  }

  // ── Créneaux récurrents par défaut ──
  const slots = [
    { id: "matin", serviceId: "svc_001", startTime: "09:30", endTime: "11:00" },
    { id: "aprem", serviceId: "svc_001", startTime: "14:00", endTime: "15:30" },
    { id: "matin2", serviceId: "svc_002", startTime: "09:30", endTime: "11:00" },
    { id: "aprem2", serviceId: "svc_002", startTime: "14:00", endTime: "15:30" },
  ];
  for (const sl of slots) {
    await prisma.slot.upsert({
      where: { id: sl.id },
      update: {},
      create: { ...sl, slotType: "recurring" },
    });
  }

  // ── Compte administrateur par défaut (mot de passe : Admin1234!) ──
  const adminEmail = "admin@culturesa.fr";
  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!existing) {
    const ctx = await auth.$context;
    const passwordHash = await ctx.password.hash("Admin1234!");
    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        emailVerified: true,
        name: "Admin CultuRésa",
        prenom: "Admin",
        nom: "CultuRésa",
        role: "administrateur",
        rgpdOk: true,
      },
    });
    await prisma.account.create({
      data: {
        accountId: admin.id,
        providerId: "credential",
        userId: admin.id,
        password: passwordHash,
      },
    });
    console.log(`✓ Admin créé : ${adminEmail} / Admin1234!`);
  } else {
    console.log(`• Admin déjà présent : ${adminEmail}`);
  }

  console.log("✓ Seed terminé.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
