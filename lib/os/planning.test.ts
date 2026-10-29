import assert from "node:assert/strict";
import test from "node:test";
import {
  applySectionWrite,
  approveVersion,
  archiveSeat,
  buildVersion,
  canManageSeats,
  contentFields,
  dropTeamOverride,
  emptyContent,
  givingAllowedForTeam,
  keepSavedVersion,
  parentChoiceAllowed,
  parseSectionContent,
  planningAccess,
  planningWriteAllowed,
  resolveSection,
  seatAssignmentGrantsAccess,
  seatRowForSave,
  sectionVisibleToScope,
  concurrentEditResult,
  tractionNote,
  validateSeatDraft,
  verifiedRecordRefs,
  versionHasSubstance,
  wouldCreateCycle,
  type SectionRecord,
  type SeatNode,
} from "./planning";

const at = "2026-10-29T18:00:00.000Z";

function record(partial: Partial<SectionRecord> & Pick<SectionRecord, "scope" | "key" | "content">): SectionRecord {
  return {
    updatedAt: at,
    updatedBy: "user-1",
    updatedByName: "Existing member",
    ...partial,
  };
}

test("empty drafts do not carry the reference sample copy", () => {
  const blob = JSON.stringify(["values", "focus", "target", "strategy", "picture", "annual", "swotStrengths"].map((key) => emptyContent(key as "values")));
  assert.equal(blob.includes("Love people well"), false);
  assert.equal(blob.includes("Help people follow Jesus"), false);
  assert.equal(blob.includes("Lead Pastor"), false);
  assert.equal(blob.includes("Alex"), false);
});

test("core focus keeps purpose and niche as separate fields", () => {
  const parsed = parseSectionContent("focus", { kind: "focus", purpose: "A purpose", niche: "A niche" });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const fields = contentFields(parsed.content);
  assert.deepEqual(fields.map((field) => field.label), ["Purpose / cause / passion", "Niche"]);
  assert.equal(parseSectionContent("focus", "purpose and niche in one blob").ok, false);
});

test("a team edit does not overwrite church-wide content", () => {
  const church = record({
    scope: "church",
    key: "values",
    content: { kind: "values", values: ["Shared value"] },
  });
  const before = structuredClone(church);
  const result = applySectionWrite({
    church,
    own: null,
    scope: "pastoral",
    key: "values",
    content: { kind: "values", values: ["Team value"] },
    actorId: "facilitator",
    at,
  });
  assert.deepEqual(church, before);
  assert.deepEqual(result.church, before);
  assert.deepEqual(result.own?.content, { kind: "values", values: ["Team value"] });
  assert.equal(result.own?.scope, "pastoral");
});

test("a church-wide edit does not overwrite a team section", () => {
  const own = record({
    scope: "leadership",
    key: "focus",
    content: { kind: "focus", purpose: "Team purpose", niche: "Team niche" },
  });
  const result = applySectionWrite({
    church: null,
    own,
    scope: "church",
    key: "focus",
    content: { kind: "focus", purpose: "Church purpose", niche: "" },
    actorId: "admin",
    at,
  });
  assert.equal(result.church?.content.kind, "focus");
  assert.deepEqual(result.own, own);
});

test("team sections inherit the church-wide reference and can return to it", () => {
  const church = record({
    scope: "church",
    key: "picture",
    content: { kind: "picture", futureDate: "2029-01-01", outcomes: [], description: "Shared picture" },
  });
  const inherited = resolveSection({ key: "picture", scope: "executive", church, own: null });
  assert.equal(inherited.inherited, true);
  assert.equal(inherited.badge, "Church-wide reference");
  assert.equal(inherited.content.kind === "picture" && inherited.content.description, "Shared picture");
  const own = record({
    scope: "executive",
    key: "picture",
    content: { kind: "picture", futureDate: "", outcomes: [], description: "Team picture" },
  });
  const local = resolveSection({ key: "picture", scope: "executive", church, own });
  assert.equal(local.inherited, false);
  assert.equal(local.badge, "Team draft");
  const returned = dropTeamOverride({ church, own });
  assert.equal(returned.own, null);
  assert.deepEqual(returned.church, church);
  const again = resolveSection({ key: "picture", scope: "executive", church: returned.church, own: returned.own });
  assert.equal(again.inherited, true);
});

test("SWOT is not inherited from the church or from another team", () => {
  const church = record({
    scope: "church",
    key: "swotStrengths",
    content: { kind: "swot", items: ["Church strength"] },
  });
  const pastoral = record({
    scope: "pastoral",
    key: "swotStrengths",
    content: { kind: "swot", items: ["Pastoral strength"] },
  });
  assert.equal(sectionVisibleToScope(pastoral, "leadership"), false);
  assert.equal(sectionVisibleToScope(church, "leadership"), false);
  const leadership = resolveSection({ key: "swotStrengths", scope: "leadership", church, own: null });
  assert.equal(leadership.inherited, false);
  assert.deepEqual(leadership.content, { kind: "swot", items: [] });
  const stillPastoral = resolveSection({ key: "swotStrengths", scope: "pastoral", church, own: pastoral });
  assert.deepEqual(stillPastoral.content, { kind: "swot", items: ["Pastoral strength"] });
  assert.equal(stillPastoral.inherited, false);
});

