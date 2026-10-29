import assert from "node:assert/strict";
import test from "node:test";
import {
  answerQuestion,
  buildInsights,
  canReadGiving,
  closedMonthCeiling,
  isStaleSunday,
  monthScope,
  resolvePulseCampus,
  sameMonthLastYear,
  selectClosedMonths,
  showsPulseCampusSwitcher,
  sundaySeries,
  sundayTotal,
} from "./rules";
import type { OsMeasure } from "./types";

test("closed month ceiling is the previous calendar month", () => {
  assert.equal(closedMonthCeiling(new Date("2026-10-29T12:00:00")), "2026-09-01");
});

test("drops future months, seed rows, and nulls", () => {
  const rows = selectClosedMonths(
    [
      { periodStart: "2026-10-01", source: "google_sheets", value: 1 },
      { periodStart: "2026-09-01", source: "google_sheets", value: 2 },
      { periodStart: "2026-08-01", source: "seed", value: 3 },
      { periodStart: "2026-07-01", source: "google_sheets", value: null },
    ],
    "2026-09-01"
  );
  assert.deepEqual(
    rows.map((row) => row.periodStart),
    ["2026-09-01"]
  );
});

test("a missing campus keeps the Sunday total empty", () => {
  const rows = [
    { date: "2026-10-11", campusSlug: "mount-pleasant", value: 100, source: "google_sheets" },
    { date: "2026-10-11", campusSlug: "alma", value: 40, source: "google_sheets" },
  ];
  const total = sundayTotal(rows, "2026-10-11");
  assert.equal(total.value, null);
  assert.deepEqual(total.missing, ["st-johns"]);
  assert.equal(sundaySeries(rows, "church-wide").length, 0);
});

test("pastoral campus lens is ignored for executive and leadership", () => {
  assert.equal(resolvePulseCampus("executive", "alma"), "church-wide");
  assert.equal(resolvePulseCampus("leadership", "st-johns"), "church-wide");
  assert.equal(resolvePulseCampus("executive", "mount-pleasant"), "church-wide");
  assert.equal(resolvePulseCampus("pastoral", "alma"), "alma");
  assert.equal(resolvePulseCampus("pastoral", "mount-pleasant"), "mount-pleasant");
  assert.equal(resolvePulseCampus("pastoral", "st-johns"), "st-johns");
  assert.equal(resolvePulseCampus("pastoral", "church-wide"), "church-wide");
  assert.equal(resolvePulseCampus("pastoral", "downtown"), "church-wide");
  assert.equal(resolvePulseCampus("pastoral", undefined), "church-wide");
  assert.equal(showsPulseCampusSwitcher("pastoral"), true);
  assert.equal(showsPulseCampusSwitcher("executive"), false);
  assert.equal(showsPulseCampusSwitcher("leadership"), false);
});

test("a campus sunday is that campus reading and a missing campus is not zero", () => {
  const rows = [
    { date: "2026-10-18", campusSlug: "mount-pleasant", value: 100, source: "google_sheets" },
    { date: "2026-10-18", campusSlug: "alma", value: 40, source: "google_sheets" },
    { date: "2026-10-18", campusSlug: "st-johns", value: 25, source: "google_sheets" },
    { date: "2026-10-11", campusSlug: "alma", value: 30, source: "google_sheets" },
  ];
  assert.equal(sundaySeries(rows, "church-wide")[0]?.value, 165);
  assert.equal(sundaySeries(rows, "alma")[0]?.value, 40);
  assert.equal(sundaySeries(rows, "mount-pleasant")[0]?.value, 100);
  assert.equal(sundaySeries(rows, "st-johns").length, 1);
  assert.equal(
    sundaySeries(
      [{ date: "2026-10-18", campusSlug: "alma", value: 40, source: "google_sheets" }],
      "st-johns"
    ).length,
    0
  );
});

