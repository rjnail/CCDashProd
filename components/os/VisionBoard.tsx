"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import "./planning.css";
import {
  approvePlanningSnapshot,
  loadPlanningView,
  loadSharedWork,
  savePlanningDraft,
  savePlanningSnapshot,
} from "@/lib/os/planning-actions";
import {
  PLANNING_UNAVAILABLE,
  SECTION_TITLES,
  SWOT_KEYS,
  TRACTION_KEYS,
  VISION_KEYS,
  contentFields,
  emptyPlanningView,
  isEmptyContent,
  isSwotKey,
  resolveSection,
  tractionItems,
  versionHasSubstance,
  type MeasureField,
  type PlanningVersionView,
  type PlanningView,
  type SectionContent,
  type SectionKey,
  type SharedWorkItem,
} from "@/lib/os/planning";
import { OS_TEAM_LABELS, type OsPageData } from "@/lib/os/types";

type Guard = () => Promise<boolean>;

type EditorState = {
  key: SectionKey;
  content: SectionContent;
  expectedUpdatedAt: string | null;
  baseline: string;
  inherited: boolean;
};

const TABS = ["Vision", "Traction", "SWOT"] as const;

export function VisionBoard({
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
  const [bundle, setBundle] = useState<PlanningView | null>(null);
  const [work, setWork] = useState<SharedWorkItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Vision");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [history, setHistory] = useState<PlanningVersionView | "list" | null>(null);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const historyRef = useRef<HTMLDialogElement>(null);
  const dirty = editor != null && JSON.stringify(editor.content) !== editor.baseline;

  const reload = useCallback(async () => {
    const [result, linked] = await Promise.all([loadPlanningView(data.team), loadSharedWork(data.team)]);
    if (!result.ok) {
      setLoadError(result.error);
      setBundle(emptyPlanningView());
    } else {
      setLoadError(linked.ok ? null : linked.error);
      setBundle(result.view);
    }
    setWork(linked.ok ? linked.items : []);
  }, [data.team]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    dirtyRef.current = dirty;
    guardRef.current = async () => {
      if (!dirtyRef.current) return true;
      return window.confirm("This draft has unsaved changes. Leave without saving?");
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
    if (editor && !dialog.open) dialog.showModal();
    if (!editor && dialog.open) dialog.close();
  }, [editor]);

  useEffect(() => {
    const dialog = historyRef.current;
    if (!dialog) return;
    if (history && !dialog.open) dialog.showModal();
    if (!history && dialog.open) dialog.close();
  }, [history]);

  const editable = data.canEditSharedTarget;
  const versions = (bundle?.versions ?? []).filter((version) => version.scope === "church");

  function resolved(key: SectionKey) {
    return resolveSection({
      key,
      scope: "church",
      church: bundle?.church[key] ?? null,
      own: null,
    });
  }

  function openEditor(key: SectionKey) {
    const section = resolved(key);
    const content = structuredClone(section.content);
    setFormError(null);
    setEditor({
      key,
      content,
      expectedUpdatedAt: bundle?.church[key]?.updatedAt ?? null,
      baseline: JSON.stringify(content),
      inherited: section.inherited,
    });
  }

  function closeEditor() {
    if (dirty && !window.confirm("This draft has unsaved changes. Leave without saving?")) return;
    setEditor(null);
    setFormError(null);
  }

  async function saveEditor() {
    if (!editor) return;
    setPending(true);
    const result = await savePlanningDraft({
      team: data.team,
      scope: "church",
      key: editor.key,
      content: editor.content,
      expectedUpdatedAt: editor.expectedUpdatedAt,
    });
    setPending(false);
    if (!result.ok) {
      setFormError(result.error);
      onNotify(result.error);
      if ("conflict" in result && result.conflict) void reload();
      return;
    }
    setEditor(null);
    await reload();
    onNotify("Draft saved.");
  }

  async function saveVersion() {
    setPending(true);
    const result = await savePlanningSnapshot({
      team: data.team,
      scope: "church",
      rockIds: tractionItems(work, "rock").map((item) => item.id),
      issueIds: tractionItems(work, "issue").map((item) => item.id),
    });
    setPending(false);
    if (!result.ok) {
      onNotify(result.error);
      return;
    }
    await reload();
    onNotify("Fixed version saved. Later edits will not change it.");
  }

  async function approve(version: PlanningVersionView) {
    setPending(true);
    const result = await approvePlanningSnapshot({ team: data.team, versionId: version.id });
    setPending(false);
    if (!result.ok) {
      onNotify(result.error);
      return;
    }
    await reload();
    onNotify("Approved version recorded. The saved text was not rewritten.");
  }

  return (
    <>
      <div className="heading">
        <div>
          <div className="eyebrow">Church-wide</div>
          <h1>Vision</h1>
          <div className="sub">One shared direction for every meeting.</div>
        </div>
        <div className="actions">
          {editable ? (
            <button type="button" className="btn" disabled={pending || !bundle} onClick={() => void saveVersion()}>
              Save version
            </button>
          ) : null}
          <button type="button" className="btn" onClick={() => setHistory("list")}>
            Version history
          </button>
        </div>
      </div>
      <div className="notice">
        <strong>Draft planning.</strong> Empty sections are not approved statements. A saved version stays fixed, and approval is a separate step for an administrator.
        {bundle && !bundle.stored
          ? ` ${PLANNING_UNAVAILABLE} File: ${bundle.migrationFile}.`
          : ""}
      </div>
      {loadError ? <p className="mini">{loadError}</p> : null}
      <div className="plan-tabs" role="tablist" aria-label="Vision sections" style={{ marginBottom: 20 }}>
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            className={tab === item ? "btn active" : "btn"}
            aria-selected={tab === item}
            onClick={() => setTab(item)}
          >
            {item}
          </button>
        ))}
      </div>
      {!bundle ? <p className="mini">Loading the planning draft…</p> : null}
      {bundle && tab === "Vision" ? (
        <div className="vision-layout">
          <div className="stack">
            {VISION_KEYS.filter((key) => key !== "picture").map((key) => (
              <SectionCard
                key={key}
                sectionKey={key}
                section={resolved(key)}
                editable={editable}
                pending={pending}
                onEdit={() => openEditor(key)}
                onReturn={null}
              />
            ))}
          </div>
          <div className="stack">
            <SectionCard
              sectionKey="picture"
              section={resolved("picture")}
              editable={editable}
              pending={pending}
              onEdit={() => openEditor("picture")}
              onReturn={null}
            />
            <section className="card">
              <span className="eyebrow">From direction to action</span>
              <h2>Bring the vision into the room.</h2>
              <p className="sub">Traction holds the 1-year plan and links to the church’s Rocks and issues.</p>
              <button type="button" className="btn primary" onClick={() => setTab("Traction")}>
                View Traction →
              </button>
            </section>
          </div>
        </div>
      ) : null}
      {bundle && tab === "Traction" ? (
        <div className="vision-layout">
          <div className="stack">
            {TRACTION_KEYS.map((key) => (
              <SectionCard
                key={key}
                sectionKey={key}
                section={resolved(key)}
                editable={editable}
                pending={pending}
                onEdit={() => openEditor(key)}
                onReturn={null}
              />
            ))}
            <WorkLinks
              title="Quarterly Rocks"
              items={tractionItems(work, "rock")}
              note={null}
              href={pulseHref(data.team, "rocks", "church-wide")}
              action="Open Rocks"
              empty="No Rocks are stored."
            />
          </div>
          <WorkLinks
            title="Issues standing in the way"
            items={tractionItems(work, "issue")}
            note={null}
            href={pulseHref(data.team, "issues", "church-wide")}
            action="Open Issues / IDS"
            empty="No open issues are stored."
          />
        </div>
      ) : null}
      {bundle && tab === "SWOT" ? (
        <>
          <div className="strategy-swot">
            {SWOT_KEYS.map((key) => (
              <SectionCard
                key={key}
                sectionKey={key}
                section={resolved(key)}
                editable={editable}
                pending={pending}
                onEdit={() => openEditor(key)}
                onReturn={null}
              />
            ))}
          </div>
          <p className="mini">
            SWOT is an optional companion on this shared document. It does not replace Vision or Traction.
          </p>
        </>
      ) : null}
      <dialog
        ref={dialogRef}
        className="pulse-dialog plan-dialog"
        onCancel={(event) => {
          if (dirty && !window.confirm("This draft has unsaved changes. Leave without saving?")) {
            event.preventDefault();
          }
        }}
        onClose={() => {
          setEditor(null);
          setFormError(null);
        }}
      >
        {editor ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void saveEditor();
            }}
          >
            <h2>Edit {SECTION_TITLES[editor.key]}</h2>
            <p className="mini">Church-wide draft</p>
            <SectionFields
              content={editor.content}
              onChange={(content) => setEditor((current) => (current ? { ...current, content } : current))}
            />
            {formError ? <p className="mini">{formError}</p> : null}
            <div className="actions">
              <button type="submit" className="btn primary" disabled={pending}>
                {pending ? "Saving…" : "Save draft"}
              </button>
              <button type="button" className="btn" onClick={closeEditor}>
                Close / Cancel
              </button>
            </div>
          </form>
        ) : null}
      </dialog>
      <dialog ref={historyRef} className="pulse-dialog" onClose={() => setHistory(null)}>
        {history === "list" ? (
          <div>
            <h2>Saved planning versions</h2>
            <p className="mini">Church-wide · read-only after saving</p>
            {versions.length === 0 ? (
              <p className="empty">Save a version to create the first fixed planning record.</p>
            ) : (
              versions.map((version) => {
                const approved = bundle?.approvedVersionIds.includes(version.id) ?? false;
                return (
                  <div key={version.id} className="row">
                    <div className="grow">
                      <strong>{version.scope === "church" ? "Church-wide" : OS_TEAM_LABELS[version.scope]}</strong>
                      <div className="mini">
                        {version.authorName ?? "Saved by an authorized person"} · {new Date(version.createdAt).toLocaleString()} ·{" "}
                        {approved ? "Approved" : "Draft version"}
                      </div>
                    </div>
                    <button type="button" className="btn" onClick={() => setHistory(version)}>
                      View
                    </button>
                    {data.canPublishManual && !approved && versionHasSubstance(version) ? (
                      <button type="button" className="btn" disabled={pending} onClick={() => void approve(version)}>
                        Approve
                      </button>
                    ) : null}
                  </div>
                );
              })
            )}
            <form method="dialog">
              <button type="submit" className="btn">
                Close
              </button>
            </form>
          </div>
        ) : null}
        {history && history !== "list" ? (
          <VersionDetail
            version={history}
            items={work}
            onBack={() => setHistory("list")}
          />
        ) : null}
      </dialog>
    </>
  );
}

