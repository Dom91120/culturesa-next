"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckGlyph, TrashGlyph } from "@/app/(admin)/users/account-ui";
import { ModalOverlay } from "@/components/agenda-shared";
import {
  AlertGlyph,
  ArrowBackGlyph,
  ArrowRightGlyph,
  CircleCheckGlyph,
  HistoryGlyph,
  RefreshGlyph,
} from "@/components/ui-glyphs";
import type { ExercicePaneData } from "@/server/services/exercice";
import { cycleAction, undoCycleAction } from "./actions";

type Props = {
  serviceId: string;
  serviceLabel: string;
  data: ExercicePaneData;
};

// AAAA-MM-JJ → JJ/MM/AAAA (affichage français des bornes d'exercice).
const frDate = (ymd: string) => ymd.split("-").reverse().join("/");
const plural = (n: number) => (n > 1 ? "s" : "");
const DT_FMT = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" });

// Refonte Dom 2026-09-09 : en-tête à médaillon, trois tuiles de chiffres (ce que la bascule
// reconduirait), puis deux cartes d'action toujours visibles — création à gauche, retour
// arrière à droite (seulement si une bascule est annulable) — avec options en
// interrupteurs et bande rouge/orange sur ce que l'annulation supprimerait.
export function ExercicePanel({ serviceId, serviceLabel, data }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Message de succès, teinté : vert pour une création, orange pour une suppression.
  const [info, setInfo] = useState<{ text: string; tone: "ok" | "warn" } | null>(null);

  const [recreatePeriods, setRecreatePeriods] = useState(true);
  const [recreateSlots, setRecreateSlots] = useState(true);
  const [recreateMultiSlots, setRecreateMultiSlots] = useState(true);
  const [undoAck, setUndoAck] = useState(false);
  // Modale de confirmation ouverte (port des modales legacy exercice-create/delete-confirm).
  const [confirm, setConfirm] = useState<"create" | "undo" | null>(null);

  const { counts, undo } = data;
  const bookingsCount = undo.bookingsCount;
  const undoButtonReady = bookingsCount === 0 || undoAck;
  // Teinte du retour arrière : danger (rouge) si des réservations seront perdues, warn
  // (orange) sinon (port legacy).
  const undoTone = bookingsCount > 0 ? "danger" : "warn";
  // Sans les périodes, la bascule ne reconduit rien du tout (cycleService = no-op).
  const canCreate = data.hasActivePeriods && recreatePeriods;

  function askCreate() {
    setError(null);
    setInfo(null);
    if (!canCreate) return;
    setConfirm("create");
  }

  function doCreate() {
    setConfirm(null);
    startTransition(async () => {
      const res = await cycleAction(serviceId, recreatePeriods, recreateSlots, recreateMultiSlots);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setInfo({
        text: `Exercice ${data.nextName} créé : ${res.created} période${plural(res.created)}, ${res.slotsCreated} créneau${plural(res.slotsCreated) ? "x" : ""} récurrent${plural(res.slotsCreated)}, ${res.multiSlotsCreated} créneau${plural(res.multiSlotsCreated) ? "x" : ""} multi-ponctuel${plural(res.multiSlotsCreated)}.`,
        tone: "ok",
      });
      router.refresh();
    });
  }

  function askUndo() {
    setError(null);
    setInfo(null);
    setConfirm("undo");
  }

  function doUndo() {
    setConfirm(null);
    startTransition(async () => {
      const res = await undoCycleAction(serviceId);
      if (!res?.ok) {
        setError(res?.error ?? "Échec de l'annulation.");
        return;
      }
      setInfo({ text: "Exercice supprimé, retour à l'exercice précédent effectué.", tone: "warn" });
      setUndoAck(false);
      router.refresh();
    });
  }

  const Switch = ({
    on,
    onChange,
    label,
    count,
    disabled,
  }: {
    on: boolean;
    onChange: (v: boolean) => void;
    label: string;
    count: number;
    disabled?: boolean;
  }) => (
    <div className="xc-opt">
      <span className="xc-opt-l">
        {label}
        <span className={`ms-pill ${count > 0 ? "is-ok" : "is-neutral"}`}>{count}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        className={`ex-sw${on ? " is-on" : ""}`}
        disabled={disabled || isPending}
        onClick={() => onChange(!on)}
      />
    </div>
  );

  return (
    <div className="panel xc">
      <div className="panel-title xc-hd">
        <span className="rg-ico is-warn">
          <RefreshGlyph size={16} />
        </span>
        Changement d&apos;exercice
        <span className="edh-svc">· {serviceLabel}</span>
        <span style={{ flex: 1 }} />
        {error && (
          <span className="ms-pill is-warn" role="alert">
            <AlertGlyph size={11} /> {error}
          </span>
        )}
        {info && (
          <span className={`ms-pill ${info.tone === "ok" ? "is-ok" : "is-warn"}`} role="status">
            <CircleCheckGlyph size={11} /> {info.text}
          </span>
        )}
      </div>

      <div className="xc-tiles">
        <div className="xc-tile">
          <div className="n xc-exo">{data.currentName}</div>
          <div className="cf-tile-txt">
            {/* Deux lignes comme les autres tuiles (Dom 2026-09-09) : le statut d'affichage
              tient en pastille à côté du libellé, les bornes en seconde ligne. */}
            <small className="xc-tile-l">
              <span>dernier exercice</span>
              {data.currentVisible ? (
                <span className="ms-pill is-ok" title="Affiché aux utilisateurs">
                  affiché
                </span>
              ) : (
                <span className="ms-pill is-neutral" title="Non affiché aux utilisateurs">
                  non affiché
                </span>
              )}
            </small>
            <small>
              {data.currentRange
                ? `${frDate(data.currentRange.start)} → ${frDate(data.currentRange.end)}`
                : "sans dates"}
            </small>
          </div>
        </div>
        <div className="xc-tile">
          <div className="n">{counts.periods}</div>
          <div className="cf-tile-txt">
            <small>{`période${plural(counts.periods)} à reconduire`}</small>
            <small>
              {counts.periods > 0 ? "décalées d'un an" : "aucune période sur l'exercice"}
            </small>
          </div>
        </div>
        <div className="xc-tile">
          <div className="n">{counts.recurring + counts.multiLots}</div>
          <div className="cf-tile-txt">
            <small>{`créneau${counts.recurring + counts.multiLots > 1 ? "x" : ""} à recréer`}</small>
            <small>
              {`${counts.recurring} récurrent${plural(counts.recurring)} · ${counts.multiLots} lot${plural(counts.multiLots)} multi-ponctuel${plural(counts.multiLots)}`}
            </small>
          </div>
        </div>
      </div>

      <div className="xc-cards">
        <div className="xc-card">
          <h3 className="ms-grp xc-grp">
            <span className="xc-ok">
              <ArrowRightGlyph size={13} />
            </span>
            Créer l&apos;exercice {data.nextName}
          </h3>
          {/* Phrases en gabarit : le compilateur JSX perd l'espace qui suit une expression
            quand la ligne se poursuit — même parade que « 2 000 entrées ». */}
          <p className="xc-desc">
            {`Chaque période de ${data.currentName} est recréée avec des dates décalées d'un an. L'originale est conservée ; si ${data.currentName} est « Affiché aux utilisateurs », le nouvel exercice prend le relais.`}
          </p>
          <Switch
            on={recreatePeriods}
            onChange={setRecreatePeriods}
            label="Périodes à l'identique"
            count={counts.periods}
          />
          <Switch
            on={recreateSlots}
            onChange={setRecreateSlots}
            label="Créneaux récurrents"
            count={counts.recurring}
            disabled={!recreatePeriods}
          />
          <Switch
            on={recreateMultiSlots}
            onChange={setRecreateMultiSlots}
            label="Lots multi-ponctuels"
            count={counts.multiLots}
            disabled={!recreatePeriods}
          />
          {!data.hasActivePeriods ? (
            <div className="xc-band is-warn">
              <AlertGlyph size={14} />
              <span>Aucune période à reconduire sur {data.currentName}.</span>
            </div>
          ) : !recreatePeriods ? (
            <div className="xc-band is-warn">
              <AlertGlyph size={14} />
              <span>Sans les périodes, rien n&apos;est reconduit.</span>
            </div>
          ) : null}
          <div className="xc-foot">
            <button
              type="button"
              className="btn btn-primary xc-btn"
              disabled={isPending || !canCreate}
              onClick={askCreate}
            >
              <ArrowRightGlyph size={13} /> Créer l&apos;exercice {data.nextName}
            </button>
          </div>
        </div>

        {undo.hasUndo && (
          <div className="xc-card">
            <h3 className="ms-grp xc-grp">
              <span className={`xc-${undoTone}`}>
                <ArrowBackGlyph size={13} />
              </span>
              Revenir à {data.previousName ?? "l'exercice précédent"}
            </h3>
            <p className="xc-desc">
              {`Supprime entièrement ${data.currentName} : périodes, créneaux et réservations. L'exercice précédent est restauré tel quel.`}
            </p>
            <div className={`xc-band is-${undoTone}`}>
              {bookingsCount > 0 ? (
                <>
                  <AlertGlyph size={14} />
                  <span>
                    <strong>
                      {bookingsCount} réservation{plural(bookingsCount)}
                    </strong>{" "}
                    {bookingsCount > 1 ? "seront supprimées" : "sera supprimée"}
                  </span>
                </>
              ) : (
                <>
                  <CheckGlyph size={14} />
                  <span>Aucune réservation sur cet exercice.</span>
                </>
              )}
            </div>
            {bookingsCount > 0 && (
              <label className="xc-ack">
                <input
                  type="checkbox"
                  checked={undoAck}
                  disabled={isPending}
                  onChange={(e) => setUndoAck(e.target.checked)}
                />
                <span>
                  J&apos;ai compris, {bookingsCount} réservation{plural(bookingsCount)}{" "}
                  {bookingsCount > 1 ? "seront perdues" : "sera perdue"}.
                </span>
              </label>
            )}
            <div className="xc-foot">
              <button
                type="button"
                className={`btn btn-ghost xc-btn is-${undoTone}`}
                disabled={isPending || !undoButtonReady}
                onClick={askUndo}
              >
                <TrashGlyph size={13} /> Supprimer l&apos;exercice {data.currentName}
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="xc-hist">
        <HistoryGlyph size={13} />
        {undo.hasUndo && undo.createdAt ? (
          <span>
            Dernière bascule : {data.currentName} créé le {DT_FMT.format(new Date(undo.createdAt))}
            {undo.actorLabel ? ` par ${undo.actorLabel}` : ""}
          </span>
        ) : (
          <span>Aucune bascule enregistrée pour ce service.</span>
        )}
      </p>

      {confirm === "create" && (
        <ModalOverlay onClose={() => setConfirm(null)} boxStyle={{ maxWidth: 520 }}>
          <div className="modal-title xc-mtitle">
            <span className="rg-ico is-ok">
              <RefreshGlyph size={15} />
            </span>
            Créer l&apos;exercice {data.nextName}
          </div>
          <p className="xc-mtext">
            {`Les périodes de ${data.currentName} seront recréées avec les dates décalées d'un an. L'exercice actuel est conservé et, s'il était « Affiché aux utilisateurs », le nouvel exercice prend le relais.`}
          </p>
          <div className="xc-mpills">
            <span className={`ms-pill ${recreatePeriods ? "is-ok" : "is-neutral"}`}>
              {counts.periods} période{plural(counts.periods)}
            </span>
            <span className={`ms-pill ${recreateSlots ? "is-ok" : "is-neutral"}`}>
              {recreateSlots ? counts.recurring : 0} récurrent
              {plural(recreateSlots ? counts.recurring : 0)}
            </span>
            <span className={`ms-pill ${recreateMultiSlots ? "is-ok" : "is-neutral"}`}>
              {recreateMultiSlots ? counts.multiLots : 0} lot
              {plural(recreateMultiSlots ? counts.multiLots : 0)} multi-ponctuel
              {plural(recreateMultiSlots ? counts.multiLots : 0)}
            </span>
          </div>
          <div className="btn-row">
            <button type="button" className="btn btn-ghost" onClick={() => setConfirm(null)}>
              Annuler
            </button>
            <button type="button" className="btn btn-primary xc-btn" onClick={doCreate}>
              <ArrowRightGlyph size={13} /> Créer
            </button>
          </div>
        </ModalOverlay>
      )}

      {confirm === "undo" && (
        <ModalOverlay onClose={() => setConfirm(null)} boxStyle={{ maxWidth: 520 }}>
          <div className="modal-title xc-mtitle">
            <span className={`rg-ico is-${undoTone}`}>
              <ArrowBackGlyph size={15} />
            </span>
            Supprimer l&apos;exercice {data.currentName}
          </div>
          <p className="xc-mtext">
            {`Toutes ses périodes et ses créneaux seront perdus${
              bookingsCount > 0
                ? `, ainsi que ${bookingsCount} réservation${plural(bookingsCount)}`
                : ""
            }, et ${data.previousName ?? "l'exercice précédent"} redevient l'exercice courant.`}
          </p>
          <div className={`xc-band is-${undoTone}`}>
            <AlertGlyph size={14} />
            <span>Cette action est irréversible.</span>
          </div>
          <div className="btn-row">
            <button type="button" className="btn btn-ghost" onClick={() => setConfirm(null)}>
              Annuler
            </button>
            <button
              type="button"
              className={`btn btn-primary xc-btn is-${undoTone}`}
              onClick={doUndo}
            >
              <TrashGlyph size={13} /> Supprimer
            </button>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}
