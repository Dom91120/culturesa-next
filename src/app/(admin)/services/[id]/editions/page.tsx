import { notFound } from "next/navigation";
import { DownloadGlyph, UsersGlyph } from "@/app/(admin)/users/account-ui";
import {
  ArrowUpRightGlyph,
  CalendarTimeGlyph,
  ChartBarGlyph,
  CircleCheckGlyph,
  ClockGlyph,
  HistoryGlyph,
  HourglassGlyph,
  InfoGlyph,
  ListDetailsGlyph,
  MailGlyph,
  PrinterGlyph,
  TargetGlyph,
} from "@/components/ui-glyphs";
import { todayParisISO } from "@/lib/booking-delay";
import { prisma } from "@/server/db";
import { listDatedSessions, listInscrits, listOpenSlots } from "@/server/services/editions";
import { listWaitingEntries } from "@/server/services/waiting-list";
import { listWaitingHistory, waitingDemand } from "@/server/services/waiting-list-editions";
import { ExerciceNav } from "./exercice-nav";
import { parseYmd, resolveEditionExercice, ymd } from "./range";

// ════════════════════════════════════════════════════════════════════════════
//  Onglet Éditions d'un service — refonte Dom 2026-09-09 : cartes groupées par usage
//  (sur l'exercice / par semaine ou période / liste d'attente : état du jour et
//  exercice), pictogramme teinté, chiffre du jour, formats en pastilles, téléchargement
//  CSV direct et « Ouvrir » révélés au survol, sélecteur d'exercice en tête qui
//  pré-règle les écrans ouverts depuis la page.
// ════════════════════════════════════════════════════════════════════════════

type Tone = "ok" | "info" | "warn" | "neutral" | "purple";

type Card = {
  key: string;
  icon: React.ReactNode;
  tone: Tone;
  label: string;
  description: string;
  /** Chiffre du jour : valeur en gras + complément en gris. */
  figure: { value: string; unit: string } | null;
  href: string;
  /** Téléchargement CSV direct (sans passer par l'écran), ou null. */
  csv: string | null;
  /** Bouton de copie des adresses plutôt que téléchargement (adresses des inscrits). */
  pdf: boolean;
};

const fmt = (n: number) => n.toLocaleString("fr-FR");
const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