function SectionCard({
  sectionKey,
  section,
  editable,
  pending,
  onEdit,
  onReturn,
}: {
  sectionKey: SectionKey;
  section: ReturnType<typeof resolveSection>;
  editable: boolean;
  pending: boolean;
  onEdit: () => void;
  onReturn: (() => void) | null;
}) {
  const fields = contentFields(section.content).filter((field) => field.value.trim());
  return (
    <section className="card">
      <div className="spaced">
        <h2>{SECTION_TITLES[sectionKey]}</h2>
        <div className="actions">
          <span className={section.badge === "Church-wide reference" ? "pill gray" : "pill"}>{section.badge}</span>
          {editable ? (
            <button type="button" className="btn" onClick={onEdit}>
              ✎ Edit
            </button>
          ) : null}
        </div>
      </div>
      {fields.length === 0 ? (
        <p className="empty">{isSwotKey(sectionKey) ? "No assessment entered yet." : "No draft entered yet."}</p>
      ) : (
        <div className="vision-copy">
          {fields.map((field) => (
            <p key={field.label}>
              <span className="mini">{field.label}</span>
              <br />
              {field.value}
            </p>
          ))}
        </div>
      )}
      {section.inherited ? (
        <p className="source">Inherited church-wide reference. Editing creates a team section and does not change the shared draft.</p>
      ) : null}
      {section.updatedAt ? (
        <p className="mini">
          Draft{section.updatedByName ? ` · ${section.updatedByName}` : ""} · {new Date(section.updatedAt).toLocaleString()}
        </p>
      ) : null}
      {onReturn ? (
        <button type="button" className="btn" disabled={pending} onClick={onReturn}>
          Use church-wide reference
        </button>
      ) : null}
    </section>
  );
}

