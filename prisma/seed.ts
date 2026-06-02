import { auth } from "@/server/auth";
/**
 * Seed CultuRésa — données de démonstration (équivalent à install/culturesa.sql).
 * Idempotent : peut être relancé sans dupliquer.
 *   pnpm db:seed
 */
import { prisma } from "@/server/db";

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
    {
      id: 25,
      zone: "C",
      dateStart: "2025-12-19",
      dateEnd: "2026-01-04",
      label: "Vacances de Noël",
    },
    {
      id: 20,
      zone: "C",
      dateStart: "2026-02-20",
      dateEnd: "2026-03-08",
      label: "Vacances d'Hiver",
    },
    {
      id: 21,
      zone: "C",
      dateStart: "2026-04-17",
      dateEnd: "2026-05-03",
      label: "Vacances de Printemps",
    },
    { id: 26, zone: "C", dateStart: "2026-07-03", dateEnd: "2026-08-30", label: "Vacances d'Été" },
    {
      id: 27,
      zone: "C",
      dateStart: "2026-10-16",
      dateEnd: "2026-11-01",
      label: "Vacances de la Toussaint",
    },
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

  // ── Services de démonstration ──
  // (créés avant les périodes : chaque période est rattachée à un service)
  const services = [
    { id: "svc_001", label: "Visite guidée", position: 1 },
    { id: "svc_002", label: "Atelier créatif", position: 2 },
  ];
  for (const s of services) {
    await prisma.service.upsert({ where: { id: s.id }, update: {}, create: s });
  }

  // ── Périodes par défaut (année scolaire 2025-2026) ──
  // Rattachées à CHAQUE service : pas de période globale (serviceId null).
  // svc_001 → ids 1-3, svc_002 → ids 4-6 (les réservations de démo ciblent l'id 1).
  const periodDefs = [
    {
      label: "Période 1",
      dateStart: "2025-09-01",
      dateEnd: "2025-12-31",
      color: "#6dceaa",
      position: 1,
    },
    {
      label: "Période 2",
      dateStart: "2026-01-01",
      dateEnd: "2026-03-31",
      color: "#e8a45a",
      position: 2,
    },
    {
      label: "Période 3",
      dateStart: "2026-04-01",
      dateEnd: "2026-06-30",
      color: "#a07dd4",
      position: 3,
    },
  ];
  let periodId = 1;
  for (const s of services) {
    for (const p of periodDefs) {
      await prisma.period.upsert({
        where: { id: periodId },
        update: {},
        create: {
          id: periodId,
          serviceId: s.id,
          label: p.label,
          dateStart: new Date(p.dateStart),
          dateEnd: new Date(p.dateEnd),
          color: p.color,
          position: p.position,
        },
      });
      periodId++;
    }
  }

  // ── Créneaux récurrents par défaut ──
  // Rattachés à la « Période 1 » de leur service (svc_001 → id 1, svc_002 → id 4).
  // Un créneau récurrent DOIT pointer une période : l'éditeur Créneaux filtre par
  // période, des slots à periodId null seraient invisibles.
  const slots = [
    { id: "matin", serviceId: "svc_001", periodId: 1, startTime: "09:30", endTime: "11:00" },
    { id: "aprem", serviceId: "svc_001", periodId: 1, startTime: "14:00", endTime: "15:30" },
    { id: "matin2", serviceId: "svc_002", periodId: 4, startTime: "09:30", endTime: "11:00" },
    { id: "aprem2", serviceId: "svc_002", periodId: 4, startTime: "14:00", endTime: "15:30" },
  ];
  for (const sl of slots) {
    await prisma.slot.upsert({
      where: { id: sl.id },
      update: { periodId: sl.periodId },
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

  // ── Données de démo pour l'Agenda (réservations récurrentes) ──
  // Capacité des créneaux svc_001 (pour la jauge).
  await prisma.slot.updateMany({
    where: { id: { in: ["matin", "aprem"] } },
    data: { capacity: 15 },
  });
  // Démo capacité par jour : Lundi matin plafonné à 6 (au lieu de 15).
  await prisma.slot.update({ where: { id: "matin" }, data: { capLun: 6 } });

  const demoUsers = [
    { email: "huppert@demo.fr", prenom: "Isabelle", nom: "HUPPERT", demandeurId: 5 },
    { email: "adjani@demo.fr", prenom: "Isabelle", nom: "ADJANI", demandeurId: 5 },
  ];
  const userIds: Record<string, string> = {};
  for (const u of demoUsers) {
    const created = await prisma.user.upsert({
      where: { email: u.email },
      update: { prenom: u.prenom, nom: u.nom, demandeurId: u.demandeurId },
      create: {
        email: u.email,
        emailVerified: true,
        name: `${u.prenom} ${u.nom}`,
        prenom: u.prenom,
        nom: u.nom,
        role: "utilisateur",
        rgpdOk: true,
        demandeurId: u.demandeurId,
      },
    });
    userIds[u.nom] = created.id;
  }

  // Repart d'une base propre pour les résa de démo (évite les doublons si la
  // semaine A/B change entre deux exécutions).
  await prisma.booking.deleteMany({
    where: {
      serviceId: "svc_001",
      bookingType: "recurring",
      userId: { in: Object.values(userIds) },
    },
  });

  // Démo semaine A/B : HUPPERT lundi matin est en semaine A (les autres = toutes
  // semaines). Le service svc_001 est activé en mode A/B plus bas.
  const demoBookings = [
    {
      user: "HUPPERT",
      slotId: "matin",
      dayKey: "lun",
      enfants: 4,
      theme: "La côte de bœuf",
      week: "A",
    },
    { user: "ADJANI", slotId: "matin", dayKey: "mar", enfants: 9, theme: "Le chocolat", week: "" },
    {
      user: "HUPPERT",
      slotId: "aprem",
      dayKey: "jeu",
      enfants: 6,
      theme: "Atelier nature",
      week: "",
    },
  ];
  for (const b of demoBookings) {
    const userId = userIds[b.user];
    await prisma.booking.upsert({
      where: {
        uq_recurring: {
          userId,
          serviceId: "svc_001",
          slotId: b.slotId,
          periodId: 1,
          dayKey: b.dayKey,
          week: b.week,
        },
      },
      update: { enfants: b.enfants, themeLabel: b.theme, validated: true },
      create: {
        bookingType: "recurring",
        userId,
        serviceId: "svc_001",
        slotId: b.slotId,
        periodId: 1,
        dayKey: b.dayKey,
        week: b.week,
        enfants: b.enfants,
        themeLabel: b.theme,
        validated: true,
        autoValidateFrom: new Date(),
      },
    });
  }
  // Active le mode semaines A/B sur svc_001 (démo).
  await prisma.service.update({ where: { id: "svc_001" }, data: { semaineAb: true } });
  console.log(`✓ Démo agenda : ${demoBookings.length} réservations récurrentes (svc_001 en A/B).`);

  // ── Resync des séquences d'auto-increment ──
  // Les blocs ci-dessus insèrent des id EXPLICITES (1, 2, 3…) sans faire avancer
  // la séquence Postgres. Sans ce rattrapage, la 1ère création via l'app (id
  // auto) réutiliserait un id déjà pris → violation de contrainte unique.
  // setval(seq, MAX(id)) cale la séquence ; le prochain nextval renverra MAX+1.
  // Si la table est vide, on remet la séquence à 1 avec is_called=false.
  await resyncSequences();
  console.log("✓ Séquences d'auto-increment resynchronisées.");

  console.log("✓ Seed terminé.");
}

/**
 * Recale les séquences SERIAL des tables peuplées avec des id explicites.
 * pg_get_serial_sequence résout le nom réel de la séquence (robuste au renommage).
 */
async function resyncSequences() {
  const tables = ["demandeurs", "niveaux", "school_holidays", "periods"];
  for (const table of tables) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(
         pg_get_serial_sequence('"${table}"', 'id'),
         COALESCE((SELECT MAX(id) FROM "${table}"), 1),
         (SELECT COUNT(*) > 0 FROM "${table}")
       )`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
