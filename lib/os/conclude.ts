import { givingWriteAllowed } from "./scorecard";
import type { OsCampus, OsTeam } from "./types";

export const CONCLUDE_SAVED = "The meeting snapshot was saved.";
export const CONCLUDE_NOT_SAVED =
  "The meeting was not saved. The meeting tables are not on this database yet, so nothing was written.";
export const CONCLUDE_NOT_WRITTEN = "The meeting was not saved. Nothing was written.";
export const CONCLUDE_NOT_ALLOWED = "Only a facilitator of this team can conclude the meeting.";
export const MEETING_LIMIT_SECONDS = 90 * 60;
export const CONCLUDE_WRITE_TABLES = ["pulse_sessions", "pulse_archives"] as const;

export type MeetingTimer = {
  elapsedSeconds: number;
  limitSeconds: number;
  remainingSeconds: number;
  overTime: boolean;
};

export type SnapshotMeasure = {
  key: string;
  label: string;
  value: number | null;
  periodLabel: string;
  periodKind: string;
  campusLabel: string;
  quality: string;
};

export type CommitmentRow = {
  id: string;
  kind: "rock" | "todo" | "issue";
  title: string;
  owner: string;
  rockStatus: string | null;
  issueStatus: string | null;
  metricKey: string | null;
};

export type ConcludePlan =
  | { kind: "finish-existing"; sessionId: string; rewriteArchive: false }
  | { kind: "archive-active"; sessionId: string; rewriteArchive: false }
  | { kind: "open-then-archive"; rewriteArchive: false };

export function parseMeetingRating(value: unknown): number | null {
  const rating = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(rating) || rating < 1 || rating > 10) return null;
  return rating;
}

export function meetingTimerResult(elapsedSeconds: number): MeetingTimer {
  const elapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, Math.min(Math.floor(elapsedSeconds), 24 * 60 * 60)) : 0;
  return {
    elapsedSeconds: elapsed,
    limitSeconds: MEETING_LIMIT_SECONDS,
    remainingSeconds: Math.max(0, MEETING_LIMIT_SECONDS - elapsed),
    overTime: elapsed > MEETING_LIMIT_SECONDS,
  };
}

export function formatElapsed(totalSeconds: number): string {
  const shown = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(shown / 60)).padStart(2, "0")}:${String(shown % 60).padStart(2, "0")}`;
}

export function concludePersistencePlan(input: {
  activeSessionId: string | null;
  activeArchiveId: string | null;
}): ConcludePlan {
  if (input.activeSessionId && input.activeArchiveId) {
    return { kind: "finish-existing", sessionId: input.activeSessionId, rewriteArchive: false };
  }
  if (input.activeSessionId) {
    return { kind: "archive-active", sessionId: input.activeSessionId, rewriteArchive: false };
  }
  return { kind: "open-then-archive", rewriteArchive: false };
}

export function snapshotCommitments(rows: readonly CommitmentRow[], team: OsTeam, canReadGiving: boolean) {
  const visible = rows.map((row) => ({
    ...row,
    metricKey:
      row.metricKey === "giving" &&
      !givingWriteAllowed({ team, canReadGiving, metricKey: "giving", campus: "church-wide" }).allowed
        ? null
        : row.metricKey,
    rockStatus: row.rockStatus,
    issueStatus: row.issueStatus,
  }));
  return {
    rocks: visible.filter((row) => row.kind === "rock" && row.rockStatus !== "complete"),
    todos: visible.filter((row) => row.kind === "todo" && row.rockStatus !== "complete"),
    issues: visible.filter((row) => row.kind === "issue" && row.issueStatus !== "solved"),
  };
}

export function splitSnapshotMeasures(
  measures: readonly SnapshotMeasure[],
  input: { team: OsTeam; canReadGiving: boolean; campus: string }
): { shared: SnapshotMeasure[]; giving: SnapshotMeasure[] } {
  const shared: SnapshotMeasure[] = [];
  const giving: SnapshotMeasure[] = [];
  for (const measure of measures) {
    if (measure.key !== "giving") {
      shared.push(measure);
      continue;
    }
    const gate = givingWriteAllowed({
      team: input.team,
      canReadGiving: input.canReadGiving,
      metricKey: "giving",
      campus: input.campus,
    });
    if (gate.allowed) giving.push(measure);
  }
  return { shared, giving };
}

function clip(value: string): string {
  return value.trim().slice(0, 4000);
}

export function buildMeetingSnapshot(input: {
  team: OsTeam;
  campus: OsCampus;
  campusLabel: string;
  notes: string;
  headlines: string;
  decision: string;
  rating: number;
  timer: MeetingTimer;
  stage: number;
  measures: readonly SnapshotMeasure[];
  commitments: readonly CommitmentRow[];
  canReadGiving: boolean;
}): {
  snapshot: Record<string, unknown>;
  givingSnapshot: { measures: SnapshotMeasure[] } | null;
} {
  const split = splitSnapshotMeasures(input.measures, {
    team: input.team,
    canReadGiving: input.canReadGiving,
    campus: input.campus,
  });
  const stage = Number.isInteger(input.stage) && input.stage >= 0 && input.stage <= 6 ? input.stage : 6;
  return {
    snapshot: {
      snapshotVersion: 1,
      team: input.team,
      campus: input.campus,
      campusLabel: input.campusLabel,
      notes: clip(input.notes),
      headlines: clip(input.headlines),
      decision: clip(input.decision),
      rating: input.rating,
      timer: input.timer,
      stage,
      measures: split.shared,
      openCommitments: snapshotCommitments(input.commitments, input.team, input.canReadGiving),
    },
    givingSnapshot: split.giving.length ? { measures: split.giving } : null,
  };
}

export function measuresForReader(
  shared: readonly SnapshotMeasure[],
  giving: readonly SnapshotMeasure[],
  input: { team: OsTeam; canReadGiving: boolean; campus: string }
): SnapshotMeasure[] {
  const safe = shared.filter((measure) => measure.key !== "giving");
  const gate = givingWriteAllowed({
    team: input.team,
    canReadGiving: input.canReadGiving,
    metricKey: "giving",
    campus: input.campus,
  });
  return gate.allowed ? [...safe, ...giving] : safe;
}