export default async function EditionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ exercice?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [service, exo] = await Promise.all([
    prisma.service.findUnique({ where: { id }, select: { label: true, listeAttente: true } }),
    resolveEditionExercice(id, sp.exercice),
  ]);
  if (!service) notFound();
  const { exercices, selected } = exo;
  const periodIds = selected?.periodIds;
  const q = selected ? `?exercice=${selected.id}` : "";
  const qAnd = selected ? `&exercice=${selected.id}` : "";

  // Éditions de la liste d'attente : proposées si le réglage est actif, ou s'il reste un
  // historique à consulter (liste désactivée depuis).
  const withWaitlist =
    service.listeAttente || (await prisma.waitingListLog.count({ where: { serviceId: id } })) > 0;

  // ── Chiffres du jour (scope exercice, sauf l'état du jour de la liste d'attente) ──
  const today = todayParisISO();
  const todayDate = parseYmd(today);
  const dow = (todayDate.getUTCDay() + 6) % 7; // 0 = lundi
  const monday = new Date(todayDate);
  monday.setUTCDate(monday.getUTCDate() - dow);
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  // Séances passées à pointer : fenêtre de 30 jours, participants sans pointage.
  const back30 = new Date(todayDate);
  back30.setUTCDate(back30.getUTCDate() - 30);
  const yesterday = new Date(todayDate);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  const [inscrits, slots, reservations, weekSessions, pastSessions] = await Promise.all([
    listInscrits(id, periodIds),
    listOpenSlots(id, periodIds),
    prisma.booking.count({
      where: { serviceId: id, ...(periodIds ? { slot: { periodId: { in: periodIds } } } : {}) },
    }),
    listDatedSessions(id, ymd(monday), ymd(sunday), periodIds),
    listDatedSessions(id, ymd(back30), ymd(yesterday), periodIds),
  ]);
  const toPoint = pastSessions.filter((s) => s.attendees.some((a) => a.pointage === null)).length;

  const waitlist = withWaitlist
    ? await (async () => {
        const [entries, demand, history] = await Promise.all([
          listWaitingEntries(id),
          waitingDemand(id),
          listWaitingHistory(
            id,
            selected ? { from: selected.dateStart, to: selected.dateEnd } : undefined,
          ),
        ]);
        // Demi-journée la plus demandée (ex. « mer. matin »).
        let top: { label: string; n: number } | null = null;
        for (const d of demand.byHalfDay) {
          for (const [half, v] of [
            ["matin", d.am],
            ["après-midi", d.pm],
          ] as const) {
            if (v.total > 0 && (!top || v.total > top.n)) {
              top = { label: `${d.label.slice(0, 3).toLowerCase()}. ${half}`, n: v.total };
            }
          }
        }
        const placed = history.filter((r) => r.issue === "AUTO_BOOKED" || r.issue === "BOOKED");
        const avg =
          placed.length > 0
            ? Math.round(placed.reduce((s, r) => s + r.delaiJours, 0) / placed.length)
            : null;
        return { entries: entries.length, top, closed: history.length, placed: placed.length, avg };
      })()
    : null;

  // ── Cartes ──
  const base = `/services/${id}/editions`;
  const csv = (kind: string) => `${base}/export?kind=${kind}${qAnd}`;

  const onExercice: Card[] = [
    {
      key: "inscrits",
      icon: <UsersGlyph size={14} />,
      tone: "ok",
      label: "Liste des inscrits",
      description:
        "Les usagers ayant réservé sur l'exercice : identité, structure, niveau et contact.",
      figure: { value: fmt(inscrits.length), unit: plural(inscrits.length, "inscrit", "inscrits") },
      href: `${base}/inscrits${q}`,
      csv: csv("inscrits"),
      pdf: true,
    },
    {
      key: "creneaux",
      icon: <ClockGlyph size={14} />,
      tone: "info",
      label: "Créneaux ouverts",
      description:
        "L'offre du service : les créneaux proposés sur l'exercice, horaires, places et demandeurs.",
      figure: { value: fmt(slots.length), unit: plural(slots.length, "créneau", "créneaux") },
      href: `${base}/creneaux${q}`,
      csv: csv("creneaux"),
      pdf: true,
    },
    {
      key: "liste",
      icon: <ListDetailsGlyph size={14} />,
      tone: "info",
      label: "Réservations",
      description:
        "Toutes les réservations du service : période, date, créneau, participant, statut, pointage.",
      figure: {
        value: fmt(reservations),
        unit: plural(reservations, "réservation", "réservations"),
      },
      href: `${base}/liste${q}`,
      csv: csv("reservations"),
      pdf: true,
    },
  ];

  const byRange: Card[] = [
    {
      key: "planning",
      icon: <CalendarTimeGlyph size={14} />,
      tone: "purple",
      label: "Plannings",
      description:
        "Vue par jour des séances d'une semaine, d'un mois ou d'un trimestre, avec les participants.",
      figure: {
        value: fmt(weekSessions.length),
        unit: `${plural(weekSessions.length, "séance", "séances")} cette semaine`,
      },
      href: `${base}/planning${q}`,
      csv: null,
      pdf: true,
    },
    {
      key: "pointages",
      icon: <CircleCheckGlyph size={14} />,
      tone: "purple",
      label: "Pointages",
      description:
        "Feuille de présence par séance, avec les motifs d'absence et les absences prévenues.",
      figure: {
        value: fmt(toPoint),
        unit: `${plural(toPoint, "séance", "séances")} à pointer sur 30 jours`,
      },
      href: `${base}/pointages${q}`,
      csv: null,
      pdf: true,
    },
  ];

  const waitToday: Card[] = waitlist
    ? [
        {
          key: "attente",
          icon: <HourglassGlyph size={14} />,
          tone: "warn",
          label: "Liste en cours",
          description:
            "Les inscrits du jour dans l'ordre d'inscription : disponibilités, périodes, réservation automatique, échéance.",
          figure: { value: fmt(waitlist.entries), unit: "en attente" },
          href: `${base}/attente${q}`,
          csv: csv("attente"),
          pdf: true,
        },
        {
          key: "attente-demande",
          icon: <ChartBarGlyph size={14} />,
          tone: "warn",
          label: "Demande par demi-journée",
          description:
            "Où ouvrir un créneau ferait le plus d'heureux : disponibilités déclarées par demi-journée et par période.",
          figure: waitlist.top
            ? { value: waitlist.top.label, unit: `la plus demandée (${waitlist.top.n})` }
            : { value: "—", unit: "aucune disponibilité déclarée" },
          href: `${base}/attente-demande${q}`,
          csv: csv("attente-demande"),
          pdf: true,
        },
        {
          key: "attente-adresses",
          icon: <MailGlyph size={14} />,
          tone: "warn",
          label: "Adresses des inscrits",
          description:
            "Coordonnées des inscrits du jour, avec les adresses e-mail prêtes à coller pour un envoi groupé.",
          figure: {
            value: fmt(waitlist.entries),
            unit: plural(waitlist.entries, "adresse", "adresses"),
          },
          href: `${base}/attente-adresses${q}`,
          csv: csv("attente-adresses"),
          pdf: true,
        },
      ]
    : [];

  const waitExercice: Card[] = waitlist
    ? [
        {
          key: "attente-historique",
          icon: <HistoryGlyph size={14} />,
          tone: "neutral",
          label: "Historique",
          description:
            "Toutes les inscriptions closes : issue (placé, périodes échues, retrait), délai et réservation obtenue.",
          figure: { value: fmt(waitlist.closed), unit: plural(waitlist.closed, "close", "closes") },
          href: `${base}/attente-historique${q}`,
          csv: csv("attente-historique"),
          pdf: true,
        },
        {
          key: "attente-placements",
          icon: <TargetGlyph size={14} />,
          tone: "ok",
          label: "Placements",
          description:
            "Les inscriptions qui ont abouti à une réservation, automatique ou obtenue, avec le délai et le créneau.",
          figure: {
            value: fmt(waitlist.placed),
            unit:
              waitlist.avg !== null
                ? `${plural(waitlist.placed, "placé", "placés")} · ${waitlist.avg} j en moyenne`
                : plural(waitlist.placed, "placé", "placés"),
          },
          href: `${base}/attente-placements${q}`,
          csv: csv("attente-placements"),
          pdf: true,
        },
      ]
    : [];

  return (
    <div>
      <div className="panel" id="editions-panel">
        <div
          className="panel-title"
          style={{ justifyContent: "space-between", gap: ".75rem", marginBottom: ".25rem" }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
            <span className="rg-ico is-ok">
              <PrinterGlyph size={16} />
            </span>
            Éditions
            <span style={{ color: "var(--muted)", fontWeight: 400 }}>· {service.label}</span>
          </span>
          <span className="ed-exo">
            <ExerciceNav exercices={exercices} selectedId={selected?.id ?? null} />
          </span>
        </div>

        <div className="ms-grp">
          {"Sur l'exercice"}
          <span className="hint">· listes complètes, triables, exportables</span>
        </div>
        <div className="ed-cards">{onExercice.map(renderCard)}</div>

        <div className="ms-grp">
          Par semaine ou par période
          <span className="hint">· à imprimer avant les séances</span>
        </div>
        <div className="ed-cards">{byRange.map(renderCard)}</div>
      </div>

      {waitlist && (
        <div className="panel" id="editions-attente-panel">
          <div className="panel-title" style={{ marginBottom: ".25rem" }}>
            <span style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
              <span className="rg-ico is-warn">
                <HourglassGlyph size={16} />
              </span>
              Liste d&apos;attente
              <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                · {fmt(waitlist.entries)} {plural(waitlist.entries, "inscrit", "inscrits")}{" "}
                aujourd&apos;hui
              </span>
            </span>
          </div>

          <div className="ms-grp">État du jour</div>
          <div className="ed-cards">{waitToday.map(renderCard)}</div>

          <div className="ms-grp">
            {"Sur l'exercice"}
            <span className="hint">· à lire en fin de période ou d&apos;exercice</span>
          </div>
          <div className="ed-cards">{waitExercice.map(renderCard)}</div>

          <div className="rg-foot">
            <InfoGlyph size={13} />
            <span style={{ flex: 1, lineHeight: 1.45 }}>
              Chaque édition s&apos;ouvre sur son écran, où elle s&apos;imprime en PDF et se filtre
              ; le bouton de téléchargement livre le CSV directement, sans passer par l&apos;écran.
              Les chiffres portent sur l&apos;exercice sélectionné en haut, sauf l&apos;état du jour
              de la liste d&apos;attente.
            </span>
          </div>
        </div>
      )}
      {!waitlist && (
        <div className="rg-foot" style={{ marginTop: 0 }}>
          <InfoGlyph size={13} />
          <span style={{ flex: 1, lineHeight: 1.45 }}>
            Chaque édition s&apos;ouvre sur son écran, où elle s&apos;imprime en PDF et se filtre ;
            le bouton de téléchargement livre le CSV directement, sans passer par l&apos;écran. Les
            chiffres portent sur l&apos;exercice sélectionné en haut.
          </span>
        </div>
      )}
    </div>
  );
}

