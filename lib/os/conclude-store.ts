import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  CONCLUDE_NOT_SAVED,
  CONCLUDE_NOT_WRITTEN,
  buildMeetingSnapshot,
  concludePersistencePlan,
  formatElapsed,
  meetingTimerResult,
  measuresForReader,
  type CommitmentRow,
  type SnapshotMeasure,
} from "./conclude";
import { isMissingPulseTable } from "./pulse-db";
import { pulseCampusLabel } from "./rules";
import type { OsCampus, OsMeetingArchive, OsTeam } from "./types";

type SaveResult = { ok: true; id: string } | { ok: false; error: string };

const CAMPUSES = new Set<OsCampus>(["church-wide", "mount-pleasant", "alma", "st-johns"]);

function adminClient(): SupabaseClient | null {
  try {
    return createAdminClient();
  } catch {
    return null;
  }
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
  return {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function measuresOf(value: unknown): SnapshotMeasure[] {
  if (!Array.isArray(value)) return [];
  const measures: SnapshotMeasure[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const key = text(record.key);
    if (!key || key === "giving") continue;
    measures.push({
      key,
      label: text(record.label) || key,
      value: typeof record.value === "number" ? record.value : null,
      periodLabel: text(record.periodLabel),
      periodKind: text(record.periodKind),
      campusLabel: text(record.campusLabel),
      quality: text(record.quality),
    });
  }
  return measures;
}

function givingMeasuresOf(value: unknown): SnapshotMeasure[] {
  const record = asObject(value);
  if (!Array.isArray(record.measures)) return [];
  const measures: SnapshotMeasure[] = [];
  for (const row of record.measures) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    if (item.key !== "giving") continue;
    measures.push({
      key: "giving",
      label: text(item.label) || "Giving",
      value: typeof item.value === "number" ? item.value : null,
      periodLabel: text(item.periodLabel),
      periodKind: text(item.periodKind),
      campusLabel: text(item.campusLabel),
      quality: text(item.quality),
    });
  }
  return measures;
}

function titles(value: unknown, kind: string): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row) => row && typeof row === "object" && (row as { kind?: string }).kind === kind)
    .map((row) => text((row as { title?: unknown }).title))
    .filter(Boolean);
}

function campusOf(value: unknown): OsCampus {
  return typeof value === "string" && CAMPUSES.has(value as OsCampus) ? (value as OsCampus) : "church-wide";
}

export async function readMeetingArchives(input: {
  team: OsTeam;
  canReadGiving: boolean;
}): Promise<OsMeetingArchive[]> {
  const admin = adminClient();
  if (!admin) return [];
  const { data, error } = await admin
    .from("pulse_archives")
    .select("id, session_id, team, campus, finished_at, rating, snapshot, giving_snapshot")
    .eq("team", input.team)
    .order("finished_at", { ascending: false });
  if (isMissingPulseTable(error) || error) return [];
  const archives: OsMeetingArchive[] = [];
  for (const row of data ?? []) {
    const snapshot = asObject(row.snapshot);
    const campus = campusOf(row.campus ?? snapshot.campus);
    const timer = asObject(snapshot.timer);
    const elapsed = typeof timer.elapsedSeconds === "number" ? timer.elapsedSeconds : 0;
    const open = asObject(snapshot.openCommitments);
    const measures = measuresForReader(measuresOf(snapshot.measures), givingMeasuresOf(row.giving_snapshot), {
      team: input.team,
      canReadGiving: input.canReadGiving,
      campus,
    });
    archives.push({
      id: String(row.id),
      sessionId: String(row.session_id),
      finishedAt: text(row.finished_at),
      rating: typeof row.rating === "number" ? row.rating : 0,
      campus,
      campusLabel: text(snapshot.campusLabel) || pulseCampusLabel(campus),
      notes: text(snapshot.notes),
      headlines: text(snapshot.headlines),
      decision: text(snapshot.decision),
      elapsedLabel: formatElapsed(elapsed),
      overTime: timer.overTime === true,
      openRocks: titles(open.rocks, "rock"),
      openTodos: titles(open.todos, "todo"),
      openIssues: titles(open.issues, "issue"),
      measures: measures.map((measure) => ({
        key: measure.key,
        label: measure.label,
        value: measure.value,
        periodLabel: measure.periodLabel,
        campusLabel: measure.campusLabel,
      })),
    });
  }
  return archives;
}

async function loadCommitments(admin: SupabaseClient, team: OsTeam): Promise<CommitmentRow[] | "missing"> {
  const { data, error } = await admin
    .from("pulse_items")
    .select("id, kind, title, details, rock_status, issue_status, metric_key")
    .eq("team", team)
    .in("kind", ["rock", "todo", "issue"])
    .is("removed_at", null);
  if (isMissingPulseTable(error)) return "missing";
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const details = asObject(row.details);
    const kind = row.kind === "todo" || row.kind === "issue" ? row.kind : "rock";
    return {
      id: String(row.id),
      kind,
      title: text(row.title),
      owner: text(details.owner),
      rockStatus: typeof row.rock_status === "string" ? row.rock_status : null,
      issueStatus: typeof row.issue_status === "string" ? row.issue_status : null,
      metricKey: typeof row.metric_key === "string" ? row.metric_key : null,
    };
  });
}