function WorkLinks({
  title,
  items,
  note,
  href,
  action,
  empty,
}: {
  title: string;
  items: SharedWorkItem[];
  note: string | null;
  href: string;
  action: string;
  empty: string;
}) {
  return (
    <section className="card">
      <div className="spaced">
        <h2>{title}</h2>
      </div>
      {note ? <p className="mini">{note}</p> : null}
      {items.length === 0 ? <p className="empty">{empty}</p> : null}
      {items.map((item) => (
        <div key={item.id} className="row">
          <div className="grow">
            <strong>{item.title}</strong>
            <div className="mini">
              {OS_TEAM_LABELS[item.team]}
              {" · "}
              {item.owner || "Unassigned"}
              {item.dueOn ? ` · ${item.dueOn}` : ""}
              {item.kind === "issue" && item.issueStatus ? ` · ${item.issueStatus.replaceAll("_", " ")}` : ""}
            </div>
          </div>
          {item.kind === "rock" && item.rockStatus ? <span className="pill gray">{item.rockStatus.replaceAll("_", " ")}</span> : null}
        </div>
      ))}
      <Link className="btn" href={href}>
        {action}
      </Link>
    </section>
  );
}

function VersionDetail({
  version,
  items,
  onBack,
}: {
  version: PlanningVersionView;
  items: SharedWorkItem[];
  onBack: () => void;
}) {
  return (
    <div>
      <h2>Archived planning version</h2>
      <p className="mini">
        {new Date(version.createdAt).toLocaleString()} · {version.authorName ?? "Saved by an authorized person"} ·{" "}
        {version.scope === "church" ? "Church-wide" : OS_TEAM_LABELS[version.scope]} · read-only
      </p>
      {version.sections.map((section) => {
        const fields = contentFields(section.content).filter((field) => field.value.trim());
        if (isEmptyContent(section.content)) return null;
        return (
          <section key={section.key}>
            <h3>
              {SECTION_TITLES[section.key]}
              {section.inherited ? " · inherited at save" : ""}
            </h3>
            {fields.map((field) => (
              <p key={field.label}>
                <span className="mini">{field.label}</span>
                <br />
                {field.value}
              </p>
            ))}
          </section>
        );
      })}
      <h3>Linked records</h3>
      <RecordRefs ids={version.recordRefs.rocks} items={items} empty="No Rocks were linked." />
      <RecordRefs ids={version.recordRefs.issues} items={items} empty="No issues were linked." />
      <p className="mini">Titles come from the current records. This version keeps the ids.</p>
      <button type="button" className="btn" onClick={onBack}>
        Back
      </button>
    </div>
  );
}