const TONE_CLASS: Record<Tone, string> = {
  ok: "is-ok",
  info: "is-info",
  warn: "is-warn",
  neutral: "is-neutral",
  purple: "is-purple",
};

function renderCard(c: Card) {
  return (
    <div key={c.key} className="ed-card">
      <a href={c.href} className="ed-card-link" aria-label={`Ouvrir : ${c.label}`}>
        <span className="h">
          <span className={`rg-ico ${TONE_CLASS[c.tone]}`}>{c.icon}</span>
          {c.label}
        </span>
        <span className="d">{c.description}</span>
      </a>
      <div className="f">
        {c.figure && (
          <span className="n">
            {c.figure.value} <small>{c.figure.unit}</small>
          </span>
        )}
        {c.pdf && <span className="ms-pill is-neutral">PDF</span>}
        {c.csv && <span className="ms-pill is-neutral">CSV</span>}
        <span className="ed-acts">
          {c.csv && (
            <a
              href={c.csv}
              className="acct-action"
              title="Télécharger le CSV"
              aria-label={`Télécharger le CSV : ${c.label}`}
            >
              <DownloadGlyph size={14} />
            </a>
          )}
          <a href={c.href} className="btn btn-ghost ed-open">
            Ouvrir <ArrowUpRightGlyph size={12} />
          </a>
        </span>
      </div>
    </div>
  );
}
