"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import "./planning.css";
import { archiveAccountabilitySeat, loadSeatView, moveAccountabilitySeat, saveAccountabilitySeat } from "@/lib/os/planning-actions";
import {
  PLANNING_UNAVAILABLE,
  activeSeats,
  compareSeatOrder,
  emptySeatView,
  seatLabelBody,
  type ArchiveReferenceChoice,
  type ArchiveSubordinateChoice,
  type SeatNode,
  type SeatView,
} from "@/lib/os/planning";
import type { OsPageData } from "@/lib/os/types";

type Guard = () => Promise<boolean>;

type SeatDraft = {
  id: string | null;
  title: string;
  functionLabel: string;
  personId: string;
  parentId: string;
  accountabilities: string[];
  attachments: string[];
  expectedUpdatedAt: string | null;
  baseline: string;
  subordinateChoice: "" | ArchiveSubordinateChoice;
  referenceChoice: "" | ArchiveReferenceChoice;
  clearedAssignment: boolean;
};

export function AccountabilityChart({
  data,
  guardRef,
  dirtyRef,
  onNotify,
}: {
  data: OsPageData;
  guardRef: { current: Guard | null };
  dirtyRef: { current: boolean };
  onNotify: (message: string) => void;
}) {
  const [bundle, setBundle] = useState<SeatView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"Chart" | "Seat directory">("Chart");
  const [zoom, setZoom] = useState(100);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<SeatDraft | null>(null);
  const [pending, setPending] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const canManage = data.canEdit;
  const dirty = draft != null && snapshot(draft) !== draft.baseline;

  const reload = useCallback(async () => {
    const result = await loadSeatView(data.team);
    if (!result.ok) {
      setLoadError(result.error);
      setBundle(emptySeatView());
      return;
    }
    setLoadError(null);
    setBundle(result.view);
  }, [data.team]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    dirtyRef.current = dirty;
    guardRef.current = async () => {
      if (!dirtyRef.current) return true;
      return window.confirm("This seat has unsaved changes. Leave without saving?");
    };
    function beforeUnload(event: BeforeUnloadEvent) {
      if (!dirtyRef.current) return;
      event.preventDefault();
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      dirtyRef.current = false;
      guardRef.current = null;
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [dirty, dirtyRef, guardRef]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (draft && !dialog.open) dialog.showModal();
    if (!draft && dialog.open) dialog.close();
  }, [draft]);

  const seats = activeSeats(bundle?.seats ?? []);
  const people = bundle?.people ?? [];

  function openDraft(seat: SeatNode | null, parentId: string) {
    const eligible = seat?.personId && people.some((person) => person.id === seat.personId) ? seat.personId : "";
    const next: SeatDraft = {
      id: seat?.id ?? null,
      title: seat?.title ?? "",
      functionLabel: seat?.functionLabel ?? "",
      personId: eligible,
      parentId: seat ? (seat.parentId ?? "") : parentId,
      accountabilities: seat?.accountabilities.length ? [...seat.accountabilities] : [],
      attachments: seat ? (bundle?.references ?? []).filter((item) => item.seatId === seat.id).map((item) => item.label) : [],
      expectedUpdatedAt: seat?.updatedAt ?? null,
      baseline: "",
      subordinateChoice: "",
      referenceChoice: "",
      clearedAssignment: Boolean(seat?.personId && !eligible),
    };
    next.baseline = snapshot(next);
    setFormError(null);
    setDraft(next);
  }

  function closeDraft() {
    if (dirty && !window.confirm("This seat has unsaved changes. Leave without saving?")) return;
    setDraft(null);
    setFormError(null);
  }

  async function saveDraft() {
    if (!draft) return;
    setPending(true);
    const result = await saveAccountabilitySeat({
      team: data.team,
      id: draft.id,
      title: draft.title,
      functionLabel: draft.functionLabel || draft.title,
      personId: draft.personId || null,
      parentId: draft.parentId || null,
      accountabilities: draft.accountabilities,
      attachments: draft.attachments,
      expectedUpdatedAt: draft.expectedUpdatedAt,
    });
    setPending(false);
    if (!result.ok) {
      setFormError(result.error);
      onNotify(result.error);
      if ("conflict" in result && result.conflict) void reload();
      return;
    }
    setDraft(null);
    await reload();
    onNotify(draft.id ? "Seat saved." : "Seat created.");
  }

  async function place(seatId: string, parentId: string | null, index: number) {
    if (!canManage || pending) return;
    setPending(true);
    const result = await moveAccountabilitySeat({ team: data.team, seatId, parentId, index });
    setPending(false);
    setDragId(null);
    if (!result.ok) {
      onNotify(result.error);
      await reload();
      return;
    }
    await reload();
  }

  async function assignPerson(seat: SeatNode, personId: string) {
    if (!canManage || pending) return;
    setPending(true);
    const result = await saveAccountabilitySeat({
      team: data.team,
      id: seat.id,
      title: seat.title,
      functionLabel: seat.functionLabel || seat.title,
      personId: personId || null,
      parentId: seat.parentId,
      accountabilities: seat.accountabilities,
      expectedUpdatedAt: seat.updatedAt,
    });
    setPending(false);
    if (!result.ok) {
      onNotify(result.error);
      await reload();
      return;
    }
    await reload();
  }

  async function archiveDraft() {
    if (!draft?.id || !draft.expectedUpdatedAt) return;
    const children = seats.filter((seat) => seat.parentId === draft.id);
    const references = (bundle?.references ?? []).filter((item) => item.seatId === draft.id);
    if (children.length > 0 && !draft.subordinateChoice) {
      setFormError("Choose what happens to the seats below this one.");
      return;
    }
    if (references.length > 0 && !draft.referenceChoice) {
      setFormError("Choose what happens to records that reference this seat.");
      return;
    }
    if (!window.confirm("Archive this seat? It leaves the chart.")) return;
    setPending(true);
    const result = await archiveAccountabilitySeat({
      team: data.team,
      seatId: draft.id,
      expectedUpdatedAt: draft.expectedUpdatedAt,
      subordinateChoice: draft.subordinateChoice || null,
      referenceChoice: draft.referenceChoice || null,
    });
    setPending(false);
    if (!result.ok) {
      setFormError(result.error);
      onNotify(result.error);
      if ("conflict" in result && result.conflict) void reload();
      return;
    }
    setDraft(null);
    await reload();
    onNotify("Seat archived.");
  }

  const roots = seats
    .filter((seat) => !seat.parentId || !seats.some((item) => item.id === seat.parentId))
    .sort(compareSeatOrder);

  return (
    <>
      <div className="heading">
        <div>
          <div className="eyebrow">Church-wide</div>
          <h1>Accountability Chart</h1>
          <div className="sub">One church-wide chart. Drag a seat to move it.</div>
        </div>
        {canManage ? (
          <button type="button" className="btn primary" onClick={() => openDraft(null, "")}>
            New Seat
          </button>
        ) : null}
      </div>
      {bundle && !bundle.stored ? (
        <p className="mini">
          {PLANNING_UNAVAILABLE} File: {bundle.migrationFile}.
        </p>
      ) : null}
      {loadError ? <p className="mini">{loadError}</p> : null}
      {!bundle ? <p className="mini">Loading the chart…</p> : null}
      {bundle ? (
        <section className="card">
          <div className="spaced">
            <div className="plan-tabs" role="tablist" aria-label="Chart view">
              {(["Chart", "Seat directory"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={mode === item ? "btn active" : "btn"}
                  aria-selected={mode === item}
                  onClick={() => setMode(item)}
                >
                  {item}
                </button>
              ))}
            </div>
            <div className="actions">
              <span className="mini">Church-wide draft</span>
              <button type="button" className="btn" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(50, value - 10))}>
                −
              </button>
              <span>{zoom}%</span>
              <button type="button" className="btn" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(130, value + 10))}>
                +
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setZoom(100);
                  setCollapsed(new Set());
                }}
              >
                Reset view
              </button>
            </div>
          </div>
          {seats.length === 0 ? (
            <p className="empty">No seats yet. Create a seat when the chart is ready.</p>
          ) : null}
          {mode === "Chart" && seats.length > 0 ? (
            <>
              <div className="chart-viewport" tabIndex={0} aria-label="Accountability hierarchy, scroll horizontally to explore">
                <div className="chart-scale" style={{ zoom: zoom / 100 }}>
                  <ul className="seat-tree">
                    {roots.map((seat, index) => (
                      <SeatBranch
                        key={seat.id}
                        seat={seat}
                        index={index}
                        seats={seats}
                        people={people}
                        collapsed={collapsed}
                        canManage={canManage}
                        pending={pending}
                        dragId={dragId}
                        onDragId={setDragId}
                        onToggle={(id) =>
                          setCollapsed((current) => {
                            const next = new Set(current);
                            if (next.has(id)) next.delete(id);
                            else next.add(id);
                            return next;
                          })
                        }
                        onEdit={(item) => openDraft(item, "")}
                        onAdd={(parentId) => openDraft(null, parentId)}
                        onPlace={(seatId, parentId, at) => void place(seatId, parentId, at)}
                        onAssign={(item, personId) => void assignPerson(item, personId)}
                      />
                    ))}
                    {canManage ? (
                      <li>
                        <div
                          className="seat-slot"
                          onDragOver={(event) => {
                            if (dragId) event.preventDefault();
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            const seatId = event.dataTransfer.getData("text/plain") || dragId;
                            if (seatId) void place(seatId, null, roots.length);
                          }}
                        >
                          Drop here for a top seat
                        </div>
                      </li>
                    ) : null}
                  </ul>
                </div>
              </div>
              <p className="mini">Scroll to explore the hierarchy. Seat directory is the compact reading order.</p>
            </>
          ) : null}
          {mode === "Seat directory" && seats.length > 0 ? (
            <div className="seat-directory">
              {[...seats].sort(compareSeatOrder).map((seat) => (
                <section key={seat.id}>
                  <SeatCard
                    seat={seat}
                    seats={seats}
                    siblings={seats.filter((item) => item.parentId === seat.parentId).sort(compareSeatOrder)}
                    childCount={seats.filter((item) => item.parentId === seat.id).length}
                    collapsed={false}
                    canManage={canManage}
                    pending={pending}
                    people={people}
                    onToggle={() => undefined}
                    onEdit={() => openDraft(seat, "")}
                    onAdd={() => openDraft(null, seat.id)}
                    showCollapse={false}
                    onPlace={(seatId, parentId, at) => void place(seatId, parentId, at)}
                    onAssign={(personId) => void assignPerson(seat, personId)}
                    onDragId={setDragId}
                  />
                  <p className="mini">Reports to: {seats.find((item) => item.id === seat.parentId)?.title ?? "Top seat"}</p>
                </section>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
      <dialog
        ref={dialogRef}
        className="pulse-dialog plan-dialog"
        onCancel={(event) => {
          if (dirty && !window.confirm("This seat has unsaved changes. Leave without saving?")) event.preventDefault();
        }}
        onClose={() => {
          setDraft(null);
          setFormError(null);
        }}
      >
        {draft ? (
          <SeatForm
            draft={draft}
            seats={seats}
            people={people}
            references={(bundle?.references ?? []).filter((item) => item.seatId === draft.id)}
            pending={pending}
            formError={formError}
            onChange={setDraft}
            onSave={() => void saveDraft()}
            onArchive={() => void archiveDraft()}
            onClose={closeDraft}
          />
        ) : null}
      </dialog>
    </>
  );
}

function snapshot(draft: SeatDraft): string {
  return JSON.stringify({
    title: draft.title,
    functionLabel: draft.functionLabel,
    personId: draft.personId,
    parentId: draft.parentId,
    accountabilities: draft.accountabilities,
    attachments: draft.attachments,
    subordinateChoice: draft.subordinateChoice,
    referenceChoice: draft.referenceChoice,
  });
}

function SeatBranch({
  seat,
  index,
  seats,
  people,
  collapsed,
  canManage,
  pending,
  dragId,
  onDragId,
  onToggle,
  onEdit,
  onAdd,
  onPlace,
  onAssign,
}: {
  seat: SeatNode;
  index: number;
  seats: SeatNode[];
  people: { id: string; name: string }[];
  collapsed: Set<string>;
  canManage: boolean;
  pending: boolean;
  dragId: string | null;
  onDragId: (id: string | null) => void;
  onToggle: (id: string) => void;
  onEdit: (seat: SeatNode) => void;
  onAdd: (parentId: string) => void;
  onPlace: (seatId: string, parentId: string | null, index: number) => void;
  onAssign: (seat: SeatNode, personId: string) => void;
}) {
  const siblings = seats.filter((item) => item.parentId === seat.parentId).sort(compareSeatOrder);
  const children = seats.filter((item) => item.parentId === seat.id).sort(compareSeatOrder);
  const open = !collapsed.has(seat.id);
  return (
    <li>
        <SeatCard
          seat={seat}
          seats={seats}
          siblings={siblings}
          index={index}
          childCount={children.length}
        collapsed={!open}
        canManage={canManage}
        pending={pending}
        people={people}
        showCollapse={children.length > 0}
        dragId={dragId}
        onDragId={onDragId}
        onToggle={() => onToggle(seat.id)}
        onEdit={() => onEdit(seat)}
        onAdd={() => onAdd(seat.id)}
        onPlace={onPlace}
        onAssign={(personId) => onAssign(seat, personId)}
      />
      {children.length > 0 && open ? (
        <ul>
          {children.map((child, childIndex) => (
            <SeatBranch
              key={child.id}
              seat={child}
              index={childIndex}
              seats={seats}
              people={people}
              collapsed={collapsed}
              canManage={canManage}
              pending={pending}
              dragId={dragId}
              onDragId={onDragId}
              onToggle={onToggle}
              onEdit={onEdit}
              onAdd={onAdd}
              onPlace={onPlace}
              onAssign={onAssign}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function SeatCard({
  seat,
  seats,
  siblings,
  index,
  childCount,
  collapsed,
  canManage,
  pending,
  people,
  showCollapse,
  dragId,
  onDragId,
  onToggle,
  onEdit,
  onAdd,
  onPlace,
  onAssign,
}: {
  seat: SeatNode;
  seats: SeatNode[];
  siblings: SeatNode[];
  index?: number;
  childCount: number;
  collapsed: boolean;
  canManage: boolean;
  pending: boolean;
  people: { id: string; name: string }[];
  showCollapse: boolean;
  dragId?: string | null;
  onDragId: (id: string | null) => void;
  onToggle: () => void;
  onEdit: () => void;
  onAdd: () => void;
  onPlace: (seatId: string, parentId: string | null, index: number) => void;
  onAssign: (personId: string) => void;
}) {
  const at = index ?? siblings.findIndex((item) => item.id === seat.id);
  const personLabel = seat.personName ?? (seat.personId ? "Assigned user" : "Unassigned");
  const known = !seat.personId || people.some((person) => person.id === seat.personId);
  const eyebrow = seatLabelBody(seat.functionLabel);
  function onKey(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!canManage || pending) return;
    if (event.key === "ArrowUp" && at > 0) {
      event.preventDefault();
      onPlace(seat.id, seat.parentId, at - 1);
    }
    if (event.key === "ArrowDown" && at >= 0 && at < siblings.length - 1) {
      event.preventDefault();
      onPlace(seat.id, seat.parentId, at + 1);
    }
    if (event.key === "ArrowRight" && at > 0) {
      event.preventDefault();
      const previous = siblings[at - 1];
      if (previous) onPlace(seat.id, previous.id, childCount);
    }
    if (event.key === "ArrowLeft" && seat.parentId) {
      event.preventDefault();
      const parent = siblings.find((item) => item.id === seat.parentId) ?? null;
      onPlace(seat.id, parent?.parentId ?? null, at + 1);
    }
  }
  return (
    <>
      {canManage ? (
        <div
          className="seat-slot"
          onDragOver={(event) => {
            if (dragId) event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const seatId = event.dataTransfer.getData("text/plain") || dragId || "";
            if (seatId && seatId !== seat.id) onPlace(seatId, seat.parentId, Math.max(0, at));
          }}
        >
          <span className="sr-only">Drop before {seat.title}</span>
        </div>
      ) : null}
      <article
        className="seat-card"
        onDragOver={(event) => {
          if (canManage && dragId && dragId !== seat.id) event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const seatId = event.dataTransfer.getData("text/plain") || dragId || "";
          if (seatId && seatId !== seat.id) onPlace(seatId, seat.id, childCount);
        }}
      >
        <div className="spaced">
          {canManage ? (
            <button
              type="button"
              className="seat-handle"
              draggable
              aria-label={`Move ${seat.title}`}
              aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
              onDragStart={(event) => {
                event.dataTransfer.setData("text/plain", seat.id);
                event.dataTransfer.effectAllowed = "move";
                onDragId(seat.id);
              }}
              onDragEnd={() => onDragId(null)}
              onKeyDown={onKey}
            >
              ⋮⋮
            </button>
          ) : (
            <span />
          )}
          {canManage ? (
            <button type="button" className="btn" aria-label={`Edit ${seat.title}`} onClick={onEdit}>
              ✎
            </button>
          ) : null}
        </div>
        {eyebrow && eyebrow !== seat.title ? <span className="eyebrow">{eyebrow}</span> : null}
        <h3>{seat.title}</h3>
        <div className="seat-person">
          <span className="seat-avatar">{seat.personId ? personLabel.slice(0, 1) : "?"}</span>
          {canManage ? (
            <select
              aria-label={`Person in ${seat.title}`}
              value={seat.personId ?? ""}
              disabled={pending}
              onChange={(event) => onAssign(event.target.value)}
            >
              <option value="">Unassigned</option>
              {!known && seat.personId ? <option value={seat.personId}>{personLabel}</option> : null}
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          ) : (
            <span>{personLabel}</span>
          )}
        </div>
        {seat.accountabilities.length > 0 ? (
          <div className="kicker">
            <span className="mini">ROLES</span>
            <ul>
              {seat.accountabilities.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {canManage ? (
          <div className="spaced kicker">
            <button type="button" className="btn" onClick={onAdd}>
              + Seat below
            </button>
            {showCollapse ? (
              <button type="button" className="btn" onClick={onToggle}>
                {collapsed ? "Expand" : "Collapse"} ({childCount})
              </button>
            ) : null}
          </div>
        ) : null}
      </article>
    </>
  );
}

function SeatForm({
  draft,
  seats,
  people,
  references,
  pending,
  formError,
  onChange,
  onSave,
  onArchive,
  onClose,
}: {
  draft: SeatDraft;
  seats: SeatNode[];
  people: { id: string; name: string }[];
  references: { id: string; label: string }[];
  pending: boolean;
  formError: string | null;
  onChange: (draft: SeatDraft) => void;
  onSave: () => void;
  onArchive: () => void;
  onClose: () => void;
}) {
  const children = draft.id ? seats.filter((seat) => seat.parentId === draft.id) : [];
  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <h2>{draft.id ? "Edit seat" : "New Seat"}</h2>
      <label>
        Seat Name
        <input
          value={draft.title}
          required
          autoFocus
          onChange={(event) => onChange({ ...draft, title: event.target.value })}
        />
      </label>
      <details className="seat-fold">
        <summary>Roles & Responsibilities</summary>
        {draft.accountabilities.map((item, index) => (
          <label key={`role-${index}`}>
            Role {index + 1}
            <input
              value={item}
              onChange={(event) =>
                onChange({
                  ...draft,
                  accountabilities: draft.accountabilities.map((current, itemIndex) =>
                    itemIndex === index ? event.target.value : current
                  ),
                })
              }
            />
          </label>
        ))}
        <button
          type="button"
          className="btn"
          disabled={draft.accountabilities.length >= 5}
          onClick={() => onChange({ ...draft, accountabilities: [...draft.accountabilities, ""] })}
        >
          Add role
        </button>
      </details>
      <details className="seat-fold">
        <summary>Attachments</summary>
        {draft.attachments.map((item, index) => (
          <label key={`attachment-${index}`}>
            Attachment {index + 1}
            <input
              value={item}
              onChange={(event) =>
                onChange({
                  ...draft,
                  attachments: draft.attachments.map((current, itemIndex) =>
                    itemIndex === index ? event.target.value : current
                  ),
                })
              }
            />
          </label>
        ))}
        <button
          type="button"
          className="btn"
          onClick={() => onChange({ ...draft, attachments: [...draft.attachments, ""] })}
        >
          Add attachment
        </button>
      </details>
      {draft.id ? (
        <label>
          Person
          <select value={draft.personId} onChange={(event) => onChange({ ...draft, personId: event.target.value })}>
            <option value="">Unassigned</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {formError ? <p className="mini">{formError}</p> : null}
      <div className="actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn primary" disabled={pending}>
          {pending ? "Saving…" : draft.id ? "Save seat" : "Create Seat"}
        </button>
      </div>
      {draft.id ? (
        <section>
          <h3>Archive</h3>
          {children.length > 0 ? (
            <label>
              Seats below this one
              <select
                value={draft.subordinateChoice}
                onChange={(event) =>
                  onChange({ ...draft, subordinateChoice: event.target.value as SeatDraft["subordinateChoice"] })
                }
              >
                <option value="">Choose</option>
                <option value="move_to_parent">Move them under the parent seat</option>
                <option value="archive_with_seat">Archive them with this seat</option>
              </select>
            </label>
          ) : (
            <p className="mini">No seats sit below this one.</p>
          )}
          {references.length > 0 ? (
            <label>
              Records that reference this seat
              <select
                value={draft.referenceChoice}
                onChange={(event) =>
                  onChange({ ...draft, referenceChoice: event.target.value as SeatDraft["referenceChoice"] })
                }
              >
                <option value="">Choose</option>
                <option value="keep">Keep the references on the archived seat</option>
                <option value="detach">Detach the references</option>
              </select>
            </label>
          ) : (
            <p className="mini">No stored records reference this seat.</p>
          )}
          <button type="button" className="btn" disabled={pending} onClick={onArchive}>
            Archive seat
          </button>
        </section>
      ) : null}
    </form>
  );
}