function RecordRefs({ ids, items, empty }: { ids: string[]; items: SharedWorkItem[]; empty: string }) {
  if (ids.length === 0) return <p className="mini">{empty}</p>;
  return (
    <>
      {ids.map((id) => {
        const item = items.find((entry) => entry.id === id);
        return (
          <p key={id} className="mini">
            {item ? item.title : "Linked record is not in this team’s current list."} · {id}
          </p>
        );
      })}
    </>
  );
}

function SectionFields({ content, onChange }: { content: SectionContent; onChange: (content: SectionContent) => void }) {
  if (content.kind === "values") {
    return (
      <StringList
        label="Core value"
        values={content.values}
        addLabel="Add value"
        onChange={(values) => onChange({ ...content, values })}
      />
    );
  }
  if (content.kind === "focus") {
    return (
      <>
        <label>
          Purpose / cause / passion
          <textarea value={content.purpose} onChange={(event) => onChange({ ...content, purpose: event.target.value })} />
        </label>
        <label>
          Niche
          <textarea value={content.niche} onChange={(event) => onChange({ ...content, niche: event.target.value })} />
        </label>
      </>
    );
  }
  if (content.kind === "target") {
    return (
      <>
        <label>
          Future date
          <input type="date" value={content.futureDate} onChange={(event) => onChange({ ...content, futureDate: event.target.value })} />
        </label>
        <MeasureList
          rows={content.measures}
          addLabel="Add measure"
          onChange={(measures) => onChange({ ...content, measures })}
        />
        <label>
          Description
          <textarea value={content.description} onChange={(event) => onChange({ ...content, description: event.target.value })} />
        </label>
      </>
    );
  }
  if (content.kind === "strategy") {
    return (
      <>
        <label>
          Who we serve
          <textarea value={content.whoWeServe} onChange={(event) => onChange({ ...content, whoWeServe: event.target.value })} />
        </label>
        <label>
          Distinctives
          <textarea value={content.distinctives} onChange={(event) => onChange({ ...content, distinctives: event.target.value })} />
        </label>
        <label>
          Pathway
          <textarea value={content.pathway} onChange={(event) => onChange({ ...content, pathway: event.target.value })} />
        </label>
        <label>
          Promise
          <textarea value={content.promise} onChange={(event) => onChange({ ...content, promise: event.target.value })} />
        </label>
      </>
    );
  }
  if (content.kind === "picture") {
    return (
      <>
        <label>
          Future date
          <input type="date" value={content.futureDate} onChange={(event) => onChange({ ...content, futureDate: event.target.value })} />
        </label>
        <MeasureList
          rows={content.outcomes}
          addLabel="Add outcome"
          onChange={(outcomes) => onChange({ ...content, outcomes })}
        />
        <label>
          Description of the desired future
          <textarea value={content.description} onChange={(event) => onChange({ ...content, description: event.target.value })} />
        </label>
      </>
    );
  }
  if (content.kind === "annual") {
    return (
      <>
        <label>
          Future date
          <input type="date" value={content.futureDate} onChange={(event) => onChange({ ...content, futureDate: event.target.value })} />
        </label>
        <StringList label="Annual goal" values={content.goals} addLabel="Add goal" onChange={(goals) => onChange({ ...content, goals })} />
      </>
    );
  }
  return <StringList label="Item" values={content.items} addLabel="Add item" onChange={(items) => onChange({ kind: "swot", items })} />;
}