export async function saveConcludedMeeting(input: {
  team: OsTeam;
  userId: string;
  campus: OsCampus;
  campusLabel: string;
  notes: string;
  headlines: string;
  decision: string;
  rating: number;
  elapsedSeconds: number;
  stage: number;
  measures: readonly SnapshotMeasure[];
  canReadGiving: boolean;
}): Promise<SaveResult> {
  const admin = adminClient();
  if (!admin) return { ok: false, error: CONCLUDE_NOT_WRITTEN };
  const commitments = await loadCommitments(admin, input.team);
  if (commitments === "missing") return { ok: false, error: CONCLUDE_NOT_SAVED };
  const timer = meetingTimerResult(input.elapsedSeconds);
  const built = buildMeetingSnapshot({
    team: input.team,
    campus: input.campus,
    campusLabel: input.campusLabel,
    notes: input.notes,
    headlines: input.headlines,
    decision: input.decision,
    rating: input.rating,
    timer,
    stage: input.stage,
    measures: input.measures,
    commitments,
    canReadGiving: input.canReadGiving,
  });
  const active = await admin
    .from("pulse_sessions")
    .select("id")
    .eq("team", input.team)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (isMissingPulseTable(active.error)) return { ok: false, error: CONCLUDE_NOT_SAVED };
  if (active.error) return { ok: false, error: CONCLUDE_NOT_WRITTEN };
  const activeId = typeof active.data?.id === "string" ? active.data.id : null;
  let activeArchiveId: string | null = null;
  if (activeId) {
    const existing = await admin
      .from("pulse_archives")
      .select("id")
      .eq("session_id", activeId)
      .limit(1)
      .maybeSingle();
    if (isMissingPulseTable(existing.error)) return { ok: false, error: CONCLUDE_NOT_SAVED };
    if (existing.error) return { ok: false, error: CONCLUDE_NOT_WRITTEN };
    activeArchiveId = typeof existing.data?.id === "string" ? existing.data.id : null;
  }
  const plan = concludePersistencePlan({ activeSessionId: activeId, activeArchiveId });
  const now = new Date().toISOString();
  const sessionFields = {
    notes: built.snapshot.notes,
    headlines: built.snapshot.headlines,
    decision: built.snapshot.decision,
    campus: input.campus,
    stage: built.snapshot.stage,
    paused_ms: timer.elapsedSeconds * 1000,
    paused_at: now,
    updated_at: now,
  };

  if (plan.kind === "finish-existing") {
    const finished = await admin
      .from("pulse_sessions")
      .update({ status: "finished", updated_at: now })
      .eq("id", plan.sessionId)
      .eq("status", "active");
    if (isMissingPulseTable(finished.error)) return { ok: false, error: CONCLUDE_NOT_SAVED };
    if (finished.error) return { ok: false, error: CONCLUDE_NOT_WRITTEN };
    return { ok: true, id: activeArchiveId ?? plan.sessionId };
  }

  let sessionId = plan.kind === "archive-active" ? plan.sessionId : null;
  if (!sessionId) {
    const opened = await admin
      .from("pulse_sessions")
      .insert({
        team: input.team,
        status: "active",
        created_by: input.userId,
        ...sessionFields,
      })
      .select("id")
      .single();
    if (isMissingPulseTable(opened.error)) return { ok: false, error: CONCLUDE_NOT_SAVED };
    if (opened.error || !opened.data?.id) return { ok: false, error: CONCLUDE_NOT_WRITTEN };
    sessionId = opened.data.id as string;
  }

  const archived = await admin
    .from("pulse_archives")
    .insert({
      session_id: sessionId,
      team: input.team,
      campus: input.campus,
      rating: input.rating,
      snapshot: built.snapshot,
      giving_snapshot: built.givingSnapshot,
    })
    .select("id")
    .single();
  if (isMissingPulseTable(archived.error)) return { ok: false, error: CONCLUDE_NOT_SAVED };
  if (archived.error || !archived.data?.id) return { ok: false, error: CONCLUDE_NOT_WRITTEN };

  const finished = await admin
    .from("pulse_sessions")
    .update({ ...sessionFields, status: "finished" })
    .eq("id", sessionId);
  if (isMissingPulseTable(finished.error)) return { ok: false, error: CONCLUDE_NOT_SAVED };
  if (finished.error) return { ok: false, error: CONCLUDE_NOT_WRITTEN };
  return { ok: true, id: archived.data.id as string };
}
