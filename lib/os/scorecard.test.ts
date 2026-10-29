import assert from "node:assert/strict";
import test from "node:test";
import {
  SCORECARD_WRITE_TABLES,
  addReading,
  applyRowSave,
  canEditChurchwideTarget,
  canMutateTeam,
  displayedReading,
  filterManualDefinitions,
  lensCampus,
  lensTargetMatches,
  authorizeSelectionWrites,
  givingWriteAllowed,
  libraryAccess,
  mergeTargetMap,
  moveKeys,
  placeKeys,
  planSelectionChange,
  readingValue,
  resolveSharedTarget,
  reviewMetricKeys,
  scorecardStatus,
  validateActualValue,
  validateManualDraft,
  validateRowSave,
  writesStayOnScorecard,
  type StoredSelection,
} from "./scorecard";
import type { OsManualDefinition, OsManualReading, OsTeam } from "./types";

const executive = "executive" as OsTeam;
const pastoral = "pastoral" as OsTeam;
const leadership = "leadership" as OsTeam;

function stored(partial: Partial<StoredSelection> & Pick<StoredSelection, "id" | "metricKey" | "team">): StoredSelection {
  return {
    campus: "church-wide",
    periodKind: "closed_month",
    removed: false,
    version: 1,
    sortOrder: 0,
    ownerUserId: null,
    ...partial,
  };
}

test("giving stays hidden without financial access and on the pastoral scorecard", () => {
  assert.equal(libraryAccess({ team: executive, canReadGiving: false, metricKey: "giving" }).visible, false);
  assert.equal(libraryAccess({ team: pastoral, canReadGiving: true, metricKey: "giving" }).visible, false);
  assert.equal(libraryAccess({ team: executive, canReadGiving: true, metricKey: "giving" }).visible, true);
  assert.equal(libraryAccess({ team: executive, canReadGiving: true, metricKey: "secret-metric" }).visible, false);
  assert.equal(libraryAccess({ team: leadership, canReadGiving: true, metricKey: "giving" }).visible, false);
  assert.equal(
    givingWriteAllowed({ team: executive, canReadGiving: true, metricKey: "giving", campus: "alma" }).allowed,
    false
  );
  assert.equal(lensCampus("church-wide", "alma"), "alma");
  assert.equal(lensCampus("church-wide", "church-wide"), "church-wide");
  assert.equal(lensTargetMatches("church-wide", "alma"), false);
  assert.equal(lensTargetMatches("alma", "alma"), true);
  assert.equal(lensTargetMatches("church-wide", "church-wide"), true);
});