function StringList({
  label,
  values,
  addLabel,
  onChange,
}: {
  label: string;
  values: string[];
  addLabel: string;
  onChange: (values: string[]) => void;
}) {
  return (
    <div>
      {values.map((value, index) => (
        <label key={`${label}-${index}`}>
          {label} {index + 1}
          <input
            value={value}
            onChange={(event) => onChange(values.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)))}
          />
        </label>
      ))}
      <button type="button" className="btn" disabled={values.length >= 12} onClick={() => onChange([...values, ""])}>
        {addLabel}
      </button>
    </div>
  );
}

function MeasureList({
  rows,
  addLabel,
  onChange,
}: {
  rows: MeasureField[];
  addLabel: string;
  onChange: (rows: MeasureField[]) => void;
}) {
  return (
    <div>
      {rows.map((row, index) => (
        <div className="inline" key={`measure-${index}`}>
          <label>
            Name
            <input
              value={row.label}
              onChange={(event) =>
                onChange(rows.map((item, itemIndex) => (itemIndex === index ? { ...item, label: event.target.value } : item)))
              }
            />
          </label>
          <label>
            Target
            <input
              value={row.target}
              onChange={(event) =>
                onChange(rows.map((item, itemIndex) => (itemIndex === index ? { ...item, target: event.target.value } : item)))
              }
            />
          </label>
        </div>
      ))}
      <button
        type="button"
        className="btn"
        disabled={rows.length >= 8}
        onClick={() => onChange([...rows, { label: "", target: "" }])}
      >
        {addLabel}
      </button>
    </div>
  );
}

function pulseHref(team: string, view: string, campus: string): string {
  const params = new URLSearchParams({ team, view });
  if (team === "pastoral" && campus !== "church-wide") params.set("campus", campus);
  return `/pulse?${params.toString()}`;
}
