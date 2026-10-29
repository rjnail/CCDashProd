import assert from "node:assert/strict";
import test from "node:test";
import {
  applyLinkedTodo,
  linkedTodoDraft,
  normalizeSelection,
  requireResolution,
  resolutionWrite,
  suggestOrder,
  tangentCaptureResult,
  toggleVote,
  visibleIssueNotes,
  voteVisibility,
  withIssueNote,
} from "./ids";

test("a person can select at most three different open issues", () => {
  const first = toggleVote([], "a");
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = toggleVote(first.selected, "b");
  assert.equal(second.ok, true);
  if (!second.ok) return;
  const third = toggleVote(second.selected, "c");
  assert.equal(third.ok, true);
  if (!third.ok) return;
  const fourth = toggleVote(third.selected, "d");
  assert.equal(fourth.ok, false);
  const again = toggleVote(third.selected, "a");
  assert.equal(again.ok, true);
  if (again.ok) assert.deepEqual(again.selected, ["b", "c"]);
  const normalized = normalizeSelection(["a", "a", "b", "c", "d"], ["a", "b", "c", "d"]);
  assert.equal(normalized.ok, false);
});

test("open rounds hide other people's votes and totals", () => {
  const hidden = voteVisibility({
    roundStatus: "open",
    myIssueIds: ["a"],
    ballots: [
      { voterId: "other-person", issueId: "a" },
      { voterId: "other-person", issueId: "b" },
    ],
  });
  assert.equal(hidden.totals, null);
  assert.equal(hidden.remaining, 2);
  assert.equal(JSON.stringify(hidden).includes("other-person"), false);

  const closed = voteVisibility({
    roundStatus: "closed",
    myIssueIds: ["a"],
    ballots: [
      { voterId: "me", issueId: "a" },
      { voterId: "other-person", issueId: "a" },
    ],
  });
  assert.equal(closed.totals?.find((row) => row.issueId === "a")?.votes, 2);
  assert.equal(JSON.stringify(closed).includes("other-person"), false);
});

test("creating a linked to-do does not solve the issue", () => {
  const draft = linkedTodoDraft({
    title: "Call the campus lead",
    ownerUserId: "owner-2",
    dueOn: "2026-11-05",
  });
  assert.equal(draft.ok, true);
  if (!draft.ok) return;
  assert.equal(draft.solvesIssue, false);
  assert.equal(draft.ownerUserId, "owner-2");
  const issue = applyLinkedTodo({ status: "open", title: "Roster gap" });
  assert.equal(issue.status, "open");
});

test("tangent capture keeps notes, stage, and the timer", () => {
  const state = { notes: "Still on the root cause", stage: "discuss", elapsed: 240 };
  const result = tangentCaptureResult(state, "Parking question");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.notes, "Still on the root cause");
  assert.equal(result.state.stage, "discuss");
  assert.equal(result.state.elapsed, 240);
  assert.equal(result.issue.status, "open");
  assert.equal(state.notes, "Still on the root cause");
});

test("issue notes stay on the existing record and keep an older note when another is added", () => {
  assert.deepEqual(visibleIssueNotes({ notes: "Root cause is still open" }), [
    { id: "notes", text: "Root cause is still open", createdAt: "", authorUserId: null },
  ]);
  const saved = withIssueNote({
    notes: "Root cause is still open",
    comments: [],
    added: { id: "n2", text: "Owner will bring a proposal", createdAt: "2026-10-29", authorUserId: "user-1" },
  });
  assert.equal(saved.comments.length, 2);
  assert.match(saved.notes, /Root cause is still open/);
  assert.match(saved.notes, /Owner will bring a proposal/);
  assert.equal(visibleIssueNotes({ notes: saved.notes, comments: saved.comments }).length, 2);
});

test("a blank resolution cannot solve an issue, and a repeated key does not write twice", () => {
  assert.equal(requireResolution("  ").ok, false);
  assert.equal(requireResolution("Decide the owner").ok, true);
  assert.equal(resolutionWrite(["key-1"], "key-1"), "replay");
  assert.equal(resolutionWrite(["key-1"], "key-2"), "write");
});

test("suggested order keeps a tie at the cutoff visible", () => {
  const suggestion = suggestOrder(
    [
      { id: "a", sortOrder: 1, createdAt: "2026-10-01" },
      { id: "b", sortOrder: 2, createdAt: "2026-10-02" },
      { id: "c", sortOrder: 3, createdAt: "2026-10-03" },
      { id: "d", sortOrder: 4, createdAt: "2026-10-04" },
    ],
    [
      { issueId: "a", votes: 3 },
      { issueId: "b", votes: 2 },
      { issueId: "c", votes: 1 },
      { issueId: "d", votes: 1 },
    ]
  );
  assert.deepEqual(suggestion.order, ["a", "b", "c"]);
  assert.deepEqual(suggestion.tieIssueIds, ["c", "d"]);
});