test("a pastoral selection cannot insert giving while other measures still save", () => {
  const plan = planSelectionChange({
    team: pastoral,
    configured: false,
    defaults: [{ metricKey: "giving", campus: "church-wide", periodKind: "closed_month", label: "Giving" }],
    stored: [],
    change: {
      type: "add",
      metricKey: "attendance",
      campus: "church-wide",
      periodKind: "sunday",
      ownerUserId: null,
      label: "Sunday attendance",
    },
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.writes.some((write) => write.op === "insert" && write.metricKey === "giving"), true);
  const guarded = authorizeSelectionWrites({
    team: pastoral,
    canReadGiving: true,
    writes: plan.writes,
    stored: [],
  });
  assert.equal(guarded.ok, true);
  if (!guarded.ok) return;
  assert.equal(guarded.writes.some((write) => write.op === "insert" && write.metricKey === "giving"), false);
  assert.equal(guarded.writes.some((write) => write.op === "insert" && write.metricKey === "attendance"), true);
});

test("adding a selected measure does not create another canonical key", () => {
  const plan = planSelectionChange({
    team: executive,
    configured: true,
    defaults: [],
    stored: [stored({ id: "row-1", team: executive, metricKey: "attendance", periodKind: "sunday", removed: true, version: 2 })],
    change: {
      type: "add",
      metricKey: "attendance",
      campus: "church-wide",
      periodKind: "sunday",
      ownerUserId: null,
      label: "Sunday attendance",
    },
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  const insert = plan.writes.find((write) => write.op === "insert" || write.op === "restore");
  assert.equal(insert?.op, "restore");
  if (insert?.op === "restore") assert.equal(insert.id, "row-1");
  assert.equal(JSON.stringify(plan.writes).includes("manual:"), false);
});

test("duplicate selections of the same measure are rejected", () => {
  const plan = planSelectionChange({
    team: executive,
    configured: false,
    defaults: [{ metricKey: "giving", campus: "church-wide", periodKind: "closed_month", label: "Giving" }],
    stored: [],
    change: {
      type: "add",
      metricKey: "giving",
      campus: "church-wide",
      periodKind: "closed_month",
      ownerUserId: null,
      label: "Giving",
    },
  });
  assert.equal(plan.ok, false);
});

test("removal and order stay on the current team", () => {
  const storedRows = [
    stored({ id: "ex", team: executive, metricKey: "attendance", periodKind: "sunday", sortOrder: 0 }),
    stored({ id: "pa", team: pastoral, metricKey: "attendance", periodKind: "sunday", sortOrder: 0, version: 4 }),
  ];
  const removed = planSelectionChange({
    team: executive,
    configured: true,
    defaults: [],
    stored: storedRows,
    change: { type: "remove", metricKey: "attendance", campus: "church-wide", periodKind: "sunday" },
  });
  assert.equal(removed.ok, true);
  if (!removed.ok) return;
  assert.deepEqual(
    removed.writes.map((write) => write.op),
    ["remove"]
  );
  assert.equal(removed.writes.some((write) => write.team === pastoral), false);
  const reordered = planSelectionChange({
    team: executive,
    configured: true,
    defaults: [],
    stored: storedRows,
    change: { type: "reorder", metricKeys: ["attendance"] },
  });
  assert.equal(reordered.ok, true);
  if (!reordered.ok) return;
  assert.equal(reordered.writes.every((write) => write.team === executive), true);
  assert.equal(writesStayOnScorecard(reordered.writes), true);
  assert.deepEqual(SCORECARD_WRITE_TABLES, ["pulse_items", "pulse_scorecard_audit"]);
});

test("manual readings stay separate by campus and period and blank is not zero", () => {
  const august: OsManualReading = {
    id: "aug",
    metricKey: "manual:1",
    team: executive,
    campus: "church-wide",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    periodLabel: "August 2026",
    value: 4,
    unit: "count",
    actorId: "user-1",
    actorName: "Riley",
    createdAt: "2026-09-01T00:00:00.000Z",
    correctsId: null,
  };
  const october: OsManualReading = { ...august, id: "oct", periodLabel: "October 2026", value: 9, createdAt: "2026-10-01T00:00:00.000Z" };
  const alma: OsManualReading = { ...october, id: "alma", campus: "alma", value: 2 };
  const next = addReading([august], october);
  assert.equal(august.value, 4);
  assert.equal(august.periodLabel, "August 2026");
  assert.equal(displayedReading(next, "manual:1", "church-wide")?.value, 9);
  assert.equal(displayedReading([august, alma], "manual:1", "alma")?.value, 2);
  assert.equal(displayedReading(next, "manual:1", "mount-pleasant"), null);
  assert.equal(readingValue(null), null);
  assert.notEqual(readingValue(null), 0);
});

test("percentages are not capped at 100 unless a maximum is configured", () => {
  assert.equal(validateActualValue({ value: 140, unit: "percent", explicitMax: null }), null);
  assert.match(validateActualValue({ value: 140, unit: "percent", explicitMax: 100 }) ?? "", /caps the value/);
  const draft = validateManualDraft({
    name: "Follow-up rate",
    definition: "Contacts with a follow-up note divided by contacts received.",
    unit: "percent",
    frequency: "monthly",
    campus: "church-wide",
    comparison: "higher",
    ownerUserId: "user-1",
    rangeMin: "",
    rangeMax: "",
    attentionMin: "",
    attentionMax: "",
    explicitMax: "",
    target: "80",
  });
  assert.equal(draft.ok, true);
});

test("missing source data stays unavailable and is not a performance status", () => {
  const missing = scorecardStatus({
    quality: "missing",
    sourceValue: null,
    manual: false,
    readingValue: null,
    target: 100,
    comparison: "higher",
    rangeMin: null,
    rangeMax: null,
    attentionMin: null,
    attentionMax: null,
    statusMode: "manual",
    manualStatus: "on_track",
    statusPeriodKey: "church-wide|closed_month|September 2026",
    currentPeriodKey: "church-wide|closed_month|September 2026",
    reason: "Known dip",
    actorName: "Riley",
  });
  assert.equal(missing.label, "Unavailable");
  assert.notEqual(missing.key, "on_track");
  assert.notEqual(missing.key, "off_track");

  const stale = scorecardStatus({
    ...blankStatus(),
    quality: "stale",
    sourceValue: 80,
    target: 100,
  });
  assert.equal(stale.label, "Stale");
  const errored = scorecardStatus({ ...blankStatus(), quality: "error", sourceValue: null, target: 10 });
  assert.equal(errored.label, "Source error");
});

test("automatic status compares the same period and does not invent a needs-attention band", () => {
  const below = scorecardStatus({
    ...blankStatus(),
    quality: "available",
    sourceValue: 95,
    target: 100,
    comparison: "higher",
  });
  assert.equal(below.label, "Off track");
  const band = scorecardStatus({
    ...blankStatus(),
    quality: "available",
    sourceValue: 95,
    target: 100,
    comparison: "higher",
    attentionMin: 90,
  });
  assert.equal(band.label, "Needs attention");
  const lower = scorecardStatus({
    ...blankStatus(),
    quality: "available",
    sourceValue: 8,
    target: 10,
    comparison: "lower",
  });
  assert.equal(lower.label, "On track");
  const range = scorecardStatus({
    ...blankStatus(),
    quality: "available",
    sourceValue: 15,
    target: null,
    comparison: "range",
    rangeMin: 10,
    rangeMax: 20,
  });
  assert.equal(range.label, "On track");
  const unconfigured = scorecardStatus({
    ...blankStatus(),
    quality: "available",
    sourceValue: 15,
    comparison: "range",
  });
  assert.equal(unconfigured.label, "Range not configured");
  const noTarget = scorecardStatus({
    ...blankStatus(),
    quality: "available",
    sourceValue: 15,
    target: null,
  });
  assert.equal(noTarget.label, "Target not set");
});

test("manual override keeps the calculated status and requires a reason", () => {
  const period = "church-wide|closed_month|September 2026";
  const manual = scorecardStatus({
    ...blankStatus(),
    quality: "available",
    sourceValue: 80,
    target: 100,
    statusMode: "manual",
    manualStatus: "on_track",
    statusPeriodKey: period,
    currentPeriodKey: period,
    reason: "Campaign timing",
    actorName: "Riley",
  });
  assert.equal(manual.label, "Manually set");
  assert.equal(manual.calculatedLabel, "Off track");
  assert.equal(manual.reason, "Campaign timing");
  const otherPeriod = scorecardStatus({
    ...blankStatus(),
    quality: "available",
    sourceValue: 80,
    target: 100,
    statusMode: "manual",
    manualStatus: "on_track",
    statusPeriodKey: "church-wide|closed_month|August 2026",
    currentPeriodKey: period,
    reason: "Campaign timing",
  });
  assert.equal(otherPeriod.label, "Off track");
  const invalid = validateRowSave({
    manual: false,
    canEditTarget: true,
    targetText: "100",
    savedTarget: 100,
    statusMode: "manual",
    manualStatus: "off_track",
    reason: " ",
    ownerUserId: null,
    memberIds: [],
    actualText: "",
    periodStart: "",
    periodEnd: "",
    explicitMax: null,
    unit: "count",
  });
  assert.equal(invalid.ok, false);
});

test("saving a target does not change the source actual", () => {
  const next = applyRowSave(
    { sourceValue: 258000, target: null, ownerUserId: null, statusMode: "automatic" as const },
    { target: 300000, ownerUserId: "user-1", statusMode: "automatic" }
  );
  assert.equal(next.sourceValue, 258000);
  assert.equal(next.target, 300000);
  const blocked = validateRowSave({
    manual: false,
    canEditTarget: false,
    targetText: "12",
    savedTarget: 10,
    statusMode: "automatic",
    manualStatus: null,
    reason: "",
    ownerUserId: null,
    memberIds: [],
    actualText: "4",
    periodStart: "",
    periodEnd: "",
    explicitMax: null,
    unit: "count",
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.match(blocked.error, /shared|Connected actuals/);
});

test("a facilitator cannot change another team's scorecard or a church-wide target", () => {
  assert.equal(canMutateTeam({ isAdmin: false, facilitatorTeams: [pastoral], team: executive }), false);
  assert.equal(canMutateTeam({ isAdmin: true, facilitatorTeams: [], team: executive }), true);
  assert.equal(canEditChurchwideTarget({ isAdmin: false, canEditBenchmarks: false }), false);
  assert.equal(canEditChurchwideTarget({ isAdmin: false, canEditBenchmarks: true }), true);
});

test("shared targets keep other periods and unpublished manuals stay on the home team", () => {
  const merged = mergeTargetMap(
    { "church-wide|closed_month|August 2026": { value: 1, unit: "count", setBy: "a", setAt: "2026-08-01" } },
    "church-wide|closed_month|September 2026",
    { value: 2, unit: "count", setBy: "a", setAt: "2026-09-01" }
  );
  assert.equal(merged["church-wide|closed_month|August 2026"].value, 1);
  assert.equal(merged["church-wide|closed_month|September 2026"].value, 2);
  const shared = resolveSharedTarget(
    [
      { metricKey: "giving", campus: "church-wide", periodKey: "p", value: 1, setAt: "2026-09-01" },
      { metricKey: "giving", campus: "church-wide", periodKey: "p", value: 2, setAt: "2026-09-02" },
    ],
    { metricKey: "giving", campus: "church-wide", periodKey: "p" }
  );
  assert.equal(shared?.value, 2);
  assert.equal(shared?.conflict, true);
  const definitions: OsManualDefinition[] = [
    {
      metricKey: "manual:1",
      label: "Care load",
      definition: "Open care items.",
      unit: "count",
      frequency: "monthly",
      campus: "church-wide",
      comparison: "lower",
      rangeMin: null,
      rangeMax: null,
      attentionMin: null,
      attentionMax: null,
      explicitMax: null,
      published: false,
      homeTeam: pastoral,
    },
  ];
  assert.equal(filterManualDefinitions(definitions, { team: executive, isAdmin: false }).length, 0);
  assert.equal(filterManualDefinitions(definitions, { team: pastoral, isAdmin: false }).length, 1);
});

test("drag and arrow reordering only permute the current list", () => {
  const keys = ["attendance", "kids", "guests", "baptism"];
  const dropped = placeKeys(keys, 0, 2);
  const stepped = moveKeys(dropped, 2, -1);
  assert.deepEqual(dropped, ["kids", "guests", "attendance", "baptism"]);
  assert.deepEqual(stepped, ["kids", "attendance", "guests", "baptism"]);
  assert.deepEqual(placeKeys(keys, 3, 1), ["attendance", "baptism", "kids", "guests"]);
  assert.deepEqual(moveKeys(keys, 0, -1), [...keys]);
  assert.deepEqual(moveKeys(keys, 3, 1), [...keys]);
  assert.deepEqual(placeKeys(keys, 1, 1), [...keys]);
  assert.deepEqual(placeKeys(keys, -1, 0), [...keys]);
  assert.deepEqual(keys, ["attendance", "kids", "guests", "baptism"]);
});

test("review order is the team default until selections are stored", () => {
  assert.deepEqual(
    reviewMetricKeys({
      configured: false,
      defaults: ["giving", "attendance"],
      notes: [{ metricKey: "manual:1", sortOrder: 1, manual: true }],
    }),
    ["giving", "attendance", "manual:1"]
  );
  assert.deepEqual(
    reviewMetricKeys({
      configured: true,
      defaults: ["giving"],
      notes: [
        { metricKey: "attendance", sortOrder: 0, manual: false },
        { metricKey: "giving", sortOrder: 2, manual: false },
      ],
    }),
    ["attendance", "giving"]
  );
});

function blankStatus() {
  return {
    quality: "available" as const,
    sourceValue: null as number | null,
    manual: false,
    readingValue: null as number | null,
    target: null as number | null,
    comparison: "higher" as const,
    rangeMin: null as number | null,
    rangeMax: null as number | null,
    attentionMin: null as number | null,
    attentionMax: null as number | null,
    statusMode: "automatic" as const,
    manualStatus: null,
    statusPeriodKey: "",
    currentPeriodKey: "",
    reason: "",
    actorName: "",
  };
}