test("closed-month campus readings are not summed and a church-wide-only source stays unsupported", () => {
  const ceiling = "2026-09-01";
  const campusRows = [
    { periodStart: "2026-09-01", value: 10, source: "google_sheets", campusSlug: "mount-pleasant" },
    { periodStart: "2026-09-01", value: 20, source: "google_sheets", campusSlug: "alma" },
    { periodStart: "2026-09-01", value: 30, source: "google_sheets", campusSlug: "st-johns" },
  ];
  assert.equal(monthScope(campusRows, "church-wide", ceiling).status, "missing");
  const alma = monthScope(campusRows, "alma", ceiling);
  assert.equal(alma.status, "value");
  assert.equal(alma.rows[0]?.value, 20);
  assert.equal(
    monthScope(
      [{ periodStart: "2026-09-01", value: 80, source: "google_sheets", campusSlug: null }],
      "alma",
      ceiling
    ).status,
    "unsupported"
  );
  assert.equal(
    monthScope(
      [
        { periodStart: "2026-09-01", value: 80, source: "google_sheets", campusSlug: null },
        { periodStart: "2026-09-01", value: 12, source: "google_sheets", campusSlug: "mount-pleasant" },
      ],
      "st-johns",
      ceiling
    ).status,
    "missing"
  );
});

test("marks an October 11 service stale on October 29", () => {
  assert.equal(isStaleSunday("2026-10-11", new Date("2026-10-29T12:00:00")), true);
});

test("giving stays behind existing financial access", () => {
  assert.equal(canReadGiving({ financialInsights: false, isAdmin: false }), false);
  assert.equal(canReadGiving({ financialInsights: true, isAdmin: false }), true);
});

test("same month last year needs both observations", () => {
  assert.equal(
    sameMonthLastYear([{ periodStart: "2026-09-01", value: 2109 }], "2026-09-01"),
    null
  );
  const pair = sameMonthLastYear(
    [
      { periodStart: "2026-09-01", value: 2109 },
      { periodStart: "2025-09-01", value: 1900 },
    ],
    "2026-09-01"
  );
  assert.equal(pair?.prior.value, 1900);
});

test("missing groups become a data-quality note, not a zero", () => {
  const insights = buildInsights([measure({ key: "groups", quality: "unavailable", value: null })], "2026-10-29");
  assert.equal(insights.length, 1);
  assert.equal(insights[0].category, "data-quality");
  assert.match(insights[0].limitation, /not zero/);
});

test("giving answers refuse a weekly reading and a budget claim", () => {
  const answer = answerQuestion("How is giving tracking against the matching budget period?", {
    measures: [
      measure({
        key: "giving",
        quality: "available",
        value: 258000,
        periodLabel: "September 2026",
        periodKind: "closed_month",
      }),
    ],
    attendanceMonths: [],
    ceiling: "2026-09-01",
    campusLabel: "Church-wide",
  });
  assert.equal(answer.status, "answered");
  assert.match(answer.limitation, /not a weekly/);
  assert.match(answer.findings, /not a budget-variance/);
});

test("restricted giving omits the amount", () => {
  const answer = answerQuestion("How is giving tracking?", {
    measures: [measure({ key: "giving", quality: "restricted", value: null })],
    attendanceMonths: [],
    ceiling: "2026-09-01",
    campusLabel: "Church-wide",
  });
  assert.equal(answer.status, "restricted");
  assert.equal(answer.figures.length, 0);
});

function measure(patch: Partial<OsMeasure> & Pick<OsMeasure, "key" | "quality" | "value">): OsMeasure {
  return {
    label: patch.key,
    definition: "",
    unit: "count",
    periodLabel: "September 2026",
    periodKind: "closed_month",
    campusLabel: "Church-wide",
    sourceLabel: "Existing dashboard",
    reportHref: null,
    refreshedAt: null,
    qualityDetail: "No live group source is connected. Missing is not zero.",
    history: [],
    staffing: null,
    ...patch,
  };
}
