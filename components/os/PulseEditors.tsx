"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { OwnerField } from "@/components/os/OwnerField";
import { savePulseItem } from "@/lib/os/mutate";
import { ownerChoice } from "@/lib/os/owners";
import type { OsTeam, OsWorkItem } from "@/lib/os/types";

const PRIORITIES = [
  { value: 0, label: "Parking" },
  { value: 1, label: "Low" },
  { value: 2, label: "Normal" },
  { value: 3, label: "High" },
] as const;

export function WorkBoard({
  team,
  kind,
  items,
  members,
  canEdit,
  empty,
}: {
  team: OsTeam;
  kind: OsWorkItem["kind"];
  items: OsWorkItem[];
  members: readonly { id: string; name: string }[];
  canEdit: boolean;
  empty: string;
}) {
  if (kind === "issue") return null;
  if (kind === "todo") {
    return <TodoList team={team} items={items} members={members} canEdit={canEdit} empty={empty} />;
  }
  const mine = items.filter((item) => item.kind === kind);
  return (
    <section className="card">
      {mine.length === 0 ? <p className="mini">{empty}</p> : null}
      {mine.map((item) =>
        canEdit ? (
          <ItemEditor key={item.id} team={team} item={item} members={members} />
        ) : (
          <ReadOnlyItem key={item.id} item={item} />
        )
      )}
      {canEdit && <AddItem team={team} kind={kind} members={members} />}
    </section>
  );
}

function TodoList({
  team,
  items,
  members,
  canEdit,
  empty,
}: {
  team: OsTeam;
  items: readonly OsWorkItem[];
  members: readonly { id: string; name: string }[];
  canEdit: boolean;
  empty: string;
}) {
  const today = todayIso();
  const rows = orderedTodos(items);
  const openCount = rows.filter((item) => item.rockStatus !== "complete").length;

  return (
    <section className="card todo-board" aria-label="To-dos">
      <div className="todo-board-head">
        <h2>To-dos</h2>
        <span className="todo-count" aria-label={`${rows.length} to-dos, ${openCount} open`}>
          {rows.length}
        </span>
      </div>
      <div className="tablewrap">
        <table className="todo-list">
          <caption className="sr-only">To-dos. Check a row to close it. Uncheck a closed row to reopen it.</caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Done</span>
              </th>
              <th scope="col">Title</th>
              <th scope="col">Due by</th>
              <th scope="col">Owner</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4}>
                  <p className="mini">{empty}</p>
                </td>
              </tr>
            ) : (
              rows.map((item) => (
                <TodoRow key={item.id} team={team} item={item} members={members} canEdit={canEdit} today={today} />
              ))
            )}
          </tbody>
        </table>
      </div>
      {canEdit ? <AddTodo team={team} members={members} /> : null}
    </section>
  );
}