test("a facilitator cannot edit church-wide planning or another team's draft", () => {
  const facilitator = {
    isAdmin: false,
    canEditBenchmarks: false,
    facilitatorTeams: ["pastoral" as const],
  };
  assert.equal(planningWriteAllowed({ ...facilitator, scope: "church" }).ok, false);
  assert.equal(planningWriteAllowed({ ...facilitator, scope: "leadership" }).ok, false);
  assert.equal(planningWriteAllowed({ ...facilitator, scope: "pastoral" }).ok, true);
  assert.equal(planningWriteAllowed({ ...facilitator, canEditBenchmarks: true, scope: "church" }).ok, true);
});

test("saved versions stay fixed when later drafts change", () => {
  const church = record({
    scope: "church",
    key: "values",
    content: { kind: "values", values: ["First"] },
  });
  const saved = buildVersion({
    id: "version-1",
    scope: "church",
    authorId: "admin",
    createdAt: at,
    church: { values: church },
    own: {},
    rockIds: ["rock-1"],
    issueIds: [],
  });
  const proposed = structuredClone(saved);
  proposed.createdAt = "2027-01-01T00:00:00.000Z";
  proposed.sections[0] = { key: "values", content: { kind: "values", values: ["Rewritten"] }, inherited: false };
  proposed.recordRefs.rocks = ["other-rock"];
  const kept = keepSavedVersion(saved, proposed);
  assert.deepEqual(kept, saved);
  assert.notDeepEqual(kept, proposed);
  const approved = approveVersion({
    version: saved,
    alreadyApproved: false,
    isAdmin: true,
    actorId: "admin",
    at: "2026-10-29T19:00:00.000Z",
    id: "pub-1",
  });
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  assert.deepEqual(approved.version, saved);
  assert.equal(approved.publication.status, "approved");
  assert.notEqual(approved.publication.id, saved.id);
});

test("empty starter content cannot be approved", () => {
  const saved = buildVersion({
    id: "version-empty",
    scope: "church",
    authorId: "admin",
    createdAt: at,
    church: {},
    own: {},
    rockIds: [],
    issueIds: [],
  });
  assert.equal(versionHasSubstance(saved), false);
  const result = approveVersion({
    version: saved,
    alreadyApproved: false,
    isAdmin: true,
    actorId: "admin",
    at,
    id: "pub-empty",
  });
  assert.deepEqual(result, { ok: false, reason: "Empty starter content cannot be approved." });
  assert.equal(approveVersion({ version: saved, alreadyApproved: false, isAdmin: false, actorId: "user", at, id: "x" }).ok, false);
});

test("a stale edit does not replace a newer save", () => {
  assert.equal(concurrentEditResult("2026-10-29T18:00:00.000Z", "2026-10-29T18:05:00.000Z"), "conflict");
  assert.equal(concurrentEditResult(null, "2026-10-29T18:00:00.000Z"), "conflict");
  assert.equal(concurrentEditResult("2026-10-29T18:00:00.000Z", null), "conflict");
  assert.equal(concurrentEditResult(null, null), "insert");
  assert.equal(concurrentEditResult("2026-10-29T18:00:00.000Z", "2026-10-29T18:00:00.000Z"), "update");
});

test("linked rocks and issues keep real ids only", () => {
  assert.deepEqual(
    verifiedRecordRefs(
      { rocks: ["rock-1", "fictional-rock"], issues: ["issue-1", "sample-issue"] },
      { rocks: ["rock-1"], issues: ["issue-1"] }
    ),
    { rocks: ["rock-1"], issues: ["issue-1"] }
  );
});

test("church-wide traction says when work is filtered to a team", () => {
  assert.match(tractionNote("church", "pastoral") ?? "", /Filtered to Pastoral Team/);
  assert.equal(tractionNote("pastoral", "pastoral"), null);
});

test("seat reparenting rejects cycles", () => {
  const seats = [
    { id: "a", parentId: null },
    { id: "b", parentId: "a" },
    { id: "c", parentId: "b" },
  ];
  assert.equal(wouldCreateCycle(seats, "a", "c"), true);
  assert.equal(wouldCreateCycle(seats, "b", "b"), true);
  assert.equal(wouldCreateCycle(seats, "c", "a"), false);
  assert.equal(parentChoiceAllowed(seats, "a", "c").ok, false);
  assert.equal(parentChoiceAllowed(seats, "c", "missing").ok, false);
  assert.equal(parentChoiceAllowed(seats, "new-seat", "b").ok, true);
});

