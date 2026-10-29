import assert from "node:assert/strict";
import test from "node:test";
import {
  CONCLUDE_WRITE_TABLES,
  buildMeetingSnapshot,
  concludePersistencePlan,
  measuresForReader,
  snapshotCommitments,
  type CommitmentRow,
  type SnapshotMeasure,
} from "./conclude";

const giving: SnapshotMeasure = {
  key: "giving",
  label: "Giving",
  value: 1200,
  periodLabel: "Monthly total",
  periodKind: "closed_month",
  campusLabel: "Church-wide",
  quality: "available",
};

const attendance: SnapshotMeasure = {
  key: "attendance",
  label: "Sunday attendance",
  value: 400,
  periodLabel: "Weekly Sunday",
  periodKind: "sunday",
  campusLabel: "Church-wide",
  quality: "available",
};

const openItems: CommitmentRow[] = [
  { id: "rock-1", kind: "rock", title: "Open rock", owner: "A", rockStatus: "on_track", issueStatus: null, metricKey: null },
  { id: "todo-1", kind: "todo", title: "Open to-do", owner: "B", rockStatus: "off_track", issueStatus: null, metricKey: "giving" },
  { id: "issue-1", kind: "issue", title: "Open issue", owner: "C", rockStatus: null, issueStatus: "open", metricKey: null },
  { id: "issue-2", kind: "issue", title: "Solved issue", owner: "C", rockStatus: null, issueStatus: "solved", metricKey: null },
];

test("conclude keeps open commitments unchanged and writes only the meeting record", () => {
  const open = snapshotCommitments(openItems, "pastoral", true);
  assert.deepEqual(
    open.rocks.map((item) => item.rockStatus),
    ["on_track"]
  );
  assert.deepEqual(
    open.todos.map((item) => item.rockStatus),
    ["off_track"]
  );
  assert.equal(open.issues.length, 1);
  assert.equal(open.issues[0]?.issueStatus, "open");
  assert.equal(open.todos[0]?.metricKey, null);
  assert.equal(openItems[1]?.metricKey, "giving");
  assert.deepEqual(CONCLUDE_WRITE_TABLES, ["pulse_sessions", "pulse_archives"]);
});

test("a pastoral snapshot omits giving and a finished archive is not rewritten", () => {
  const built = buildMeetingSnapshot({
    team: "pastoral",
    campus: "alma",
    campusLabel: "Alma",
    notes: "Notes",
    headlines: "Headlines",
    decision: "Decisions",
    rating: 8,
    timer: { elapsedSeconds: 100, limitSeconds: 5400, remainingSeconds: 5300, overTime: false },
    stage: 6,
    measures: [giving, attendance],
    commitments: openItems,
    canReadGiving: true,
  });
  assert.equal(built.givingSnapshot, null);
  assert.equal(JSON.stringify(built.snapshot).includes('"key":"giving"'), false);
  assert.equal(JSON.stringify(built.snapshot).includes('"metricKey":"giving"'), false);
  assert.equal((built.snapshot.measures as SnapshotMeasure[])[0]?.key, "attendance");
  assert.equal(built.snapshot.notes, "Notes");
  assert.equal(built.snapshot.headlines, "Headlines");
  assert.equal(built.snapshot.decision, "Decisions");
  assert.equal(built.snapshot.campus, "alma");
  const again = concludePersistencePlan({ activeSessionId: "session-1", activeArchiveId: "archive-1" });
  assert.equal(again.kind, "finish-existing");
  assert.equal(again.rewriteArchive, false);
  const first = concludePersistencePlan({ activeSessionId: null, activeArchiveId: null });
  assert.equal(first.kind, "open-then-archive");
  assert.equal(first.rewriteArchive, false);
});

test("executive giving stays out of the shared snapshot and is hidden from readers without access", () => {
  const built = buildMeetingSnapshot({
    team: "executive",
    campus: "church-wide",
    campusLabel: "Church-wide",
    notes: "",
    headlines: "",
    decision: "",
    rating: 9,
    timer: { elapsedSeconds: 10, limitSeconds: 5400, remainingSeconds: 5390, overTime: false },
    stage: 6,
    measures: [giving, attendance],
    commitments: [],
    canReadGiving: true,
  });
  assert.equal(JSON.stringify(built.snapshot).includes('"key":"giving"'), false);
  assert.equal(built.givingSnapshot?.measures[0]?.value, 1200);
  const hidden = measuresForReader([], built.givingSnapshot?.measures ?? [], {
    team: "executive",
    canReadGiving: false,
    campus: "church-wide",
  });
  assert.equal(hidden.some((measure) => measure.key === "giving"), false);
  const shown = measuresForReader([], built.givingSnapshot?.measures ?? [], {
    team: "executive",
    canReadGiving: true,
    campus: "church-wide",
  });
  assert.equal(shown[0]?.value, 1200);
});