function TodoRow({
  team,
  item,
  members,
  canEdit,
  today,
}: {
  team: OsTeam;
  item: OsWorkItem;
  members: readonly { id: string; name: string }[];
  canEdit: boolean;
  today: string;
}) {
  const router = useRouter();
  const ownerFieldId = useId();
  const storedClosed = item.rockStatus === "complete";
  const storedOwner = ownerChoice(item.ownerUserId, item.owner, members);
  const [closed, setClosed] = useState(storedClosed);
  const [owner, setOwner] = useState(storedOwner);
  const [savedOwnerId, setSavedOwnerId] = useState<string | null>(item.ownerUserId);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setClosed(storedClosed);
  }, [storedClosed]);

  useEffect(() => {
    setOwner(storedOwner);
  }, [storedOwner]);

  useEffect(() => {
    setSavedOwnerId(item.ownerUserId);
  }, [item.ownerUserId]);

  async function persist(patch: { ownerUserId: string | null; rockStatus: string }) {
    return savePulseItem({
      id: item.id,
      team,
      kind: "todo",
      title: item.title,
      ownerUserId: patch.ownerUserId,
      dueOn: item.dueOn ?? "",
      rockStatus: patch.rockStatus,
      metricKey: item.metricKey,
    });
  }

  async function onToggle(next: boolean) {
    if (!canEdit || pending) return;
    setPending(true);
    setError(null);
    const result = await persist({
      ownerUserId: savedOwnerId,
      rockStatus: next ? "complete" : "",
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setClosed(next);
    router.refresh();
  }

  async function onOwner(next: string) {
    if (!canEdit || pending || next === owner) return;
    const previous = owner;
    setOwner(next);
    setPending(true);
    setError(null);
    const result = await persist({
      ownerUserId: next || null,
      rockStatus: closed ? "complete" : "",
    });
    setPending(false);
    if (!result.ok) {
      setOwner(previous);
      setError(result.error);
      return;
    }
    setSavedOwnerId(next || null);
    router.refresh();
  }

  const overdue = isOverdue(item.dueOn, closed, today);
  const dueLabel = formatDueLabel(item.dueOn);
  const dueDate = dueKey(item.dueOn);

  return (
    <>
      <tr className={closed ? "is-done" : undefined} aria-busy={pending}>
        <td>
          <label className="todo-check">
            <input
              type="checkbox"
              checked={closed}
              disabled={!canEdit || pending}
              aria-label={closed ? `Reopen ${item.title}` : `Close ${item.title}`}
              onChange={(event) => {
                void onToggle(event.target.checked);
              }}
            />
            <span className="todo-check-face" aria-hidden="true" />
          </label>
        </td>
        <td>
          <span className={closed ? "todo-title is-done" : "todo-title"}>{item.title}</span>
        </td>
        <td className={overdue ? "todo-due is-overdue" : "todo-due"}>
          {dueLabel ? (
            <>
              {overdue ? (
                <span className="todo-overdue-mark" aria-hidden="true">
                  !
                </span>
              ) : null}
              {overdue ? <span className="sr-only">Overdue. </span> : null}
              {dueDate ? <time dateTime={dueDate}>{dueLabel}</time> : dueLabel}
            </>
          ) : (
            <span className="sr-only">No due date</span>
          )}
        </td>
        <td>
          {canEdit ? (
            <OwnerField
              id={ownerFieldId}
              className="todo-owner"
              members={members}
              value={owner}
              onChange={(next) => {
                void onOwner(next);
              }}
              allowUnassigned
              itemTitle={item.title}
            />
          ) : (
            <span>{item.owner || "Unassigned"}</span>
          )}
        </td>
      </tr>
      {error ? (
        <tr>
          <td colSpan={4}>
            <div className="notice" role="alert">
              {error}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function AddTodo({
  team,
  members,
}: {
  team: OsTeam;
  members: readonly { id: string; name: string }[];
}) {
  const router = useRouter();
  const ownerFieldId = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) titleRef.current?.focus();
  }, [open]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await savePulseItem({
      team,
      kind: "todo",
      title,
      ownerUserId: owner || null,
      dueOn,
      rockStatus: "",
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setTitle("");
    setOwner("");
    setDueOn("");
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" className="todo-add" onClick={() => setOpen(true)}>
        + Add to-do
      </button>
    );
  }

  return (
    <form className="todo-add-form" onSubmit={onSubmit}>
      <div className="todo-add-fields">
        <label>
          Title
          <input
            ref={titleRef}
            value={title}
            maxLength={180}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          Due date
          <input type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} />
        </label>
        <OwnerField id={ownerFieldId} members={members} value={owner} onChange={setOwner} allowUnassigned />
      </div>
      <div className="todo-add-actions">
        <button className="btn primary" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Add to-do"}
        </button>
        <button
          className="btn"
          type="button"
          disabled={pending}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
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

function orderedTodos(items: readonly OsWorkItem[]): OsWorkItem[] {
  const todos = items.filter((item) => item.kind === "todo");
  const open = todos.filter((item) => item.rockStatus !== "complete");
  const done = todos.filter((item) => item.rockStatus === "complete");
  return [...open, ...done];
}

function todayIso(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function dueKey(dueOn: string | null): string | null {
  if (!dueOn) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(dueOn.trim());
  return match?.[1] ?? null;
}

function formatDueLabel(dueOn: string | null): string | null {
  const key = dueKey(dueOn);
  if (!key) {
    const raw = dueOn?.trim() ?? "";
    return raw || null;
  }
  const date = new Date(`${key}T12:00:00`);
  if (Number.isNaN(date.getTime())) return key;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function isOverdue(dueOn: string | null, closed: boolean, today: string): boolean {
  if (closed) return false;
  const key = dueKey(dueOn);
  return key != null && key < today;
}

function ReadOnlyItem({ item }: { item: OsWorkItem }) {
  return (
    <div className="row">
      <div>
        <strong>{item.title}</strong>
        <div className="mini">
          {[item.owner, item.dueOn, statusText(item), item.decision].filter(Boolean).join(" · ")}
        </div>
      </div>
    </div>
  );
}

function statusText(item: OsWorkItem): string {
  if (item.kind === "todo") return item.rockStatus === "complete" ? "Done" : "Open";
  if (item.kind === "rock") {
    if (item.rockStatus === "on_track") return "On track";
    if (item.rockStatus === "off_track") return "Off track";
    if (item.rockStatus === "complete") return "Complete";
    return "";
  }
  const priority = PRIORITIES.find((option) => option.value === item.priority)?.label;
  const status =
    item.issueStatus === "discussing" ? "Discussing" : item.issueStatus === "solved" ? "Solved" : "Open";
  return [priority, status].filter(Boolean).join(" · ");
}

function ItemEditor({
  team,
  item,
  members,
}: {
  team: OsTeam;
  item: OsWorkItem;
  members: readonly { id: string; name: string }[];
}) {
  const router = useRouter();
  const ownerFieldId = useId();
  const [title, setTitle] = useState(item.title);
  const [owner, setOwner] = useState(() => ownerChoice(item.ownerUserId, item.owner, members));
  const [dueOn, setDueOn] = useState(item.dueOn ?? "");
  const [rockStatus, setRockStatus] = useState(item.rockStatus ?? "");
  const [priority, setPriority] = useState(item.priority ?? 2);
  const [issueStatus, setIssueStatus] = useState(item.issueStatus ?? "open");
  const [decision, setDecision] = useState(item.decision);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await savePulseItem({
      id: item.id,
      team,
      kind: item.kind,
      title,
      ownerUserId: owner || null,
      dueOn,
      rockStatus: item.kind === "todo" ? (rockStatus === "complete" ? "complete" : "") : rockStatus,
      priority,
      issueStatus,
      decision,
      metricKey: item.metricKey,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="row">
      <div className="grow">
        <div className="inline">
          <label>
            {item.kind === "issue" ? "Issue" : item.kind === "todo" ? "To-do" : "Rock"}
            <input value={title} maxLength={180} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <OwnerField id={ownerFieldId} members={members} value={owner} onChange={setOwner} allowUnassigned />
          {item.kind !== "issue" && (
            <label>
              Due date
              <input type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} />
            </label>
          )}
          {item.kind === "rock" && (
            <label>
              Status
              <select value={rockStatus} onChange={(event) => setRockStatus(event.target.value as typeof rockStatus)}>
                <option value="">No status</option>
                <option value="on_track">On track</option>
                <option value="off_track">Off track</option>
                <option value="complete">Complete</option>
              </select>
            </label>
          )}
          {item.kind === "issue" && (
            <>
              <label>
                Priority
                <select value={priority} onChange={(event) => setPriority(Number(event.target.value))}>
                  {PRIORITIES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Status
                <select value={issueStatus} onChange={(event) => setIssueStatus(event.target.value as typeof issueStatus)}>
                  <option value="open">Open</option>
                  <option value="discussing">Discussing</option>
                  <option value="solved">Solved</option>
                </select>
              </label>
              <label>
                Resolution
                <input value={decision} onChange={(event) => setDecision(event.target.value)} />
              </label>
            </>
          )}
          <button className="btn primary" type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
        {error && (
          <div className="notice" role="alert">
            {error}
          </div>
        )}
      </div>
    </form>
  );
}

function AddItem({
  team,
  kind,
  members,
}: {
  team: OsTeam;
  kind: OsWorkItem["kind"];
  members: readonly { id: string; name: string }[];
}) {
  const router = useRouter();
  const ownerFieldId = useId();
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [rockStatus, setRockStatus] = useState("");
  const [priority, setPriority] = useState(2);
  const [issueStatus, setIssueStatus] = useState("open");
  const [decision, setDecision] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await savePulseItem({
      team,
      kind,
      title,
      ownerUserId: owner || null,
      dueOn,
      rockStatus: kind === "todo" ? rockStatus : rockStatus,
      priority,
      issueStatus,
      decision,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setTitle("");
    setOwner("");
    setDueOn("");
    setRockStatus("");
    setPriority(2);
    setIssueStatus("open");
    setDecision("");
    router.refresh();
  }

  const submitLabel = kind === "rock" ? "Add Rock" : kind === "todo" ? "Add to-do" : "Add issue";

  return (
    <form onSubmit={onSubmit}>
      <div className="inline">
        <label>
          {kind === "issue" ? "Issue to discuss" : kind === "todo" ? "Action" : "New Rock"}
          <input value={title} maxLength={180} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <OwnerField id={ownerFieldId} members={members} value={owner} onChange={setOwner} allowUnassigned />
        {kind !== "issue" && (
          <label>
            Due date
            <input type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} />
          </label>
        )}
        {kind === "rock" && (
          <label>
            Status
            <select value={rockStatus} onChange={(event) => setRockStatus(event.target.value)}>
              <option value="">No status</option>
              <option value="on_track">On track</option>
              <option value="off_track">Off track</option>
              <option value="complete">Complete</option>
            </select>
          </label>
        )}
        {kind === "issue" && (
          <>
            <label>
              Priority
              <select value={priority} onChange={(event) => setPriority(Number(event.target.value))}>
                {PRIORITIES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select value={issueStatus} onChange={(event) => setIssueStatus(event.target.value)}>
                <option value="open">Open</option>
                <option value="discussing">Discussing</option>
                <option value="solved">Solved</option>
              </select>
            </label>
            <label>
              Resolution
              <input value={decision} onChange={(event) => setDecision(event.target.value)} />
            </label>
          </>
        )}
        <button className="btn primary" type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
    </form>
  );
}
