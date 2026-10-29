"use client";

import { useEffect, useId, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { captureIssue } from "@/lib/os/ids-actions";
import {
  addScorecardMeasure,
  createManualMeasure,
  removeScorecardMeasure,
  reorderScorecard,
  saveScorecardRow,
} from "@/lib/os/scorecard-actions";
import {
  campusOptions,
  displayedReading,
  formatActual,
  formatTargetDisplay,
  frequencyOptions,
  isManualMetric,
  lensCampus,
  lensTargetMatches,
  moveKeys,
  observationKey,
  placeKeys,
  ownerLabel,
  periodGrainLabel,
  readingValue,
  reviewMetricKeys,
  scopeCopy,
  scorecardStatus,
  statusPill,
  syntheticManualMeasure,
  targetValueFor,
  type StoredSelection,
} from "@/lib/os/scorecard";
import { OwnerField } from "@/components/os/OwnerField";
import { ownerChoice } from "@/lib/os/owners";
import { focusKeys, pulseCampusLabel } from "@/lib/os/rules";
import {
  OS_TEAM_LABELS,
  type OsManualReading,
  type OsMeasure,
  type OsPageData,
  type OsScorecardNote,
  type OsSharedTarget,
  type ScorecardManualStatus,
  type ScorecardStatusMode,
} from "@/lib/os/types";

type Guard = () => Promise<boolean>;

type Draft = {
  targetText: string;
  ownerUserId: string;
  statusMode: ScorecardStatusMode;
  manualStatus: ScorecardManualStatus | "";
  reason: string;
  actualText: string;
  periodStart: string;
  periodEnd: string;
  readingCampus: string;
};

export function ScorecardBoard({
  data,
  onDefine,
  onNotify,
  showManage,
  guardRef,
  onDirty,
}: {
  data: OsPageData;
  onDefine: (key: string) => void;
  onNotify: (message: string) => void;
  showManage: boolean;
  guardRef: { current: Guard | null };
  onDirty: (dirty: boolean) => void;
}) {
  const router = useRouter();
  const formId = useId();
  const [notes, setNotes] = useState(data.notes);
  const [readings, setReadings] = useState(data.manualReadings);
  const [sharedTargets, setSharedTargets] = useState(data.sharedTargets);
  const [configured, setConfigured] = useState(data.scorecardConfigured);
  const [mode, setMode] = useState<"review" | "manage">("review");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseline, setBaseline] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [dialog, setDialog] = useState<null | "library" | "manual" | "remove" | "unsaved">(null);
  const [removeKey, setRemoveKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [libraryKey, setLibraryKey] = useState<string | null>(null);
  const [libraryCampus, setLibraryCampus] = useState("church-wide");
  const [libraryPeriod, setLibraryPeriod] = useState("");
  const [libraryOwner, setLibraryOwner] = useState("");
  const [manualForm, setManualForm] = useState(emptyManualForm);
  const [orderOverride, setOrderOverride] = useState<string[] | null>(null);
  const [reorderMessage, setReorderMessage] = useState("");
  const pendingLeave = useRef<{ resolve: (ok: boolean) => void } | null>(null);
  const dragFrom = useRef<number | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const handleRefs = useRef(new Map<string, HTMLButtonElement>());
  const announceTimer = useRef<number | null>(null);
  const lock = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dirty = Boolean(draft) && JSON.stringify(draft) !== baseline;

  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);

  useEffect(
    () => () => {
      if (announceTimer.current != null) window.clearTimeout(announceTimer.current);
    },
    []
  );

  useEffect(() => {
    function onLeave(event: BeforeUnloadEvent) {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    if (dialog && !node.open) node.showModal();
    if (!dialog && node.open) node.close();
  }, [dialog]);

  function ask(): Promise<boolean> {
    if (!dirty) return Promise.resolve(true);
    setDialog("unsaved");
    return new Promise((resolve) => {
      pendingLeave.current = { resolve };
    });
  }

  useEffect(() => {
    guardRef.current = ask;
    return () => {
      if (guardRef.current === ask) guardRef.current = null;
    };
  });

  function settle(ok: boolean) {
    pendingLeave.current?.resolve(ok);
    pendingLeave.current = null;
    setDialog(null);
  }

  const rows = buildRows(data, notes, readings, sharedTargets, configured, orderOverride);

  function openEditor(key: string) {
    const row = rows.find((item) => item.measure.key === key);
    if (!row) return;
    const next = draftFrom(row, data.members);
    setEditing(key);
    setDraft(next);
    setBaseline(JSON.stringify(next));
    setError(null);
  }

  async function requestEdit(key: string) {
    if (editing === key) return;
    const ok = await ask();
    if (!ok) return;
    openEditor(key);
  }

  function cancelEditor() {
    setEditing(null);
    setDraft(null);
    setBaseline("");
    setError(null);
  }

  async function persist(): Promise<boolean> {
    if (!editing || !draft || lock.current) return false;
    const row = rows.find((item) => item.measure.key === editing);
    if (!row) return false;
    lock.current = true;
    setPending(true);
    setError(null);
    const result = await saveScorecardRow({
      team: data.team,
      id: row.note?.id,
      metricKey: row.measure.key,
      label: row.measure.label,
      campus: row.campus,
      periodKind: row.measure.periodKind,
      periodLabel: row.periodLabel,
      expectedVersion: row.note?.version ?? null,
      ownerUserId: ownerChoice(draft.ownerUserId, "", data.members) || null,
      targetText: draft.targetText,
      savedTarget: row.target,
      statusMode: draft.statusMode,
      manualStatus: draft.manualStatus || null,
      reason: draft.reason,
      unit: row.unit,
      actualText: row.manual ? draft.actualText : "",
      periodStart: draft.periodStart,
      periodEnd: draft.periodEnd,
      readingCampus: draft.readingCampus,
    });
    lock.current = false;
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    if (result.note) {
      setNotes((current) => {
        const rest = current.filter((note) => note.metricKey !== result.note?.metricKey || note.campus !== result.note.campus);
        return [...rest, result.note as OsScorecardNote];
      });
    }
    if (result.reading) setReadings((current) => [...current, result.reading as OsManualReading]);
    if (result.sharedTarget) {
      setSharedTargets((current) => [
        ...current.filter(
          (item) =>
            !(
              item.metricKey === result.sharedTarget?.metricKey &&
              item.campus === result.sharedTarget.campus &&
              item.periodKey === result.sharedTarget.periodKey
            )
        ),
        result.sharedTarget as OsSharedTarget,
      ]);
    } else if (data.canEditSharedTarget) {
      setSharedTargets((current) =>
        current.filter((item) => !(item.metricKey === row.measure.key && item.periodKey === row.periodKey))
      );
    }
    setEditing(null);
    setDraft(null);
    setBaseline("");
    return true;
  }

  async function enterManage() {
    const ok = await ask();
    if (!ok) return;
    cancelEditor();
    setMode("manage");
  }

  function storedSelections(): StoredSelection[] {
    return notes.map((note) => ({
      id: note.id,
      team: note.team,
      metricKey: note.metricKey,
      campus: note.campus,
      periodKind: note.periodKind,
      removed: false,
      version: note.version,
      sortOrder: note.sortOrder,
      ownerUserId: note.ownerUserId,
    }));
  }

  function defaults() {
    return focusKeys(data.team)
      .map((key) => data.catalogMeasures.find((measure) => measure.key === key) ?? data.measures.find((measure) => measure.key === key))
      .filter((measure): measure is OsMeasure => Boolean(measure))
      .map((measure) => ({
        metricKey: measure.key,
        campus: "church-wide",
        periodKind: measure.periodKind,
        label: measure.label,
      }));
  }

  async function persistOrder(metricKeys: string[]): Promise<boolean> {
    if (lock.current) return false;
    const previous = orderOverride;
    setOrderOverride(metricKeys);
    lock.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await reorderScorecard({
        team: data.team,
        metricKeys,
        configured,
        defaults: defaults(),
        stored: storedSelections(),
      });
      if (!result.ok) {
        setOrderOverride(previous);
        setError(result.error);
        return false;
      }
      if (result.notes) setNotes(result.notes);
      if (result.configured != null) setConfigured(result.configured);
      setOrderOverride(null);
      return true;
    } catch {
      setOrderOverride(previous);
      setError("This edit was not stored.");
      return false;
    } finally {
      lock.current = false;
      setPending(false);
    }
  }

  function announceReorder(message: string) {
    if (announceTimer.current != null) window.clearTimeout(announceTimer.current);
    setReorderMessage("");
    announceTimer.current = window.setTimeout(() => setReorderMessage(message), 40);
  }

  function clearDrag() {
    dragFrom.current = null;
    for (const node of rowRefs.current.values()) node.classList.remove("is-dragging", "is-over");
  }

  function beginDrag(index: number, event: DragEvent<HTMLElement>) {
    if (pending || lock.current) {
      event.preventDefault();
      return;
    }
    const key = rows[index]?.measure.key;
    dragFrom.current = index;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
    if (key) rowRefs.current.get(key)?.classList.add("is-dragging");
  }

  function hoverRow(index: number, event: DragEvent<HTMLElement>) {
    if (dragFrom.current == null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const key = rows[index]?.measure.key;
    for (const [itemKey, node] of rowRefs.current) {
      node.classList.toggle("is-over", itemKey === key && dragFrom.current !== index);
    }
  }

  function dropRow(index: number, event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const text = event.dataTransfer.getData("text/plain");
    const parsed = text === "" ? Number.NaN : Number(text);
    const from = dragFrom.current ?? parsed;
    const keys = rows.map((item) => item.measure.key);
    const label = rows[from]?.measure.label;
    clearDrag();
    if (!label || !Number.isInteger(from) || from === index) return;
    const next = placeKeys(keys, from, index);
    const position = next.indexOf(keys[from]) + 1;
    void commitOrder(next, keys[from], `${label} moved to position ${position} of ${keys.length}.`);
  }

  function moveByKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === " ") event.preventDefault();
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const label = rows[index]?.measure.label;
    if (!label || pending || lock.current) return;
    const direction = event.key === "ArrowUp" ? -1 : 1;
    if ((direction < 0 && index === 0) || (direction > 0 && index === rows.length - 1)) {
      announceReorder(`${label} is already ${direction < 0 ? "first" : "last"}.`);
      return;
    }
    const keys = rows.map((item) => item.measure.key);
    const next = moveKeys(keys, index, direction);
    void commitOrder(next, keys[index], `${label} moved to position ${index + 1 + direction} of ${keys.length}.`);
  }

  async function commitOrder(metricKeys: string[], movedKey: string, message: string) {
    if (announceTimer.current != null) window.clearTimeout(announceTimer.current);
    setReorderMessage("");
    const saved = await persistOrder(metricKeys);
    if (!saved) return;
    announceReorder(message);
    window.requestAnimationFrame(() => handleRefs.current.get(movedKey)?.focus());
  }

  async function confirmRemove() {
    const row = rows.find((item) => item.measure.key === removeKey);
    if (!row || lock.current) return;
    lock.current = true;
    setPending(true);
    setError(null);
    const result = await removeScorecardMeasure({
      team: data.team,
      metricKey: row.measure.key,
      campus: row.campus,
      periodKind: row.measure.periodKind,
      configured,
      defaults: defaults(),
      stored: storedSelections(),
    });
    lock.current = false;
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.notes) setNotes(result.notes);
    if (result.configured != null) setConfigured(result.configured);
    setDialog(null);
    setRemoveKey(null);
  }

  const removeRow = rows.find((row) => row.measure.key === removeKey) ?? null;

  async function discuss(measure: OsMeasure) {
    const ok = await ask();
    if (!ok) return;
    const result = await captureIssue({
      team: data.team,
      title: `Discuss ${measure.label}`,
      metricKey: measure.key,
    });
    if (!result.ok) {
      onNotify(result.error);
      return;
    }
    onNotify(`Added ${measure.label} to IDS.`);
    router.refresh();
  }

  return (
    <section className="card scorecard-card">
      <div className="spaced">
        <h2 className="sr-only">Scorecard</h2>
        {mode === "review" && showManage && data.canFacilitate ? (
          <button type="button" className="btn primary" onClick={() => void enterManage()}>
            Manage Scorecard
          </button>
        ) : null}
        {mode === "manage" ? (
          <div className="scorecard-actions">
            <button type="button" className="btn primary" onClick={() => setMode("review")}>
              Done managing
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setDialog("library");
                setQuery("");
              }}
            >
              Add measure
            </button>
            <button type="button" className="btn" onClick={() => setDialog("manual")}>
              Create manual measure
            </button>
          </div>
        ) : (
          <span className="pill gray">Source actuals stay read-only</span>
        )}
      </div>
      {error && mode === "manage" ? (
        <div className="notice" role="alert">
          {error}
        </div>
      ) : null}
      {mode === "review" ? (
        rows.length === 0 ? (
          <p className="empty">No measures are on this scorecard.</p>
        ) : (
          <div className="tablewrap">
            <table className="scorecard-table">
              <caption className="sr-only">Scorecard</caption>
              <thead>
                <tr>
                  <th>Measure / Reporting Period</th>
                  <th>Actual</th>
                  <th>Target</th>
                  <th>Status</th>
                  <th>Owner</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <ReviewRows
                    key={row.measure.key}
                    row={row}
                    data={data}
                    editing={editing === row.measure.key}
                    draft={editing === row.measure.key ? draft : null}
                    formId={formId}
                    error={editing === row.measure.key ? error : null}
                    pending={pending}
                    onEdit={() => void requestEdit(row.measure.key)}
                    onCancel={cancelEditor}
                    onSave={() => void persist()}
                    onDraft={setDraft}
                    onDefine={() => onDefine(row.measure.key)}
                    onDiscuss={() => void discuss(row.measure)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : rows.length === 0 ? (
        <div className="empty">
          <p>No measures are on this scorecard.</p>
          <button type="button" className="btn primary" onClick={() => setDialog("library")}>
            Add measure
          </button>
        </div>
      ) : (
        <>
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {reorderMessage}
        </div>
        <p id={`${formId}-reorder-help`} className="sr-only">
          Drag the handle or the measure name to change this team's order. With the handle focused, press the up or down arrow to move one place.
        </p>
        <ol className="manage-list">
          {rows.map((row, index) => (
            <li
              key={row.measure.key}
              className="manage-row"
              ref={(node) => {
                if (node) rowRefs.current.set(row.measure.key, node);
                else rowRefs.current.delete(row.measure.key);
              }}
              onDragOver={(event) => hoverRow(index, event)}
              onDrop={(event) => dropRow(index, event)}
              onDragEnd={clearDrag}
            >
              <button
                type="button"
                className="manage-handle"
                draggable={!pending}
                aria-disabled={pending}
                aria-roledescription="drag handle"
                aria-label={`Reorder ${row.measure.label}. Position ${index + 1} of ${rows.length}.`}
                aria-describedby={`${formId}-reorder-help`}
                ref={(node) => {
                  if (node) handleRefs.current.set(row.measure.key, node);
                  else handleRefs.current.delete(row.measure.key);
                }}
                onKeyDown={(event) => moveByKey(event, index)}
                onDragStart={(event) => beginDrag(index, event)}
              >
                <DragGrip />
              </button>
              <div
                className="manage-main"
                draggable={!pending}
                onDragStart={(event) => beginDrag(index, event)}
              >
                <strong>{row.measure.label}</strong>
                <div className="mini">
                  {row.manual ? "Manual" : "Connected"} · {periodGrainLabel(row.measure.periodKind)}
                </div>
              </div>
              <div>{ownerLabel(row.note?.ownerUserId ?? null, row.note?.owner ?? "", data.members)}</div>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setRemoveKey(row.measure.key);
                  setDialog("remove");
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ol>
        </>
      )}
      <p className="mini">
        Giving and attendance stay on their source reports. A target is shared by teams reviewing the same measure and scope. The owner belongs to {OS_TEAM_LABELS[data.team]}.
      </p>
      <dialog
        ref={dialogRef}
        className="pulse-dialog"
        aria-labelledby={`${formId}-dialog-title`}
        onClose={() => {
          if (pendingLeave.current) settle(false);
          else setDialog(null);
        }}
      >
        {dialog === "unsaved" ? (
          <div>
            <h2 id={`${formId}-dialog-title`}>Save scorecard changes?</h2>
            <p>This row has unsaved target, owner, or status changes.</p>
            <div className="scorecard-actions">
              <button
                type="button"
                className="btn primary"
                disabled={pending}
                onClick={() =>
                  void persist().then((ok) => {
                    settle(ok);
                  })
                }
              >
                Save changes
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  cancelEditor();
                  settle(true);
                }}
              >
                Discard
              </button>
              <button type="button" className="btn" onClick={() => settle(false)}>
                Continue editing
              </button>
            </div>
            {error ? (
              <div className="notice" role="alert">
                {error}
              </div>
            ) : null}
          </div>
        ) : null}
        {dialog === "remove" && removeRow ? (
          <div>
            <h2 id={`${formId}-dialog-title`}>
              Remove {removeRow.measure.label} from the {OS_TEAM_LABELS[data.team]} scorecard?
            </h2>
            <p>Its source data, other teams’ selections, and past meeting records will remain available.</p>
            <ul>
              <li>Source data remains available.</li>
              <li>Other teams keep their selections.</li>
              <li>Past meeting snapshots remain unchanged.</li>
              <li>You can add the measure back from the library.</li>
            </ul>
            <div className="scorecard-actions">
              <button type="button" className="btn primary" disabled={pending} onClick={() => void confirmRemove()}>
                Remove from this team
              </button>
              <button type="button" className="btn" onClick={() => setDialog(null)}>
                Cancel
              </button>
            </div>
            {error ? (
              <div className="notice" role="alert">
                {error}
              </div>
            ) : null}
          </div>
        ) : null}
        {dialog === "library" ? (
          <LibraryDialog
            titleId={`${formId}-dialog-title`}
            data={data}
            notes={notes}
            configured={configured}
            query={query}
            setQuery={setQuery}
            libraryKey={libraryKey}
            setLibraryKey={setLibraryKey}
            campus={libraryCampus}
            setCampus={setLibraryCampus}
            period={libraryPeriod}
            setPeriod={setLibraryPeriod}
            owner={libraryOwner}
            setOwner={setLibraryOwner}
            pending={pending}
            error={error}
            onClose={() => setDialog(null)}
            onAdd={() =>
              void (async () => {
                if (!libraryKey || lock.current) return;
                lock.current = true;
                setPending(true);
                setError(null);
                const result = await addScorecardMeasure({
                  team: data.team,
                  metricKey: libraryKey,
                  campus: libraryCampus,
                  periodKind: libraryPeriod,
                  ownerUserId: libraryOwner || null,
                  configured,
                  defaults: defaults(),
                  stored: storedSelections(),
                });
                lock.current = false;
                setPending(false);
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                if (result.notes) setNotes(result.notes);
                if (result.configured != null) setConfigured(result.configured);
                setDialog(null);
                setLibraryKey(null);
              })()
            }
          />
        ) : null}
        {dialog === "manual" ? (
          <ManualDialog
            titleId={`${formId}-dialog-title`}
            data={data}
            form={manualForm}
            setForm={setManualForm}
            pending={pending}
            error={error}
            onClose={() => setDialog(null)}
            onCreate={() =>
              void (async () => {
                if (lock.current) return;
                lock.current = true;
                setPending(true);
                setError(null);
                const result = await createManualMeasure({
                  team: data.team,
                  ...manualForm,
                  configured,
                  defaults: defaults(),
                  stored: storedSelections(),
                });
                lock.current = false;
                setPending(false);
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                if (result.notes) setNotes(result.notes);
                if (result.configured != null) setConfigured(result.configured);
                setManualForm(emptyManualForm());
                setDialog(null);
              })()
            }
          />
        ) : null}
      </dialog>
    </section>
  );
}

function ReviewRows({
  row,
  data,
  editing,
  draft,
  formId,
  error,
  pending,
  onEdit,
  onCancel,
  onSave,
  onDraft,
  onDefine,
  onDiscuss,
}: {
  row: ScorecardRow;
  data: OsPageData;
  editing: boolean;
  draft: Draft | null;
  formId: string;
  error: string | null;
  pending: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onDraft: (draft: Draft) => void;
  onDefine: () => void;
  onDiscuss: () => void;
}) {
  return (
    <>
      <tr>
        <td>
          <strong>{row.measure.label}</strong>
          <div className="mini">
            {row.periodLabel}
            <br />
            {row.measure.campusLabel}
          </div>
        </td>
        <td>
          <strong>{row.actualText}</strong>
          {row.manual && row.reading ? (
            <div className="mini">
              {row.reading.actorName || "Team member"} · {row.reading.createdAt ? new Date(row.reading.createdAt).toLocaleString() : "Recorded"}
            </div>
          ) : null}
        </td>
        <td>{formatTargetDisplay(row.target, row.unit)}</td>
        <td>
          <span className={statusPill(row.status.key)}>{row.status.label}</span>
          {row.status.key === "manual" ? (
            <details>
              <summary>Details</summary>
              <p className="mini">
                Manually set{row.status.actorName ? ` by ${row.status.actorName}` : ""}
                {row.note?.statusSetAt ? ` on ${new Date(row.note.statusSetAt).toLocaleString()}` : ""}. Reason: {row.status.reason}.
                Calculated status: {row.status.calculatedLabel}.
              </p>
            </details>
          ) : null}
          {row.status.key === "unavailable" ? (
            <div className="mini">{row.measure.qualityDetail || "Missing source data is not zero."}</div>
          ) : null}
          {row.status.key === "stale" || row.status.key === "error" ? <div className="mini">{row.measure.qualityDetail}</div> : null}
        </td>
        <td>{ownerLabel(row.note?.ownerUserId ?? null, row.note?.owner ?? "", data.members)}</td>
        <td className="scorecard-row-actions">
          {data.canFacilitate ? (
            <button type="button" className="btn" aria-expanded={editing} onClick={onEdit}>
              Edit
            </button>
          ) : null}{" "}
          <button type="button" className="btn" onClick={onDefine}>
            Source
          </button>{" "}
          <button type="button" className="btn" onClick={onDiscuss}>
            Discuss in IDS
          </button>
        </td>
      </tr>
      {editing && draft ? (
        <tr className="scorecard-editor-row">
          <td colSpan={6}>
            <form
              className="scorecard-editor"
              onSubmit={(event) => {
                event.preventDefault();
                onSave();
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  onCancel();
                }
              }}
            >
              <p className="mini">{scopeCopy({
                label: row.measure.label,
                campusLabel: pulseCampusLabel(row.campus),
                periodKind: row.measure.periodKind,
                teamLabel: OS_TEAM_LABELS[data.team],
              })}</p>
              <div className="scorecard-fields">
                <label htmlFor={`${formId}-target`}>
                  Target ({row.unit === "currency" ? "dollars" : row.unit === "percent" ? "percent" : "number"})
                  <input
                    id={`${formId}-target`}
                    inputMode="decimal"
                    value={draft.targetText}
                    disabled={!data.canEditSharedTarget}
                    onChange={(event) => onDraft({ ...draft, targetText: event.target.value })}
                  />
                </label>
                <OwnerField
                  id={`${formId}-owner`}
                  members={data.members}
                  value={draft.ownerUserId}
                  onChange={(ownerUserId) => onDraft({ ...draft, ownerUserId })}
                  allowUnassigned
                />
                <label htmlFor={`${formId}-mode`}>
                  Status mode
                  <select
                    id={`${formId}-mode`}
                    value={draft.statusMode}
                    onChange={(event) =>
                      onDraft({
                        ...draft,
                        statusMode: event.target.value === "manual" ? "manual" : "automatic",
                      })
                    }
                  >
                    <option value="automatic">Automatic</option>
                    <option value="manual">Manual override</option>
                  </select>
                </label>
                <label htmlFor={`${formId}-manual-status`}>
                  Manual status
                  <select
                    id={`${formId}-manual-status`}
                    value={draft.manualStatus}
                    disabled={draft.statusMode !== "manual"}
                    onChange={(event) =>
                      onDraft({ ...draft, manualStatus: event.target.value as Draft["manualStatus"] })
                    }
                  >
                    <option value="">Choose a status</option>
                    <option value="on_track">On track</option>
                    <option value="needs_attention">Needs attention</option>
                    <option value="off_track">Off track</option>
                  </select>
                </label>
                <label htmlFor={`${formId}-reason`} className="scorecard-span">
                  Override reason
                  <input
                    id={`${formId}-reason`}
                    value={draft.reason}
                    disabled={draft.statusMode !== "manual"}
                    required={draft.statusMode === "manual"}
                    onChange={(event) => onDraft({ ...draft, reason: event.target.value })}
                  />
                </label>
                {row.manual ? (
                  <>
                    <label htmlFor={`${formId}-actual`}>
                      Manual actual
                      <input
                        id={`${formId}-actual`}
                        inputMode="decimal"
                        value={draft.actualText}
                        onChange={(event) => onDraft({ ...draft, actualText: event.target.value })}
                      />
                    </label>
                    <label htmlFor={`${formId}-campus`}>
                      Reading campus
                      <select
                        id={`${formId}-campus`}
                        value={draft.readingCampus}
                        onChange={(event) => onDraft({ ...draft, readingCampus: event.target.value })}
                      >
                        {campusOptions(row.measure.key).map((option) => (
                          <option key={option.id} value={option.id} disabled={!option.supported}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label htmlFor={`${formId}-start`}>
                      Period start
                      <input
                        id={`${formId}-start`}
                        type="date"
                        value={draft.periodStart}
                        onChange={(event) => onDraft({ ...draft, periodStart: event.target.value })}
                      />
                    </label>
                    <label htmlFor={`${formId}-end`}>
                      Period end
                      <input
                        id={`${formId}-end`}
                        type="date"
                        value={draft.periodEnd}
                        onChange={(event) => onDraft({ ...draft, periodEnd: event.target.value })}
                      />
                    </label>
                  </>
                ) : null}
              </div>
              {!data.canEditSharedTarget ? (
                <p className="mini">
                  This target is shared by every team reviewing this measure. You can change this team’s owner and status, but not the church-wide target.
                </p>
              ) : (
                <p className="mini">Displays as {formatTargetDisplay(Number.isFinite(Number(draft.targetText.replace(/[$,%\s,]/g, ""))) && draft.targetText.trim() ? Number(draft.targetText.replace(/[$,%\s,]/g, "")) : null, row.unit)}.</p>
              )}
              {row.manual && row.history.length > 0 ? (
                <details>
                  <summary>Correction history</summary>
                  <ul>
                    {row.history.map((reading) => (
                      <li key={reading.id} className="mini">
                        {reading.periodLabel || `${reading.periodStart}–${reading.periodEnd}`} · {reading.campus} · {formatActual(reading.value, reading.unit)} · {reading.actorName}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {row.status.calculatedLabel && row.status.key === "manual" ? (
                <p className="mini">Calculated status stays {row.status.calculatedLabel}.</p>
              ) : null}
              <div className="scorecard-actions">
                <button type="submit" className="btn primary" disabled={pending}>
                  {pending ? "Saving…" : "Save changes"}
                </button>
                <button type="button" className="btn" onClick={onCancel}>
                  Cancel
                </button>
              </div>
              {error ? (
                <div className="notice" role="alert">
                  {error}
                </div>
              ) : null}
            </form>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function LibraryDialog({
  titleId,
  data,
  notes,
  configured,
  query,
  setQuery,
  libraryKey,
  setLibraryKey,
  campus,
  setCampus,
  period,
  setPeriod,
  owner,
  setOwner,
  pending,
  error,
  onClose,
  onAdd,
}: {
  titleId: string;
  data: OsPageData;
  notes: OsScorecardNote[];
  configured: boolean;
  query: string;
  setQuery: (value: string) => void;
  libraryKey: string | null;
  setLibraryKey: (value: string) => void;
  campus: string;
  setCampus: (value: string) => void;
  period: string;
  setPeriod: (value: string) => void;
  owner: string;
  setOwner: (value: string) => void;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onAdd: () => void;
}) {
  const needle = query.trim().toLowerCase();
  const manuals: OsMeasure[] = data.manualDefinitions
    .filter((definition) => !data.catalogMeasures.some((measure) => measure.key === definition.metricKey))
    .map((definition) => ({
      key: definition.metricKey,
      label: definition.label,
      definition: definition.definition || "Manual measure.",
      unit: definition.unit,
      periodLabel: periodGrainLabel(definition.frequency),
      periodKind: definition.frequency,
      campusLabel: definition.campus === "church-wide" ? "Church-wide" : definition.campus,
      value: null,
      sourceLabel: "Manual entry",
      reportHref: null,
      refreshedAt: null,
      quality: "manual",
      qualityDetail: "Manual measure published for reuse.",
      history: [],
      staffing: null,
    }));
  const measures = [...data.catalogMeasures, ...manuals].filter((measure) => {
    if (!needle) return true;
    return `${measure.label} ${measure.definition}`.toLowerCase().includes(needle);
  });
  const selected = measures.find((measure) => measure.key === libraryKey) ?? null;
  const campuses = selected ? campusOptions(selected.key) : [];
  const frequencies = selected ? frequencyOptions(selected.key) : [];
  const chosenCampus = campuses.find((option) => option.id === campus);
  const chosenPeriod = frequencies.find((option) => option.id === period);
  const already = Boolean(
    selected &&
      (notes.some((note) => note.metricKey === selected.key && note.campus === campus && note.periodKind === period) ||
        (!configured &&
          focusKeys(data.team).includes(selected.key) &&
          campus === "church-wide" &&
          period === selected.periodKind))
  );
  return (
    <div>
      <h2 id={titleId}>Add an existing measure</h2>
      <p className="mini">A selection references the existing metric. It does not copy the source data.</p>
      <label htmlFor={`${titleId}-search`}>
        Search
        <input id={`${titleId}-search`} value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <ul className="library-list">
        {measures.map((measure) => (
          <li key={measure.key}>
            <button
              type="button"
              className={libraryKey === measure.key ? "btn primary" : "btn"}
              onClick={() => {
                setLibraryKey(measure.key);
                setCampus("church-wide");
                setPeriod(frequencyOptions(measure.key).find((option) => option.supported)?.id ?? measure.periodKind);
              }}
            >
              {measure.label}
            </button>
            <div className="mini">{measure.definition}</div>
            <div className="mini">
              {isManualMetric(measure.key) ? "Manual" : "Connected"} · {measure.campusLabel} · {periodGrainLabel(measure.periodKind)}
              {notes.some((note) => note.metricKey === measure.key) ||
              (!configured && focusKeys(data.team).includes(measure.key))
                ? " · On this team"
                : ""}
            </div>
          </li>
        ))}
      </ul>
      {selected ? (
        <fieldset>
          <legend>Scope for {selected.label}</legend>
          {campuses.map((option) => (
            <label key={option.id}>
              <input
                type="radio"
                name="library-campus"
                value={option.id}
                checked={campus === option.id}
                disabled={!option.supported}
                onChange={() => setCampus(option.id)}
              />
              {option.label}
              {option.reason ? <span className="mini"> {option.reason}</span> : null}
            </label>
          ))}
          {frequencies.map((option) => (
            <label key={option.id}>
              <input
                type="radio"
                name="library-period"
                value={option.id}
                checked={period === option.id}
                disabled={!option.supported}
                onChange={() => setPeriod(option.id)}
              />
              {option.label}
              {option.reason ? <span className="mini"> {option.reason}</span> : null}
            </label>
          ))}
          <OwnerField
            id={`${titleId}-owner`}
            members={data.members}
            value={owner}
            onChange={setOwner}
            allowUnassigned
          />
          {already ? <p className="notice">That measure, campus, and reporting period are already on this scorecard.</p> : null}
          {chosenCampus && !chosenCampus.supported ? <p className="notice">{chosenCampus.reason}</p> : null}
          {chosenPeriod && !chosenPeriod.supported ? <p className="notice">{chosenPeriod.reason}</p> : null}
        </fieldset>
      ) : null}
      <div className="scorecard-actions">
        <button
          type="button"
          className="btn primary"
          disabled={pending || !selected || already || !chosenCampus?.supported || !chosenPeriod?.supported}
          onClick={onAdd}
        >
          {pending ? "Adding…" : "Add measure"}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
      {error ? (
        <div className="notice" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

type ManualForm = {
  name: string;
  definition: string;
  unit: string;
  frequency: string;
  campus: string;
  comparison: string;
  ownerUserId: string;
  rangeMin: string;
  rangeMax: string;
  attentionMin: string;
  attentionMax: string;
  explicitMax: string;
  target: string;
  publish: boolean;
};

function emptyManualForm(): ManualForm {
  return {
    name: "",
    definition: "",
    unit: "count",
    frequency: "monthly",
    campus: "church-wide",
    comparison: "higher",
    ownerUserId: "",
    rangeMin: "",
    rangeMax: "",
    attentionMin: "",
    attentionMax: "",
    explicitMax: "",
    target: "",
    publish: false,
  };
}

function ManualDialog({
  titleId,
  data,
  form,
  setForm,
  pending,
  error,
  onClose,
  onCreate,
}: {
  titleId: string;
  data: OsPageData;
  form: ManualForm;
  setForm: (form: ManualForm) => void;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: () => void;
}) {
  function set<K extends keyof ManualForm>(key: K, value: ManualForm[K]) {
    setForm({ ...form, [key]: value });
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onCreate();
      }}
    >
      <h2 id={titleId}>Create manual measure</h2>
      <p className="mini">Manual. Selected for {OS_TEAM_LABELS[data.team]} only until an administrator publishes it.</p>
      <div className="scorecard-fields">
        <label>
          Name
          <input value={form.name} maxLength={180} onChange={(event) => set("name", event.target.value)} required />
        </label>
        <label className="scorecard-span">
          Definition
          <textarea
            value={form.definition}
            maxLength={500}
            required
            onChange={(event) => set("definition", event.target.value)}
          />
        </label>
        <label>
          Unit
          <select value={form.unit} onChange={(event) => set("unit", event.target.value)}>
            <option value="count">Count</option>
            <option value="people">People</option>
            <option value="currency">Currency</option>
            <option value="percent">Percentage</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          Reporting frequency
          <select value={form.frequency} onChange={(event) => set("frequency", event.target.value)}>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
          </select>
        </label>
        <label>
          Campus scope
          <select value={form.campus} onChange={(event) => set("campus", event.target.value)}>
            <option value="church-wide">Church-wide</option>
            <option value="mount-pleasant">Mount Pleasant</option>
            <option value="alma">Alma</option>
            <option value="st-johns">St. Johns</option>
          </select>
        </label>
        <label>
          Comparison
          <select value={form.comparison} onChange={(event) => set("comparison", event.target.value)}>
            <option value="higher">Higher is better</option>
            <option value="lower">Lower is better</option>
            <option value="range">Configured range</option>
          </select>
        </label>
        <OwnerField
          id={`${titleId}-owner`}
          members={data.members}
          value={form.ownerUserId}
          onChange={(ownerUserId) => set("ownerUserId", ownerUserId)}
          allowUnassigned={false}
        />
        {form.comparison === "range" ? (
          <>
            <label>
              Range minimum
              <input value={form.rangeMin} inputMode="decimal" onChange={(event) => set("rangeMin", event.target.value)} />
            </label>
            <label>
              Range maximum
              <input value={form.rangeMax} inputMode="decimal" onChange={(event) => set("rangeMax", event.target.value)} />
            </label>
          </>
        ) : null}
        <label>
          Needs attention from
          <input
            value={form.attentionMin}
            inputMode="decimal"
            onChange={(event) => set("attentionMin", event.target.value)}
          />
        </label>
        <label>
          Needs attention until
          <input
            value={form.attentionMax}
            inputMode="decimal"
            onChange={(event) => set("attentionMax", event.target.value)}
          />
        </label>
        <label>
          Optional maximum
          <input value={form.explicitMax} inputMode="decimal" onChange={(event) => set("explicitMax", event.target.value)} />
        </label>
        <label>
          Optional target
          <input value={form.target} inputMode="decimal" onChange={(event) => set("target", event.target.value)} />
        </label>
      </div>
      <p className="mini">Leave the attention fields blank to compare only On track and Off track. Percentages are not capped at 100 unless you set a maximum.</p>
      {data.canPublishManual ? (
        <label>
          <input type="checkbox" checked={form.publish} onChange={(event) => set("publish", event.target.checked)} />
          Publish for other teams
        </label>
      ) : null}
      <div className="scorecard-actions">
        <button className="btn primary" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Create manual measure"}
        </button>
        <button className="btn" type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
      {error ? (
        <div className="notice" role="alert">
          {error}
        </div>
      ) : null}
    </form>
  );
}

function DragGrip() {
  return (
    <svg className="manage-grip" width="14" height="18" viewBox="0 0 14 18" aria-hidden="true" focusable="false">
      <circle cx="4" cy="3" r="1.35" />
      <circle cx="10" cy="3" r="1.35" />
      <circle cx="4" cy="9" r="1.35" />
      <circle cx="10" cy="9" r="1.35" />
      <circle cx="4" cy="15" r="1.35" />
      <circle cx="10" cy="15" r="1.35" />
    </svg>
  );
}

type ScorecardRow = {
  measure: OsMeasure;
  note: OsScorecardNote | null;
  campus: string;
  periodLabel: string;
  periodKey: string;
  unit: OsMeasure["unit"];
  target: number | null;
  actualText: string;
  manual: boolean;
  reading: OsManualReading | null;
  readingCampus: string;
  history: OsManualReading[];
  status: ReturnType<typeof scorecardStatus>;
};

function buildRows(
  data: OsPageData,
  notes: OsScorecardNote[],
  readings: OsManualReading[],
  sharedTargets: OsSharedTarget[],
  configured: boolean,
  orderOverride: string[] | null
): ScorecardRow[] {
  const defaults = focusKeys(data.team).filter((key) =>
    data.catalogMeasures.some((measure) => measure.key === key) || data.measures.some((measure) => measure.key === key)
  );
  const keys = orderOverride ?? reviewMetricKeys({
    configured,
    defaults,
    notes: notes.map((note) => ({
      metricKey: note.metricKey,
      sortOrder: note.sortOrder,
      manual: isManualMetric(note.metricKey),
    })),
  });
  return keys.flatMap((key) => {
    const note = notes.find((item) => item.metricKey === key) ?? null;
    const manual = isManualMetric(key);
    const catalog =
      data.catalogMeasures.find((measure) => measure.key === key) ??
      data.measures.find((measure) => measure.key === key) ??
      null;
    const storedCampus = note?.campus || "church-wide";
    const campus = lensCampus(storedCampus, data.campus);
    const applyTarget = lensTargetMatches(storedCampus, data.campus);
    const history = readings
      .filter((reading) => reading.metricKey === key)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const reading = manual ? displayedReading(readings, key, campus) : null;
    let measure = catalog ?? (note ? syntheticManualMeasure(note, reading) : null);
    if (!measure) return [];
    if (data.campus !== "church-wide" && manual && !reading) {
      measure = {
        ...measure,
        value: null,
        quality: "unavailable",
        qualityDetail: "No reading is stored for this campus. Missing is not zero.",
        periodLabel: "Not available",
        history: [],
      };
    }
    const periodLabel = manual && reading?.periodLabel ? reading.periodLabel : measure.periodLabel;
    const periodKey = observationKey(campus, measure.periodKind, periodLabel);
    const shared = applyTarget
      ? sharedTargets.find((item) => item.metricKey === key && item.campus === campus && item.periodKey === periodKey)
      : undefined;
    const target = applyTarget ? targetValueFor(note, shared ?? null, periodKey) : null;
    const actualNumber = manual ? readingValue(reading) : measure.value;
    const comparison = note?.comparison ?? "higher";
    const campusLabel =
      data.campus === "church-wide"
        ? storedCampus === "church-wide"
          ? "Church-wide"
          : measure.campusLabel
        : pulseCampusLabel(data.campus);
    return [
      {
        measure: { ...measure, campusLabel },
        note,
        campus: storedCampus,
        periodLabel,
        periodKey,
        unit: note?.unit || measure.unit,
        target,
        actualText: actualNumber == null ? "—" : formatActual(actualNumber, note?.unit || measure.unit),
        manual,
        reading,
        readingCampus: data.campus !== "church-wide" && manual ? data.campus : storedCampus,
        history,
        status: scorecardStatus({
          quality: measure.quality,
          sourceValue: measure.value,
          manual,
          readingValue: readingValue(reading),
          target,
          comparison,
          rangeMin: note?.rangeMin ?? null,
          rangeMax: note?.rangeMax ?? null,
          attentionMin: note?.attentionMin ?? null,
          attentionMax: note?.attentionMax ?? null,
          statusMode: note?.statusMode ?? "automatic",
          manualStatus: note?.manualStatus ?? null,
          statusPeriodKey: note?.statusPeriodKey ?? "",
          currentPeriodKey: periodKey,
          reason: note?.overrideReason ?? "",
          actorName: note?.statusSetByName ?? "",
        }),
      },
    ];
  });
}

function draftFrom(row: ScorecardRow, members: readonly { id: string; name: string }[]): Draft {
  return {
    targetText: row.target == null ? "" : String(row.target),
    ownerUserId: ownerChoice(row.note?.ownerUserId, row.note?.owner ?? "", members),
    statusMode: row.note?.statusMode ?? "automatic",
    manualStatus: row.note?.manualStatus ?? "",
    reason: row.note?.overrideReason ?? "",
    actualText: "",
    periodStart: "",
    periodEnd: "",
    readingCampus: row.readingCampus,
  };
}
