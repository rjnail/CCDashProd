"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import "./planning.css";
import { archiveAccountabilitySeat, loadSeatView, saveAccountabilitySeat } from "@/lib/os/planning-actions";
import {
  PLANNING_UNAVAILABLE,
  activeSeats,
  descendantIds,
  emptySeatView,
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
      accountabilities: seat?.accountabilities.length ? [...seat.accountabilities] : [""],
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
      functionLabel: draft.functionLabel,
      personId: draft.personId || null,
      parentId: draft.parentId || null,
      accountabilities: draft.accountabilities,
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
    onNotify("Seat saved. Assignment does not grant access.");
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

  const roots = seats.filter((seat) => !seat.parentId || !seats.some((item) => item.id === seat.parentId));

  return (
    <>
      <div className="heading">
        <div>
          <div className="eyebrow">Church-wide</div>
          <h1>Accountability Chart</h1>
          <div className="sub">Structure first. Clear seats, one accountable person, and a few essential accountabilities.</div>
        </div>
        {canManage ? (
          <button type="button" className="btn primary" onClick={() => openDraft(null, "")}>
            + Add top seat
          </button>
        ) : null}
      </div>
      <div className="notice">
        <strong>Functional accountability only.</strong> This chart does not represent elder governance, legal authority, employment reporting, or application permissions. Choosing a person does not grant access.
        {bundle && !bundle.stored ? ` ${PLANNING_UNAVAILABLE} File: ${bundle.migrationFile}.` : ""}
      </div>
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
            <p className="empty">No seats are stored yet. Add a top-level seat when the structure is ready. Nothing here is an approved chart.</p>
          ) : null}
          {mode === "Chart" && seats.length > 0 ? (
            <>
              <div className="chart-viewport" tabIndex={0} aria-label="Accountability hierarchy, scroll horizontally to explore">
                <div className="chart-scale" style={{ zoom: zoom / 100 }}>
                  <ul className="seat-tree">
                    {roots.map((seat) => (
                      <SeatBranch
                        key={seat.id}
                        seat={seat}
                        seats={seats}
                        collapsed={collapsed}
                        canManage={canManage}
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
                      />
                    ))}
                  </ul>
                </div>
              </div>
              <p className="mini">Scroll to explore the hierarchy. Seat directory is the compact reading order.</p>
            </>
          ) : null}
          {mode === "Seat directory" && seats.length > 0 ? (
            <div className="seat-directory">
              {seats.map((seat) => (
                <section key={seat.id}>
                  <SeatCard
                    seat={seat}
                    childCount={seats.filter((item) => item.parentId === seat.id).length}
                    collapsed={false}
                    canManage={canManage}
                    onToggle={() => undefined}
                    onEdit={() => openDraft(seat, "")}
                    onAdd={() => openDraft(null, seat.id)}
                    showCollapse={false}
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
    subordinateChoice: draft.subordinateChoice,
    referenceChoice: draft.referenceChoice,
  });
}

function SeatBranch({
  seat,
  seats,
  collapsed,
  canManage,
  onToggle,
  onEdit,
  onAdd,
}: {
  seat: SeatNode;
  seats: SeatNode[];
  collapsed: Set<string>;
  canManage: boolean;
  onToggle: (id: string) => void;
  onEdit: (seat: SeatNode) => void;
  onAdd: (parentId: string) => void;
}) {
  const children = seats.filter((item) => item.parentId === seat.id);
  const open = !collapsed.has(seat.id);
  return (
    <li>
      <SeatCard
        seat={seat}
        childCount={children.length}
        collapsed={!open}
        canManage={canManage}
        showCollapse={children.length > 0}
        onToggle={() => onToggle(seat.id)}
        onEdit={() => onEdit(seat)}
        onAdd={() => onAdd(seat.id)}
      />
      {children.length > 0 && open ? (
        <ul>
          {children.map((child) => (
            <SeatBranch
              key={child.id}
              seat={child}
              seats={seats}
              collapsed={collapsed}
              canManage={canManage}
              onToggle={onToggle}
              onEdit={onEdit}
              onAdd={onAdd}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function SeatCard({
  seat,
  childCount,
  collapsed,
  canManage,
  showCollapse,
  onToggle,
  onEdit,
  onAdd,
}: {
  seat: SeatNode;
  childCount: number;
  collapsed: boolean;
  canManage: boolean;
  showCollapse: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onAdd: () => void;
}) {
  const vacant = !seat.personId;
  const personLabel = seat.personName ?? (seat.personId ? "Assigned user" : "Vacant");
  return (
    <article className="seat-card">
      <div className="spaced">
        <span className="eyebrow">{seat.functionLabel}</span>
        {canManage ? (
          <button type="button" className="btn" aria-label={`Edit ${seat.title}`} onClick={onEdit}>
            ✎
          </button>
        ) : null}
      </div>
      <h3>{seat.title}</h3>
      <div className="seat-person">
        <span className="seat-avatar">{vacant ? "?" : personLabel.slice(0, 1)}</span>
        <span>{personLabel}</span>
        {vacant ? <span className="pill warn">Open seat</span> : null}
      </div>
      <div className="kicker">
        <span className="mini">ACCOUNTABILITIES</span>
        <ul>
          {seat.accountabilities.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
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
  const blocked = new Set(draft.id ? [draft.id, ...descendantIds(seats, draft.id)] : []);
  const parents = seats.filter((seat) => !blocked.has(seat.id));
  const children = draft.id ? seats.filter((seat) => seat.parentId === draft.id) : [];
  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <h2>{draft.id ? "Edit seat" : "Add seat"}</h2>
      <p className="mini">Define the function first, then assign one accountable person or leave the seat vacant.</p>
      <label>
        Seat title
        <input value={draft.title} required onChange={(event) => onChange({ ...draft, title: event.target.value })} />
      </label>
      <label>
        Function label
        <input
          value={draft.functionLabel}
          required
          onChange={(event) => onChange({ ...draft, functionLabel: event.target.value })}
        />
      </label>
      <label>
        Accountable person
        <select value={draft.personId} onChange={(event) => onChange({ ...draft, personId: event.target.value })}>
          <option value="">Vacant</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      </label>
      <p className="mini">One person may hold more than one seat. This does not change their access.</p>
      {draft.clearedAssignment ? (
        <p className="mini">The stored assignment is not an eligible user. Saving leaves this seat vacant.</p>
      ) : null}
      <label>
        Reports to
        <select value={draft.parentId} onChange={(event) => onChange({ ...draft, parentId: event.target.value })}>
          <option value="">Top seat</option>
          {parents.map((seat) => (
            <option key={seat.id} value={seat.id}>
              {seat.title}
            </option>
          ))}
        </select>
      </label>
      <div>
        <span className="mini">Essential accountabilities, one to five</span>
        {draft.accountabilities.map((item, index) => (
          <label key={`accountability-${index}`}>
            Accountability {index + 1}
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
        <div className="actions">
          <button
            type="button"
            className="btn"
            disabled={draft.accountabilities.length >= 5}
            onClick={() => onChange({ ...draft, accountabilities: [...draft.accountabilities, ""] })}
          >
            Add accountability
          </button>
          {draft.accountabilities.length > 1 ? (
            <button
              type="button"
              className="btn"
              onClick={() => onChange({ ...draft, accountabilities: draft.accountabilities.slice(0, -1) })}
            >
              Remove last
            </button>
          ) : null}
        </div>
      </div>
      {formError ? <p className="mini">{formError}</p> : null}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={pending}>
          {pending ? "Saving…" : "Save seat"}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Close / Cancel
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
