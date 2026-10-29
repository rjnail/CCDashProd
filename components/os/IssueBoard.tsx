"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addIssueNote,
  assignIssueOwner,
  captureIssue,
  createLinkedTodo,
  markIssueLongTerm,
  reorderIssues,
  saveFocus,
  setIssuePriority,
  solveIssue,
} from "@/lib/os/ids-actions";
import { OwnerField } from "@/components/os/OwnerField";
import { useTangent } from "@/components/os/TangentAlert";
import { listBucket, moveItem, requireResolution, visibleIssueNotes } from "@/lib/os/ids";
import { ownerChoice } from "@/lib/os/owners";
import { OS_TEAM_LABELS } from "@/lib/os/types";
import type { OsMeasure, OsPageData, OsWorkItem } from "@/lib/os/types";

type Draft = {
  rootIssue: string;
  neededDecision: string;
  resolution: string;
};

const PRIORITIES = [0, 1, 2, 3] as const;

export function IssueBoard({ data }: { data: OsPageData }) {
  const router = useRouter();
  const issues = data.items.filter((item) => item.kind === "issue");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [solveId, setSolveId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const tangentAlert = useTangent();
  const [todoTitle, setTodoTitle] = useState("");
  const [todoOwner, setTodoOwner] = useState("");
  const [todoDue, setTodoDue] = useState("");
  const [quickTitle, setQuickTitle] = useState("");
  const [quickOwner, setQuickOwner] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const resolveKeys = useRef<Record<string, string>>({});
  const addOwnerId = useId();

  const openRows = issues.filter((issue) => listBucket(issue.issueStatus) === "open").sort(byOrder);
  const solvedRows = issues.filter((issue) => listBucket(issue.issueStatus) === "solved").sort(byOrder);
  const longRows = issues.filter((issue) => listBucket(issue.issueStatus) === "long_term").sort(byOrder);
  const rows = [...openRows, ...longRows, ...solvedRows];

  function draftFor(issue: OsWorkItem): Draft {
    return drafts[issue.id] ?? draftFrom(issue);
  }

  function updateDraft(issue: OsWorkItem, patch: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [issue.id]: { ...(current[issue.id] ?? draftFrom(issue)), ...patch } }));
  }

  async function run(task: () => Promise<{ ok: boolean; error?: string }>) {
    setPending(true);
    const result = await task();
    setPending(false);
    if (!result.ok) setMessage(result.error ?? "The save did not finish. Your text is still here.");
    else {
      setMessage(null);
      router.refresh();
    }
    return result.ok;
  }

  function toggleExpanded(issue: OsWorkItem) {
    setDrafts((current) => (current[issue.id] ? current : { ...current, [issue.id]: draftFrom(issue) }));
    setExpandedId((current) => (current === issue.id ? null : issue.id));
  }

  async function onSolveToggle(issue: OsWorkItem, checked: boolean) {
    if (listBucket(issue.issueStatus) === "solved") {
      if (!checked) setMessage("Solved issues stay on the record.");
      return;
    }
    if (!checked) return;
    const draft = draftFor(issue);
    const check = requireResolution(draft.resolution);
    if (!check.ok) {
      setDrafts((current) => ({ ...current, [issue.id]: draft }));
      setExpandedId(issue.id);
      setSolveId(issue.id);
      setMessage(check.error);
      return;
    }
    if (!resolveKeys.current[issue.id]) resolveKeys.current[issue.id] = crypto.randomUUID();
    const saved = await run(() =>
      solveIssue({
        team: data.team,
        id: issue.id,
        version: issue.version,
        resolution: check.resolution,
        idempotencyKey: resolveKeys.current[issue.id] ?? crypto.randomUUID(),
      })
    );
    if (saved) {
      delete resolveKeys.current[issue.id];
      setSolveId((current) => (current === issue.id ? null : current));
    }
  }

  function reorder(list: OsWorkItem[], index: number, direction: -1 | 1) {
    const placed = moveItem(
      list.map((issue) => issue.id),
      index,
      direction
    );
    void run(() =>
      reorderIssues({
        team: data.team,
        ordered: placed.map((id) => ({
          id,
          version: issues.find((item) => item.id === id)?.version ?? 1,
        })),
      })
    );
  }

  return (
    <div className="stack">
      {message && (
        <div className="notice" role="status">
          {message}
        </div>
      )}
      <div className="heading">
        <div>
          <div className="eyebrow">
            {OS_TEAM_LABELS[data.team]} / {data.campusLabel}
          </div>
          <h1>Identify. Discuss. Solve.</h1>
          <div className="sub">Keep the issue, decision, and resulting commitment connected.</div>
        </div>
      </div>
      <section className="card issue-sheet" aria-label="Issues">
        <div className="issue-sheet-head">
          <h2>Issues</h2>
          <span className="issue-count">{rows.length}</span>
        </div>
        <div className="tablewrap">
          <table className="issue-list">
            <caption className="sr-only">
              Issues. Check a row to solve it. Choose a title to read and add notes.
            </caption>
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Solved</span>
                </th>
                <th scope="col">Title</th>
                <th scope="col">
                  <span aria-hidden="true">#</span>
                  <span className="sr-only">Priority</span>
                </th>
                <th scope="col">Created</th>
                <th scope="col">Owner</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <p className="mini">No issues in this view.</p>
                  </td>
                </tr>
              ) : (
                rows.map((issue, index) => {
                  const openIndex = openRows.findIndex((item) => item.id === issue.id);
                  const longIndex = longRows.findIndex((item) => item.id === issue.id);
                  const draggable = data.canFacilitate && (openIndex >= 0 || longIndex >= 0);
                  return (
                    <IssueRow
                      key={issue.id}
                      issue={issue}
                      order={index + 1}
                      data={data}
                      expanded={expandedId === issue.id}
                      promptSolve={solveId === issue.id}
                      draft={draftFor(issue)}
                      noteDraft={noteDrafts[issue.id] ?? ""}
                      pending={pending}
                      draggable={draggable}
                      todoTitle={todoTitle}
                      todoOwner={todoOwner}
                      todoDue={todoDue}
                      onToggle={(checked) => void onSolveToggle(issue, checked)}
                      onExpand={() => toggleExpanded(issue)}
                      onOwner={(ownerUserId) =>
                        void run(() =>
                          assignIssueOwner({ team: data.team, id: issue.id, version: issue.version, ownerUserId })
                        )
                      }
                      onPriority={(priority) =>
                        void run(() => setIssuePriority({ team: data.team, id: issue.id, version: issue.version, priority }))
                      }
                      onDraft={(patch) => updateDraft(issue, patch)}
                      onNoteDraft={(value) => setNoteDrafts((current) => ({ ...current, [issue.id]: value }))}
                      onAddNote={() => {
                        const text = noteDrafts[issue.id] ?? "";
                        void run(async () => {
                          const result = await addIssueNote({
                            team: data.team,
                            id: issue.id,
                            version: issue.version,
                            text,
                          });
                          if (result.ok) setNoteDrafts((current) => ({ ...current, [issue.id]: "" }));
                          return result;
                        });
                      }}
                      onSaveDetail={() => {
                        const draft = draftFor(issue);
                        void run(() =>
                          saveFocus({
                            team: data.team,
                            id: issue.id,
                            version: issue.version,
                            rootIssue: draft.rootIssue,
                            neededDecision: draft.neededDecision,
                            notes: issue.notes,
                          })
                        );
                      }}
                      onSolve={() => void onSolveToggle(issue, true)}
                      onLongTerm={() =>
                        void run(() => markIssueLongTerm({ team: data.team, id: issue.id, version: issue.version }))
                      }
                      onMove={
                        openIndex >= 0
                          ? (direction) => reorder(openRows, openIndex, direction)
                          : longIndex >= 0
                            ? (direction) => reorder(longRows, longIndex, direction)
                            : undefined
                      }
                      onTangent={() => {
                        void tangentAlert.raise(issue.id).then((result) => {
                          if (!result.ok) setMessage(result.error);
                        });
                      }}
                      onTodoTitle={setTodoTitle}
                      onTodoOwner={setTodoOwner}
                      onTodoDue={setTodoDue}
                      onCreateTodo={() =>
                        void run(async () => {
                          const result = await createLinkedTodo({
                            team: data.team,
                            issueId: issue.id,
                            title: todoTitle,
                            ownerUserId: todoOwner,
                            dueOn: todoDue,
                          });
                          if (result.ok) {
                            setTodoTitle("");
                            setTodoOwner("");
                            setTodoDue("");
                          }
                          return result;
                        })
                      }
                      onDragStart={() => setDragId(issue.id)}
                      onDrop={() => {
                        if (!dragId || dragId === issue.id || !draggable) return;
                        const ids = openRows.map((item) => item.id);
                        const from = ids.indexOf(dragId);
                        const to = ids.indexOf(issue.id);
                        if (from < 0 || to < 0) return;
                        const placed = reorderByDrop(ids, from, to);
                        void run(() =>
                          reorderIssues({
                            team: data.team,
                            ordered: placed.map((id) => ({
                              id,
                              version: issues.find((item) => item.id === id)?.version ?? 1,
                            })),
                          })
                        );
                        setDragId(null);
                      }}
                    />
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {data.canParticipate && (
          <form
            className="issue-add"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const result = await captureIssue({ team: data.team, title: quickTitle, ownerUserId: quickOwner || null });
                if (result.ok) {
                  setQuickTitle("");
                  setQuickOwner("");
                }
                return result;
              });
            }}
          >
            <div className="inline">
              <label>
                Title
                <input
                  value={quickTitle}
                  maxLength={180}
                  onChange={(event) => setQuickTitle(event.target.value)}
                />
              </label>
              <OwnerField
                id={addOwnerId}
                members={data.members}
                value={quickOwner}
                onChange={setQuickOwner}
                allowUnassigned
              />
              <button className="btn primary" type="submit" disabled={pending}>
                {pending ? "Saving…" : "Add issue"}
              </button>
            </div>
          </form>
        )}
        {!data.storageReady && (
          <p className="mini">
            Issue text, order, owners, notes, votes, and resolutions cannot be stored until the Pulse migrations are applied to a named development database.
          </p>
        )}
      </section>
    </div>
  );
}