test("a seat person must be chosen from eligible users", () => {
  const eligible = ["user-1"];
  const named = validateSeatDraft({
    title: "Finance",
    functionLabel: "Stewardship",
    personId: null,
    accountabilities: ["Close the month"],
    eligiblePersonIds: eligible,
    freeTextPerson: "Alex",
  });
  assert.equal(named.ok, false);
  const unknown = validateSeatDraft({
    title: "Finance",
    functionLabel: "Stewardship",
    personId: "Alex",
    accountabilities: ["Close the month"],
    eligiblePersonIds: eligible,
  });
  assert.equal(unknown.ok, false);
  const vacant = validateSeatDraft({
    title: "Finance",
    functionLabel: "Stewardship",
    personId: null,
    accountabilities: ["Close the month"],
    eligiblePersonIds: eligible,
  });
  assert.equal(vacant.ok, true);
  if (!vacant.ok) return;
  assert.equal(vacant.personId, null);
  const tooMany = validateSeatDraft({
    title: "Finance",
    functionLabel: "Stewardship",
    personId: "user-1",
    accountabilities: ["1", "2", "3", "4", "5", "6"],
    eligiblePersonIds: eligible,
  });
  assert.equal(tooMany.ok, false);
});

test("archive asks what happens to seats below and to references", () => {
  const seats: SeatNode[] = [
    seat("a", null),
    seat("b", "a"),
    seat("c", "b"),
  ];
  const references = [{ id: "ref-1", seatId: "b", label: "Planning note" }];
  assert.equal(archiveSeat({ seats, seatId: "b", at, subordinateChoice: null, referenceChoice: "keep", references }).ok, false);
  assert.equal(archiveSeat({ seats, seatId: "b", at, subordinateChoice: "move_to_parent", referenceChoice: null, references }).ok, false);
  const moved = archiveSeat({
    seats,
    seatId: "b",
    at,
    subordinateChoice: "move_to_parent",
    referenceChoice: "detach",
    references,
  });
  assert.equal(moved.ok, true);
  if (!moved.ok) return;
  assert.equal(moved.seats.find((item) => item.id === "c")?.parentId, "a");
  assert.equal(moved.seats.find((item) => item.id === "b")?.archivedAt, at);
  assert.equal(moved.references[0]?.seatId, null);
  const archived = archiveSeat({
    seats,
    seatId: "a",
    at,
    subordinateChoice: "archive_with_seat",
    referenceChoice: "keep",
    references: [],
  });
  assert.equal(archived.ok, true);
  if (!archived.ok) return;
  assert.equal(archived.seats.every((item) => item.archivedAt === at), true);
});

test("seat management and giving stay separate", () => {
  const executiveFacilitator = planningAccess({
    isAdmin: false,
    canEditBenchmarks: false,
    facilitatorTeams: ["executive"],
    team: "executive",
    financialInsights: true,
  });
  assert.equal(executiveFacilitator.canManageSeats, false);
  assert.equal(executiveFacilitator.canEditChurchPlanning, false);
  assert.equal(executiveFacilitator.givingAllowed, true);

  const adminOnPastoral = planningAccess({
    isAdmin: true,
    canEditBenchmarks: false,
    facilitatorTeams: [],
    team: "pastoral",
    financialInsights: false,
  });
  assert.equal(adminOnPastoral.canManageSeats, true);
  assert.equal(adminOnPastoral.canApprove, true);
  assert.equal(adminOnPastoral.givingAllowed, false);
  assert.equal(givingAllowedForTeam({ team: "pastoral", financialInsights: true, isAdmin: false }), false);

  const benchmarkEditor = planningAccess({
    isAdmin: false,
    canEditBenchmarks: true,
    facilitatorTeams: [],
    team: "executive",
    financialInsights: false,
  });
  assert.equal(benchmarkEditor.canEditChurchPlanning, true);
  assert.equal(benchmarkEditor.canManageSeats, false);
  assert.equal(canManageSeats({ isAdmin: false }), false);

  const before = { canReadGiving: false, capability: "facilitator" as string | null };
  const after = seatAssignmentGrantsAccess(before, "user-1");
  assert.equal(after.canReadGiving, false);
  assert.equal(after.capability, "facilitator");
  const row = seatRowForSave({
    title: "Finance",
    functionLabel: "Stewardship",
    personId: "user-1",
    parentId: null,
    accountabilities: ["Close the month"],
  });
  assert.equal("capability" in row, false);
  assert.equal("financial_insights" in row, false);
  assert.equal(row.person_id, "user-1");
});

function seat(id: string, parentId: string | null): SeatNode {
  return {
    id,
    title: id,
    functionLabel: "Function",
    personId: null,
    personName: null,
    parentId,
    accountabilities: ["Own the function"],
    updatedAt: at,
    archivedAt: null,
  };
}
