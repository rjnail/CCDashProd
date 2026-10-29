"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BrandLogo } from "@/components/BrandLogo";
import { AskPanel } from "@/components/os/AskPanel";
import { TangentProvider } from "@/components/os/TangentAlert";
import { InsightCards } from "@/components/os/InsightCards";
import { AccountabilityChart } from "@/components/os/AccountabilityChart";
import { IssueBoard } from "@/components/os/IssueBoard";
import { WorkBoard } from "@/components/os/PulseEditors";
import { ScorecardBoard } from "@/components/os/ScorecardBoard";
import { VisionBoard } from "@/components/os/VisionBoard";
import { concludeMeeting } from "@/lib/os/conclude-actions";
import { SCORECARD_MIGRATION_FILE } from "@/lib/os/scorecard";
import {
  blankDraft,
  consumePause,
  formatClock,
  getMeetingDraft,
  meetingElapsed,
  pauseMeetingDraft,
  setMeetingDraft,
  type MeetingDraft,
} from "@/components/os/meeting-draft";
import { formatMoney, PULSE_CAMPUS_OPTIONS, qualityTone, showsPulseCampusSwitcher } from "@/lib/os/rules";
import { OS_TEAM_LABELS, type OsAskContext, type OsCampus, type OsMeasure, type OsPageData, type OsTeam } from "@/lib/os/types";

const VIEWS = [
  ["overview", "Overview"],
  ["meeting", "Run meeting"],
  ["scorecard", "Scorecard"],
  ["rocks", "Quarterly Rocks"],
  ["todos", "To-dos"],
  ["issues", "Issues / IDS"],
  ["history", "Meeting history"],
  ["insights", "Insights"],
  ["ask", "Ask Community OS"],
  ["vision", "Vision"],
  ["accountability", "Accountability Chart"],
] as const;

type ViewId = (typeof VIEWS)[number][0];

const SHARED_VIEWS = new Set<ViewId>(["vision", "accountability"]);

const AGENDA = [
  ["Segue", 5],
  ["Scorecard", 5],
  ["Rock review", 5],
  ["Headlines", 5],
  ["To-do review", 5],
  ["IDS", 60],
  ["Conclude", 5],
] as const;