function IssueRow({
  issue,
  order,
  data,
  expanded,
  promptSolve,
  draft,
  noteDraft,
  pending,
  draggable,
  todoTitle,
  todoOwner,
  todoDue,
  onToggle,
  onExpand,
  onOwner,
  onPriority,
  onDraft,
  onNoteDraft,
  onAddNote,
  onSaveDetail,
  onSolve,
  onLongTerm,
  onMove,
  onTangent,
  onTodoTitle,
  onTodoOwner,
  onTodoDue,
  onCreateTodo,
  onDragStart,
  onDrop,
}: {
  issue: OsWorkItem;
  order: number;
  data: OsPageData;
  expanded: boolean;
  promptSolve: boolean;
  draft: Draft;
  noteDraft: string;
  pending: boolean;
  draggable: boolean;
  todoTitle: string;
  todoOwner: string;
  todoDue: string;
  onToggle: (checked: boolean) => void;
  onExpand: () => void;
  onOwner: (ownerUserId: string) => void;
  onPriority: (priority: number | null) => void;
  onDraft: (patch: Partial<Draft>) => void;
  onNoteDraft: (value: string) => void;
  onAddNote: () => void;
  onSaveDetail: () => void;
  onSolve: () => void;
  onLongTerm: () => void;
  onMove?: (direction: -1 | 1) => void;
  onTangent: () => void;
  onTodoTitle: (value: string) => void;
  onTodoOwner: (value: string) => void;
  onTodoDue: (value: string) => void;
  onCreateTodo: () => void;
  onDragStart: () => void;
  onDrop: () => void;
}) {
  const ownerFieldId = useId();
  const resolutionRef = useRef<HTMLTextAreaElement>(null);
  const solved = listBucket(issue.issueStatus) === "solved";
  const notes = visibleIssueNotes({ notes: issue.notes, comments: issue.comments });
  const created = formatCreated(issue.createdAt);
  const measure = data.measures.find((item) => item.key === issue.metricKey) ?? null;
  const linked = data.items.filter((item) => item.kind === "todo" && item.sourceIssueId === issue.id);
  const canEdit = data.canFacilitate && !solved;

  useEffect(() => {
    if (promptSolve) resolutionRef.current?.focus();
  }, [promptSolve]);

  return (
    <>
      <tr
        className={solved ? "is-solved" : undefined}
        draggable={draggable}
        onDragStart={onDragStart}
        onDragOver={(event) => {
          if (draggable) event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          onDrop();
        }}
      >
        <td>
          <label className="issue-check">
            <input
              type="checkbox"
              checked={solved}
              disabled={!data.canFacilitate || pending}
              aria-label={solved ? `${issue.title} is solved` : `Solve ${issue.title}`}
              onChange={(event) => onToggle(event.target.checked)}
            />
            <span className="issue-check-face" aria-hidden="true" />
          </label>
        </td>
        <td>
          <button
            type="button"
            className="issue-title"
            aria-expanded={expanded}
            aria-controls={`issue-notes-${issue.id}`}
            onClick={onExpand}
          >
            <span className="issue-name">
              {order}. {issue.title}
            </span>
            {notes.length > 0 && (
              <span className="issue-comments" aria-label={`${notes.length} notes`}>
                <CommentIcon />
                {notes.length}
              </span>
            )}
          </button>
        </td>
        <td className="issue-priority">
          {canEdit ? (
            <select
              aria-label={`Priority for ${issue.title}`}
              value={issue.priority ?? ""}
              disabled={pending}
              onChange={(event) => {
                const value = event.target.value;
                onPriority(value === "" ? null : Number(value));
              }}
            >
              <option value="">—</option>
              {PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          ) : (
            <span>{issue.priority ?? "—"}</span>
          )}
        </td>
        <td className="issue-created">
          {created ? <time dateTime={createdStamp(issue.createdAt)}>{created}</time> : <span>—</span>}
        </td>
        <td>
          {canEdit ? (
            <OwnerField
              id={ownerFieldId}
              className="issue-owner"
              members={data.members}
              value={ownerChoice(issue.ownerUserId, issue.owner, data.members)}
              allowUnassigned
              itemTitle={issue.title}
              onChange={(ownerUserId) => {
                if (ownerUserId === ownerChoice(issue.ownerUserId, issue.owner, data.members)) return;
                onOwner(ownerUserId);
              }}
            />
          ) : (
            <span>{issue.owner || "Unassigned"}</span>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="issue-expand" id={`issue-notes-${issue.id}`}>
          <td colSpan={5}>
            <div className="issue-expand-body">
              {notes.length === 0 ? (
                <p className="mini">No notes yet.</p>
              ) : (
                <ul className="issue-notes">
                  {notes.map((note) => {
                    const author = note.authorUserId
                      ? data.members.find((member) => member.id === note.authorUserId)?.name
                      : null;
                    const when = formatCreated(note.createdAt);
                    return (
                      <li key={note.id}>
                        <p>{note.text}</p>
                        {(author || when) && <p className="mini">{[author, when].filter(Boolean).join(" · ")}</p>}
                      </li>
                    );
                  })}
                </ul>
              )}
              {data.canFacilitate && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    onAddNote();
                  }}
                >
                  <label>
                    Note
                    <textarea
                      value={noteDraft}
                      maxLength={2000}
                      onChange={(event) => onNoteDraft(event.target.value)}
                    />
                  </label>
                  <button className="btn" type="submit" disabled={pending}>
                    Add note
                  </button>
                </form>
              )}
              <Evidence measure={measure} />
              {data.canFacilitate && (
                <>
                  <label>
                    Root issue
                    <textarea value={draft.rootIssue} onChange={(event) => onDraft({ rootIssue: event.target.value })} />
                  </label>
                  <label>
                    Decision needed today
                    <textarea
                      value={draft.neededDecision}
                      onChange={(event) => onDraft({ neededDecision: event.target.value })}
                    />
                  </label>
                  <button type="button" className="btn" disabled={pending} onClick={onSaveDetail}>
                    Save detail
                  </button>
                </>
              )}
              {!data.canFacilitate && (issue.rootIssue || issue.neededDecision) && (
                <p className="mini">
                  {issue.rootIssue ? `Root issue: ${issue.rootIssue}` : ""}
                  {issue.rootIssue && issue.neededDecision ? " · " : ""}
                  {issue.neededDecision ? `Decision needed: ${issue.neededDecision}` : ""}
                </p>
              )}
              {(promptSolve || solved) && (
                <div>
                  <label>
                    Resolution
                    <textarea
                      ref={resolutionRef}
                      value={draft.resolution}
                      disabled={solved || !data.canFacilitate}
                      onChange={(event) => onDraft({ resolution: event.target.value })}
                    />
                  </label>
                  {promptSolve && data.canFacilitate && !solved && (
                    <button type="button" className="btn primary" disabled={pending} onClick={onSolve}>
                      Save resolution
                    </button>
                  )}
                </div>
              )}
              <div>
                <h3>Linked commitments</h3>
                {linked.length === 0 ? (
                  <p className="mini">No to-dos are linked to this issue.</p>
                ) : (
                  linked.map((item) => (
                    <p key={item.id}>
                      {item.title} · {item.owner || "Unassigned"} · {item.dueOn ?? "No due date"}
                    </p>
                  ))
                )}
                {canEdit && (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      onCreateTodo();
                    }}
                  >
                    <div className="inline">
                      <label>
                        To-do title
                        <input value={todoTitle} onChange={(event) => onTodoTitle(event.target.value)} />
                      </label>
                      <OwnerField
                        id={`linked-todo-owner-${issue.id}`}
                        members={data.members}
                        value={todoOwner}
                        onChange={onTodoOwner}
                        allowUnassigned={false}
                        emptyLabel="Choose one owner"
                      />
                      <label>
                        Due date
                        <input type="date" value={todoDue} onChange={(event) => onTodoDue(event.target.value)} />
                      </label>
                      <button className="btn" type="submit" disabled={pending}>
                        Create linked to-do
                      </button>
                    </div>
                    <p className="mini">Creating a to-do does not solve the issue.</p>
                  </form>
                )}
              </div>
              {canEdit && (
                <div className="issue-actions">
                  <button type="button" className="btn" onMouseDown={(event) => event.preventDefault()} onClick={onTangent}>
                    Tangent Alert
                  </button>
                  {listBucket(issue.issueStatus) !== "long_term" && (
                    <button type="button" className="btn" disabled={pending} onClick={onLongTerm}>
                      Move to Long-term
                    </button>
                  )}
                  {onMove && (
                    <>
                      <button type="button" className="btn" aria-label={`Move ${issue.title} up`} onClick={() => onMove(-1)}>
                        Up
                      </button>
                      <button type="button" className="btn" aria-label={`Move ${issue.title} down`} onClick={() => onMove(1)}>
                        Down
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function CommentIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M3 2.5h10A1.5 1.5 0 0 1 14.5 4v6a1.5 1.5 0 0 1-1.5 1.5H7.2L4.2 13.8a.4.4 0 0 1-.7-.3V11.5H3A1.5 1.5 0 0 1 1.5 10V4A1.5 1.5 0 0 1 3 2.5Z"
      />
    </svg>
  );
}

function Evidence({ measure }: { measure: OsMeasure | null }) {
  if (!measure) return null;
  return (
    <p>
      {measure.label}: {measure.value == null ? "No verified value" : measure.value.toLocaleString()} · {measure.campusLabel} ·{" "}
      {measure.periodLabel} · {measure.sourceLabel}
      {measure.reportHref ? (
        <>
          {" "}
          <Link href={measure.reportHref}>Open report</Link>
        </>
      ) : null}
    </p>
  );
}

function draftFrom(issue: OsWorkItem): Draft {
  return {
    rootIssue: issue.rootIssue,
    neededDecision: issue.neededDecision,
    resolution: issue.decision,
  };
}

function byOrder(a: OsWorkItem, b: OsWorkItem) {
  return a.sortOrder - b.sortOrder || (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
}

function reorderByDrop(ids: string[], from: number, to: number): string[] {
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

function createdStamp(value: string | null): string | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value ?? "");
  return match?.[1];
}

function formatCreated(value: string | null): string {
  const stamp = createdStamp(value);
  if (!stamp) return "";
  const [year, month, day] = stamp.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