export function PulseShell({
  data,
  initialView,
  initialQuestion = "",
}: {
  data: OsPageData;
  initialView?: string;
  initialQuestion?: string;
}) {
  const router = useRouter();
  const guardRef = useRef<(() => Promise<boolean>) | null>(null);
  const dirtyRef = useRef(false);
  const view = VIEWS.some(([id]) => id === initialView) ? (initialView as ViewId) : "overview";
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const detail = data.measures.find((measure) => measure.key === detailKey) ?? null;

  function href(next: { team?: string; view?: string; campus?: OsCampus }) {
    const team = next.team ?? data.team;
    const changingTeam = next.team != null && next.team !== data.team;
    const campus = changingTeam ? "church-wide" : (next.campus ?? data.campus);
    const currentView =
      typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("view");
    const viewNow = VIEWS.some(([id]) => id === currentView) ? currentView : view;
    const params = new URLSearchParams({
      team,
      view: next.view ?? viewNow ?? view,
    });
    if (team === "pastoral" && campus !== "church-wide") params.set("campus", campus);
    return `/pulse?${params.toString()}`;
  }

  function navLink(id: ViewId, label: string) {
    const marked = id === "insights" || id === "ask";
    return (
      <Link
        key={id}
        href={href({ view: id })}
        className={[view === id ? "active" : "", marked ? "nav-ai" : ""].filter(Boolean).join(" ")}
        aria-current={view === id ? "page" : undefined}
      >
        {marked ? (
          <span className="nav-star" aria-hidden="true">
            ✦
          </span>
        ) : null}
        {label}
      </Link>
    );
  }

  function notify(message: string) {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4500);
  }

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (!dirtyRef.current || !guardRef.current) return;
      const anchor = (event.target as Element | null)?.closest?.("a");
      if (!anchor) return;
      const next = anchor.getAttribute("href");
      if (!next || next.startsWith("http")) return;
      event.preventDefault();
      event.stopPropagation();
      void guardRef.current().then((ok) => {
        if (ok) router.push(next);
      });
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [router]);

  async function go(next: { team?: string; view?: string; campus?: OsCampus }) {
    if (dirtyRef.current && guardRef.current) {
      const ok = await guardRef.current();
      if (!ok) return;
    }
    if (next.team && next.team !== data.team) pauseMeetingDraft(data.team);
    router.push(href(next));
  }

  if (data.denied) {
    return (
      <div className="pulse">
        <div className="pulse-shell">
          <aside>
            <BrandLogo href={null} variant="light" showSubtitle={false} size="sm" />
            <p className="foot">
              Community Church
              <br />
              Pulse Meeting
            </p>
          </aside>
          <div>
            <header className="top">
              <div>
                <strong>Pulse Meeting</strong>
                <span className="mini">Leadership operating system</span>
              </div>
              <div className="controls">
                <Link href="/" className="btn">
                  Home
                </Link>
              </div>
            </header>
            <div className="content">
              <section className="card">
                <h1>No meeting workspace</h1>
                <p>
                  Your account is not assigned to a Pulse Meeting. An administrator can assign one from Admin Settings.
                </p>
              </section>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pulse">
      <div className="pulse-shell">
        <aside>
          <BrandLogo href={null} variant="light" showSubtitle={false} size="sm" />
          {data.teams.length > 1 ? (
            <select
              className="team-select"
              aria-label="Team"
              value={data.team}
              onChange={(event) => go({ team: event.target.value })}
            >
              {data.teams.map((team) => (
                <option key={team} value={team}>
                  {OS_TEAM_LABELS[team]}
                </option>
              ))}
            </select>
          ) : (
            <div className="team-current">{OS_TEAM_LABELS[data.team]}</div>
          )}
          <div>
            <div className="navlabel">Meeting workspace</div>
            <nav aria-label="Meeting workspace">
              {VIEWS.filter(([id]) => !SHARED_VIEWS.has(id)).map(([id, label]) => navLink(id, label))}
              <hr className="nav-rule" />
              {VIEWS.filter(([id]) => SHARED_VIEWS.has(id)).map(([id, label]) => navLink(id, label))}
            </nav>
          </div>
          <p className="foot">
            Community Church
            <br />
            Pulse Meeting
            <br />
            <br />
            Reporting stays intact.
            <br />
            Teams work from shared measures.
          </p>
        </aside>
        <div>
          <header className="top">
            <div>
              <strong>{OS_TEAM_LABELS[data.team]}</strong>
              <span className="mini">Leadership operating system</span>
            </div>
            <div className="controls">
              {showsPulseCampusSwitcher(data.team) && !SHARED_VIEWS.has(view) ? (
                <CampusLens campus={data.campus} onChange={(campus) => void go({ campus })} />
              ) : null}
              <Link href="/" className="btn">
                Home
              </Link>
            </div>
          </header>
          <TangentProvider team={data.team} canFacilitate={data.canFacilitate}>
          <div className="content">
            <div className="banner">
              Meeting notes and finished meetings stay on this page. Giving still follows Financials access.
              {!data.storageReady &&
                ` Scorecard, Rock, to-do, and IDS saves cannot be stored until the Pulse migrations are applied to a named development database. Voting and resolutions also wait on supabase/migrations/20261029194500_pulse_ids.sql. Scorecard audit waits on ${SCORECARD_MIGRATION_FILE}.`}
              {data.storageReady && !data.scorecardAuditReady
                ? ` Scorecard selections use the meeting items table. Audit history and the duplicate-selection index are not stored until ${SCORECARD_MIGRATION_FILE} is applied to a named development database.`
                : ""}
              {!data.modelConfigured && data.modelMissing
                ? ` No language model is configured (${data.modelMissing}). Insights and answers stay rules-based.`
                : ""}
            </div>
            {view === "overview" && (
              <Overview data={data} href={href} onDefine={setDetailKey} onNotify={notify} />
            )}
            {view === "scorecard" && (
              <ScorecardPage
                data={data}
                onDefine={setDetailKey}
                onNotify={notify}
                guardRef={guardRef}
                dirtyRef={dirtyRef}
              />
            )}
            {view === "rocks" && <RocksPage data={data} />}
            {view === "todos" && <TodosPage data={data} />}
            {view === "issues" && <IssuesPage data={data} />}
            {view === "vision" && (
              <VisionBoard data={data} guardRef={guardRef} dirtyRef={dirtyRef} onNotify={notify} />
            )}
            {view === "accountability" && (
              <AccountabilityChart data={data} guardRef={guardRef} dirtyRef={dirtyRef} onNotify={notify} />
            )}
            {view === "insights" && <InsightsPage data={data} href={href} />}
            {view === "ask" && (
              <>
                <PageHeading
                  data={data}
                  title="Ask Community OS"
                  sub="Plain-English answers grounded in the data you are authorized to see."
                />
                <AskPanel
                  key={`${data.team}:${data.campus}:${initialQuestion}`}
                  context={askContext(data)}
                  variant="pulse"
                  initialQuestion={initialQuestion}
                />
              </>
            )}
            {view === "meeting" && (
              <Meeting
                key={data.team}
                data={data}
                onDefine={setDetailKey}
                onNotify={notify}
                guardRef={guardRef}
                dirtyRef={dirtyRef}
              />
            )}
            {view === "history" && <History data={data} href={href} />}
          </div>
          </TangentProvider>
        </div>
      </div>
      <MeasureDialog measure={detail} onClose={() => setDetailKey(null)} />
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function CampusLens({
  campus,
  onChange,
}: {
  campus: OsCampus;
  onChange: (campus: OsCampus) => void;
}) {
  const options = PULSE_CAMPUS_OPTIONS;
  function move(event: KeyboardEvent<HTMLDivElement>, delta: number) {
    const index = options.findIndex((option) => option.id === campus);
    const next = options[(index + delta + options.length) % options.length];
    event.preventDefault();
    onChange(next.id);
  }
  return (
    <div
      className="campus-lens"
      role="radiogroup"
      aria-labelledby="campus-lens-label"
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowDown") move(event, 1);
        if (event.key === "ArrowLeft" || event.key === "ArrowUp") move(event, -1);
      }}
    >
      <span className="campus-lens-label" id="campus-lens-label">
        Campus lens
      </span>
      {options.map((option) => {
        const selected = campus === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={selected ? "is-selected" : undefined}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function PageHeading({
  data,
  title,
  sub,
  action,
}: {
  data: OsPageData;
  title: string;
  sub: string;
  action?: ReactNode;
}) {
  return (
    <div className="heading">
      <div>
        <div className="eyebrow">
          {OS_TEAM_LABELS[data.team]} / {data.campusLabel}
        </div>
        <h1>{title}</h1>
        <div className="sub">{sub}</div>
      </div>
      {action ? <div className="actions">{action}</div> : null}
    </div>
  );
}

function InsightsPage({
  data,
  href,
}: {
  data: OsPageData;
  href: (next: { view?: string }) => string;
}) {
  const insights = data.insights.filter((insight) => {
    const measure = data.measures.find((item) => item.key === insight.metricKey);
    return measure?.quality !== "restricted";
  });
  return (
    <>
      <PageHeading
        data={data}
        title="A clearer picture, before you ask."
        sub="Proactive observations, with the evidence and limits kept in view."
        action={
          <Link className="btn primary" href={href({ view: "ask" })}>
            Ask Community OS
          </Link>
        }
      />
      {!data.modelConfigured && (
        <p className="mini">
          No language model is configured{data.modelMissing ? ` (${data.modelMissing})` : ""}. These findings come from
          connected data rules.
        </p>
      )}
      {insights.length === 0 ? (
        <section className="card">
          <p className="empty">No material findings from the current sources.</p>
        </section>
      ) : (
        <div className="insight-list">
          {insights.map((insight) => {
            const measure = data.measures.find((item) => item.key === insight.metricKey);
            const source = measure?.sourceLabel ?? "Connected source";
            const when = insight.refreshedAt
              ? new Date(insight.refreshedAt).toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })
              : null;
            const freshness =
              insight.lifecycle === "stale"
                ? when
                  ? `Stale · data as of ${when}`
                  : "Stale · refresh date unverified"
                : when
                  ? `Data as of ${when}`
                  : "Refresh date unverified";
            return (
              <article key={insight.id} className="card">
                <div className="caption sub">{insightCategory(insight.category, measure?.label)}</div>
                <h2>{insight.title}</h2>
                <p>{insight.summary}</p>
                <p className="mini">{insight.limitation}</p>
                <p className="mini">
                  {measure?.reportHref ? <Link href={measure.reportHref}>{source}</Link> : source}
                  {" · "}
                  {insight.campusLabel}
                  {" · "}
                  {insight.periodLabel}
                  {" · "}
                  {freshness}
                </p>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

function insightCategory(category: OsPageData["insights"][number]["category"], measureLabel?: string): string {
  if (category === "data-quality") return "Data quality";
  if (category === "trend") return "Trend";
  if (category === "opportunity") return "Opportunity";
  if (measureLabel) return measureLabel;
  return "Watch";
}

function Overview({
  data,
  href,
  onDefine,
  onNotify,
}: {
  data: OsPageData;
  href: (next: { view?: string }) => string;
  onDefine: (key: string) => void;
  onNotify: (message: string) => void;
}) {
  const router = useRouter();
  return (
    <>
      <PageHeading
        data={data}
        title="Lead with a shared picture."
        sub="Review ministry health, align priorities, and leave with clear commitments."
        action={
          <>
            <Link className="btn primary" href={href({ view: "meeting" })}>
              Open meeting →
            </Link>
            <Link className="btn" href="/dashboard">
              View In Dashboard
            </Link>
          </>
        }
      />
      <div className="grid">
        {data.measures.slice(0, 4).map((measure) => (
          <section key={measure.key} className="card">
            <div className="spaced">
              <span className="metriclabel">{measure.label}</span>
              <span className={qualityTone(measure.quality)}>{measure.quality}</span>
            </div>
            <div className="value">{showValue(measure)}</div>
            <div className="mini">{measure.periodLabel}</div>
            <div className="source">
              {measure.campusLabel} ·{" "}
              {measure.value == null ? measure.qualityDetail : measure.sourceLabel}
            </div>
            <div className="kicker">
              <button type="button" className="btn" onClick={() => onDefine(measure.key)}>
                Definition & source
              </button>
            </div>
          </section>
        ))}
      </div>
      <div className="twocol">
        <section className="card">
          <div className="spaced">
            <h2>This meeting</h2>
            {data.meetingInsights.length > 0 && <span className="pill warn">Review queue</span>}
          </div>
          <InsightCards
            insights={data.meetingInsights}
            variant="pulse"
            teams={data.teams}
            canCapture={data.canParticipate}
            surface="pulse"
            team={data.team}
            onAsk={(question) => router.push(`${href({ view: "ask" })}&q=${encodeURIComponent(question)}`)}
          />
          <p className="mini">
            Ministry trends stay on the <Link href="/dashboard">Ministry Dashboard</Link>.
          </p>
          <div className="notice">
            Targets are intentionally unapplied here. Current report benchmarks remain available; team scorecard targets need matching definitions and periods.
          </div>
        </section>
        <section className="card">
          <div className="spaced">
            <h2>Quarterly priorities</h2>
          </div>
          <p className="empty">No Rocks are stored for {OS_TEAM_LABELS[data.team]}.</p>
          <Link className="btn" href={href({ view: "rocks" })}>
            Review all Rocks →
          </Link>
        </section>
      </div>
      <div className="three">
        <section className="card">
          <h2>Commitments</h2>
          <div className="value">{data.items.filter((item) => item.kind === "todo" && item.rockStatus !== "complete").length}</div>
          <p className="mini">Open in {OS_TEAM_LABELS[data.team]}</p>
          <Link className="btn" href={href({ view: "todos" })}>
            Review to-dos
          </Link>
        </section>
        <section className="card">
          <h2>Issues to solve</h2>
          <div className="value">
            {data.items.filter((item) => item.kind === "issue" && item.issueStatus !== "solved" && item.issueStatus !== "long_term").length}
          </div>
          <p className="mini">Decisions become assigned actions</p>
          <Link className="btn" href={href({ view: "issues" })}>
            Open IDS
          </Link>
        </section>
        <section className="card">
          <h2>Meeting rhythm</h2>
          <div className="value">0</div>
          <p className="mini">Completed meetings stored for this team</p>
          <Link className="btn" href={href({ view: "history" })}>
            View meeting history
          </Link>
        </section>
      </div>
    </>
  );
}

function ScorecardPage({
  data,
  onDefine,
  onNotify,
  guardRef,
  dirtyRef,
}: {
  data: OsPageData;
  onDefine: (key: string) => void;
  onNotify: (message: string) => void;
  guardRef: { current: (() => Promise<boolean>) | null };
  dirtyRef: { current: boolean };
}) {
  return (
    <>
      <PageHeading
        data={data}
        title="Scorecard"
        sub={
          data.campus === "church-wide"
            ? "Church-wide measures for this meeting. Targets are shared by teams with the same measure and scope. The owner belongs to this team."
            : `${data.campusLabel} readings where the source has this campus. A source without that campus stays unavailable, and missing is not zero.`
        }
      />
      <ScorecardBoard
        key={`${data.team}:${data.campus}`}
        data={data}
        onDefine={onDefine}
        onNotify={onNotify}
        showManage
        guardRef={guardRef}
        onDirty={(dirty) => {
          dirtyRef.current = dirty;
        }}
      />
    </>
  );
}

function RocksPage({ data }: { data: OsPageData }) {
  return (
    <>
      <PageHeading
        data={data}
        title="Quarterly Rocks"
        sub="Every priority has an owner, due date, completion criteria, and a track status."
      />
      <WorkBoard
        team={data.team}
        kind="rock"
        items={data.items}
        members={data.members}
        canEdit={data.canEdit}
        empty="No Rocks are stored for this team."
      />
    </>
  );
}

function TodosPage({ data }: { data: OsPageData }) {
  return (
    <>
      <PageHeading
        data={data}
        title="Accountability that carries forward."
        sub="Review commitments, mark outcomes, and carry open actions into the next meeting."
      />
      <WorkBoard
        team={data.team}
        kind="todo"
        items={data.items}
        members={data.members}
        canEdit={data.canEdit}
        empty="No to-dos are stored for this team."
      />
    </>
  );
}

function IssuesPage({ data }: { data: OsPageData }) {
  return <IssueBoard data={data} />;
}

function Meeting({
  data,
  onDefine,
  onNotify,
  guardRef,
  dirtyRef,
}: {
  data: OsPageData;
  onDefine: (key: string) => void;
  onNotify: (message: string) => void;
  guardRef: { current: (() => Promise<boolean>) | null };
  dirtyRef: { current: boolean };
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [draft, setDraftState] = useState<MeetingDraft>(() => getMeetingDraft(data.team));
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [now, setNow] = useState(() => Date.now());

  async function conclude() {
    if (!draft.rating) {
      onNotify("Choose an explicit meeting rating before concluding.");
      return;
    }
    setSaving(true);
    const result = await concludeMeeting({
      team: data.team,
      campus: data.campus,
      notes: draft.notes,
      headlines: draft.headlines,
      decision: draft.decision,
      rating: draft.rating,
      elapsedSeconds: meetingElapsed(draft, Date.now()),
      stage: draft.step,
    });
    setSaving(false);
    if (!result.ok) {
      onNotify(result.error);
      return;
    }
    setDraft(blankDraft());
    onNotify(result.message);
    router.refresh();
  }

  function setDraft(update: MeetingDraft | ((current: MeetingDraft) => MeetingDraft)) {
    setDraftState((current) => {
      const next = typeof update === "function" ? update(current) : update;
      setMeetingDraft(data.team, next);
      return next;
    });
  }

  useEffect(() => {
    const team = data.team;
    return () => {
      if (consumePause(team)) return;
      setMeetingDraft(team, draftRef.current);
    };
  }, [data.team]);

  useEffect(() => {
    if (!draft.running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [draft.running]);

  const step = draft.step;
  const stage = AGENDA[step];
  const clock = formatClock(meetingElapsed(draft, now));

  function goToStep(next: number) {
    if (next < 0 || next >= AGENDA.length) return;
    setDraft((current) => ({ ...current, step: next }));
  }

  return (
    <>
      <PageHeading
        data={data}
        title="A focused 90-minute meeting."
        sub="Drafts stay with their team. Concluding captures a fixed record of what was reviewed."
      />
      <div className="meeting">
        <div className="stack">
          <section className="card">
            <span className="caption sub">Elapsed meeting time</span>
            <div className="timer" aria-live="polite">
              {clock}
            </div>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                setDraft((current) => {
                  if (current.running) {
                    return {
                      ...current,
                      running: false,
                      elapsed:
                        current.elapsed + Math.max(0, Math.floor((Date.now() - current.start) / 1000)),
                    };
                  }
                  return { ...current, running: true, start: Date.now() };
                });
              }}
            >
              {draft.running ? "Pause" : "Start"}
            </button>
          </section>
          <section className="card agenda" aria-label="Meeting agenda">
            {AGENDA.map(([label, minutes], index) => (
              <button
                key={label}
                type="button"
                className={step === index ? "active" : ""}
                onClick={() => goToStep(index)}
              >
                <span>
                  {index + 1}. {label}
                </span>
                <span>{minutes}m</span>
              </button>
            ))}
          </section>
          <p className="mini">
            Demo draft · {OS_TEAM_LABELS[data.team]}
            <br />
            Campus lens: {data.campusLabel}
          </p>
        </div>
        <div className="stack">
          <section className="card">
            <div className="eyebrow">
              Step {step + 1} of 7 · {stage[1]} minutes
            </div>
            <h1>{stage[0]}</h1>
            {step === 0 && (
              <p className="sub">
                Share a personal win and a ministry win. Note any issue that needs discussion later.
              </p>
            )}
            {step === 3 && (
              <>
                <label>
                  People & ministry headlines
                  <textarea
                    value={draft.headlines}
                    placeholder="Team updates and ministry wins"
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, headlines: event.target.value }))
                    }
                  />
                </label>
                <p className="mini">
                  Confidential care and personnel details belong in separately authorized records.
                </p>
              </>
            )}
            {step === 6 && (
              <>
                <label>
                  Key decisions
                  <textarea
                    value={draft.decision}
                    placeholder="Summarize decisions and next steps"
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, decision: event.target.value }))
                    }
                  />
                </label>
                <label>
                  Meeting rating
                  <select
                    aria-label="Meeting rating"
                    value={draft.rating}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, rating: event.target.value }))
                    }
                  >
                    <option value="">Choose a rating</option>
                    {Array.from({ length: 10 }, (_, index) => (
                      <option key={index + 1} value={String(index + 1)}>
                        {index + 1}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="notice">
                  The completed record includes this campus lens, selected metric values and periods, Rocks, to-dos, issues, notes, and the explicit rating. Open work stays on the team’s board.
                </div>
                <button
                  type="button"
                  className="btn primary"
                  disabled={saving}
                  onClick={() => void conclude()}
                >
                  {saving ? "Saving snapshot…" : "Conclude & save snapshot"}
                </button>
              </>
            )}
            {step !== 0 && step !== 3 && step !== 6 && (
              <p className="sub">Review exceptions, capture context, and move discussions to IDS.</p>
            )}
          </section>
          {step === 1 && (
            <ScorecardBoard
              key={`meeting-${data.team}:${data.campus}`}
              data={data}
              onDefine={onDefine}
              onNotify={onNotify}
              showManage={false}
              guardRef={guardRef}
              onDirty={(dirty) => {
                dirtyRef.current = dirty;
              }}
            />
          )}
          {step === 2 && (
            <WorkBoard
              team={data.team}
              kind="rock"
              items={data.items}
              members={data.members}
              canEdit={data.canEdit}
              empty="No Rocks are stored for this team."
            />
          )}
          {step === 4 && (
            <WorkBoard
              team={data.team}
              kind="todo"
              items={data.items}
              members={data.members}
              canEdit={data.canEdit}
              empty="No to-dos are stored for this team."
            />
          )}
          {step === 5 && <IssueBoard data={data} />}
          <section className="card">
            <label>
              Meeting notes
              <textarea
                value={draft.notes}
                placeholder="Discussion and context"
                onChange={(event) =>
                  setDraft((current) => ({ ...current, notes: event.target.value }))
                }
              />
            </label>
            <div className="spaced" style={{ marginTop: 15 }}>
              <button type="button" className="btn" disabled={step === 0} onClick={() => goToStep(step - 1)}>
                ← Previous
              </button>
              <button type="button" className="btn" disabled={step === 6} onClick={() => goToStep(step + 1)}>
                Next section →
              </button>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function askContext(data: OsPageData): OsAskContext {
  return {
    surface: "pulse",
    surfaceLabel: "Pulse Meeting",
    teamLabel: OS_TEAM_LABELS[data.team],
    teamKey: data.team,
    campusLabel: data.campusLabel,
    campusSlug: data.campus === "church-wide" ? null : data.campus,
    periodLabel: data.periodLabel,
    latestSourceUpdate: data.latestSourceUpdate,
    modelConfigured: data.modelConfigured,
    modelMissing: data.modelMissing,
  };
}

function HistoryRecords({
  data,
  href,
}: {
  data: OsPageData;
  href: (next: { view?: string }) => string;
}) {
  const solved = data.items.filter((item) => item.kind === "issue" && item.issueStatus === "solved");
  const rounds = data.voteHistory;
  const archives = data.archives;
  if (solved.length === 0 && rounds.length === 0 && archives.length === 0) {
    return (
      <section className="card">
        <div className="empty">
          <h2>Your first meeting becomes the starting point.</h2>
          <p>No completed meeting is stored for this team.</p>
          <Link className="btn" href={href({ view: "meeting" })}>
            Open meeting
          </Link>
        </div>
      </section>
    );
  }
  return (
    <div className="stack">
      <section className="card">
        <h2>Completed meetings</h2>
        {archives.length === 0 ? (
          <p className="mini">No completed meeting is stored for this team.</p>
        ) : (
          archives.map((archive) => (
            <article key={archive.id} className="row">
              <div>
                <strong>
                  {archive.finishedAt ? new Date(archive.finishedAt).toLocaleString() : "Completed meeting"} · Rating {archive.rating}
                </strong>
                <div className="mini">
                  {OS_TEAM_LABELS[data.team]} · {archive.campusLabel} · Elapsed {archive.elapsedLabel}
                  {archive.overTime ? " · Over the 90 minutes" : ""}
                </div>
                {archive.headlines ? <p>{archive.headlines}</p> : null}
                {archive.decision ? <p>{archive.decision}</p> : null}
                {archive.notes ? <p>{archive.notes}</p> : null}
                <div className="mini">
                  Open Rocks: {archive.openRocks.join(", ") || "None"} · Open to-dos: {archive.openTodos.join(", ") || "None"} · Open issues: {archive.openIssues.join(", ") || "None"}
                </div>
                {archive.measures.length > 0 ? (
                  <div className="mini">
                    {archive.measures
                      .map((measure) => `${measure.label}: ${measure.value == null ? "no value" : measure.value.toLocaleString()} · ${measure.periodLabel}`)
                      .join(" · ")}
                  </div>
                ) : null}
              </div>
            </article>
          ))
        )}
      </section>
      <section className="card">
        <h2>Solved issues</h2>
        {solved.length === 0 ? (
          <p className="mini">No solved issues are stored for this team.</p>
        ) : (
          solved.map((issue) => (
            <p key={issue.id}>
              <strong>{issue.title}</strong>
              {issue.decision ? ` · ${issue.decision}` : ""}
              {issue.owner ? ` · ${issue.owner}` : ""}
            </p>
          ))
        )}
      </section>
      <section className="card">
        <h2>Closed votes</h2>
        {rounds.length === 0 ? (
          <p className="mini">No closed voting round is stored for this team.</p>
        ) : (
          rounds.map((round) => (
            <div key={round.roundId} className="row">
              <div>
                <strong>{round.closedAt ? new Date(round.closedAt).toLocaleString() : "Closed round"}</strong>
                <div className="mini">
                  {round.totals
                    .map((total) => {
                      const title = data.items.find((item) => item.id === total.issueId)?.title ?? "Issue";
                      return `${title}: ${total.votes}`;
                    })
                    .join(" · ") || "No votes"}
                </div>
                <div className="mini">
                  Top 3:{" "}
                  {round.confirmed
                    .map((item) => data.items.find((issue) => issue.id === item.issueId)?.title ?? "Issue")
                    .join(", ") || "Not confirmed"}
                </div>
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function History({
  data,
  href,
}: {
  data: OsPageData;
  href: (next: { view?: string }) => string;
}) {
  return (
    <>
      <PageHeading
        data={data}
        title="Decisions with a memory."
        sub="Completed meetings preserve the values and commitments reviewed at that time."
      />
      <HistoryRecords data={data} href={href} />
    </>
  );
}

function MeasureDialog({ measure, onClose }: { measure: OsMeasure | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (measure && !dialog.open) dialog.showModal();
    if (!measure && dialog.open) dialog.close();
  }, [measure]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {measure && (
        <div>
          <div className="eyebrow">Measure · {measure.key}</div>
          <h1>{measure.label}</h1>
          <div className="value">{showValue(measure)}</div>
          <p>
            {measure.campusLabel} · {measure.periodLabel}
          </p>
          <p>
            <strong>Source:</strong> {measure.sourceLabel}
          </p>
          <p className="sub">{measure.definition}</p>
          <p className="mini">{measure.qualityDetail}</p>
          {measure.history.length > 0 && (
            <p className="mini">
              Earlier readings:{" "}
              {measure.history
                .map((point) => `${point.label} ${point.value == null ? "—" : point.value.toLocaleString()}`)
                .join(" · ")}
            </p>
          )}
          {measure.reportHref && (
            <p>
              <Link href={measure.reportHref}>Open the existing report</Link>
            </p>
          )}
        </div>
      )}
      <form method="dialog" style={{ marginTop: 20 }}>
        <button className="btn" type="submit">
          Close
        </button>
      </form>
    </dialog>
  );
}

function showValue(measure: OsMeasure): string {
  if (measure.value == null) return "—";
  if (measure.unit === "currency") return formatMoney(measure.value);
  return measure.value.toLocaleString();
}
