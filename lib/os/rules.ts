import type {
  AttendanceMonth,
  OsAnswer,
  OsCampus,
  OsInsight,
  OsMeasure,
  OsQuality,
  OsTeam,
  OsWorkItem,
} from "./types";

export const MISSING_MODEL_CONFIG = "COMMUNITY_OS_MODEL_API_KEY";

export const ATTENDANCE_CAMPUSES = ["mount-pleasant", "alma", "st-johns"] as const;
export const STALE_SUNDAY_DAYS = 10;

export const PULSE_CAMPUS_OPTIONS: { id: OsCampus; label: string }[] = [
  { id: "church-wide", label: "Church-wide" },
  { id: "mount-pleasant", label: "Mount Pleasant" },
  { id: "alma", label: "Alma" },
  { id: "st-johns", label: "St. Johns" },
];

export const CAMPUS_GIVING_CLOSED =
  "Campus giving stays on the Financials report. This scorecard shows church-wide giving only.";

export const CAMPUS_SOURCE_UNSUPPORTED =
  "This source does not support that campus. A campus number is not estimated, and missing is not zero.";

export function pulseCampusLabel(campus: string): string {
  return PULSE_CAMPUS_OPTIONS.find((option) => option.id === campus)?.label ?? campus;
}

export function showsPulseCampusSwitcher(team: OsTeam): boolean {
  return team === "pastoral";
}

export function resolvePulseCampus(team: OsTeam, requested: string | string[] | null | undefined): OsCampus {
  if (team !== "pastoral") return "church-wide";
  const value = Array.isArray(requested) ? requested[0] : requested;
  if (value === "mount-pleasant" || value === "alma" || value === "st-johns" || value === "church-wide") {
    return value;
  }
  return "church-wide";
}

export type SundayRow = {
  date: string;
  campusSlug: string;
  value: number | null;
  source: string;
};

export function usableSource(source: string | null | undefined): boolean {
  if (!source) return false;
  const normalized = source.toLowerCase();
  return normalized !== "seed" && normalized !== "sample";
}

export function closedMonthCeiling(referenceDate: Date): string {
  const month = referenceDate.getMonth();
  const year = referenceDate.getFullYear();
  const previous = new Date(year, month - 1, 1);
  const y = previous.getFullYear();
  const m = String(previous.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

export function selectClosedMonths<T extends { periodStart: string; source: string; value: number | null }>(
  rows: T[],
  ceiling: string
): T[] {
  return rows
    .filter(
      (row) =>
        usableSource(row.source) &&
        row.value != null &&
        row.periodStart <= ceiling
    )
    .sort((a, b) => b.periodStart.localeCompare(a.periodStart));
}

export function sundayTotal(
  rows: SundayRow[],
  date: string
): { value: number | null; missing: string[] } {
  const missing: string[] = [];
  let sum = 0;
  for (const slug of ATTENDANCE_CAMPUSES) {
    const row = rows.find(
      (item) => item.date === date && item.campusSlug === slug && usableSource(item.source)
    );
    if (!row || row.value == null) {
      missing.push(slug);
      continue;
    }
    sum += row.value;
  }
  if (missing.length > 0) return { value: null, missing };
  return { value: sum, missing };
}

export function sundaySeries(
  rows: SundayRow[],
  campus: OsCampus
): { date: string; value: number }[] {
  if (campus === "church-wide") {
    const dates = [...new Set(rows.map((row) => row.date))].sort((a, b) => b.localeCompare(a));
    const series: { date: string; value: number }[] = [];
    for (const date of dates) {
      const total = sundayTotal(rows, date);
      if (total.value != null) series.push({ date, value: total.value });
    }
    return series;
  }
  return rows
    .filter((row) => row.campusSlug === campus && usableSource(row.source) && row.value != null)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((row) => ({ date: row.date, value: row.value as number }));
}

export type MonthScopeRow = {
  periodStart: string;
  value: number | null;
  source: string;
  campusSlug: string | null;
};

export function monthScope<T extends MonthScopeRow>(
  rows: T[],
  campus: OsCampus,
  ceiling: string
): { status: "unsupported" | "missing" | "value"; rows: T[] } {
  if (campus !== "church-wide" && rows.length > 0 && rows.every((row) => row.campusSlug == null)) {
    return { status: "unsupported", rows: [] };
  }
  const slug = campus === "church-wide" ? null : campus;
  const closed = selectClosedMonths(
    rows.filter((row) => row.campusSlug === slug),
    ceiling
  );
  if (!closed[0] || closed[0].value == null) return { status: "missing", rows: [] };
  return { status: "value", rows: closed };
}

export function isStaleSunday(serviceDate: string, today: Date): boolean {
  const service = new Date(`${serviceDate}T12:00:00`);
  const age = (today.getTime() - service.getTime()) / 86_400_000;
  return age > STALE_SUNDAY_DAYS;
}

export function canReadGiving(input: {
  financialInsights: boolean;
  isAdmin: boolean;
}): boolean {
  return input.financialInsights || input.isAdmin;
}

const FOCUS: Record<OsTeam, string[]> = {
  executive: ["giving", "attendance", "serving", "priorities"],
  pastoral: ["attendance", "kids", "guests", "baptisms"],
  leadership: ["attendance", "serving", "kids", "baptisms", "groups"],
};

export function focusKeys(team: OsTeam): string[] {
  return FOCUS[team];
}

export function sameMonthLastYear(
  series: AttendanceMonth[],
  ceiling: string
): { current: AttendanceMonth; prior: AttendanceMonth } | null {
  const closed = series
    .filter((point) => point.periodStart <= ceiling)
    .sort((a, b) => b.periodStart.localeCompare(a.periodStart));
  const current = closed[0];
  if (!current) return null;
  const [year, month] = current.periodStart.split("-");
  const priorStart = `${Number(year) - 1}-${month}-01`;
  const prior = closed.find((point) => point.periodStart === priorStart);
  if (!prior) return null;
  return { current, prior };
}

export function buildInsights(
  measures: OsMeasure[],
  asOf: string,
  extras?: { yearOverYear?: { current: AttendanceMonth; prior: AttendanceMonth } | null }
): OsInsight[] {
  const insights: OsInsight[] = [];
  for (const measure of measures) {
    if (measure.quality === "stale") {
      insights.push(
        insight(measure, asOf, {
          id: `${measure.key}:stale`,
          category: "data-quality",
          severity: "watch",
          title: `${measure.label} is stale`,
          summary: measure.qualityDetail,
          evidence: evidenceLine(measure),
          limitation: "This is a freshness check, not a claim about why the measure changed.",
          followUp: "Refresh the source before using this in a decision.",
        })
      );
    }
    if (measure.quality === "error") {
      insights.push(
        insight(measure, asOf, {
          id: `${measure.key}:error`,
          category: "data-quality",
          severity: "watch",
          title: `${measure.label} could not be read`,
          summary: measure.qualityDetail,
          evidence: "The source did not return a verified observation.",
          limitation: "A source failure is not a performance warning and is not zero.",
          followUp: "Check the data connection, then refresh.",
        })
      );
    }
    if (measure.quality === "unavailable" || measure.quality === "missing") {
      insights.push(
        insight(measure, asOf, {
          id: `${measure.key}:${measure.quality}`,
          category: "data-quality",
          severity: "info",
          title: `${measure.label} is not a performance result`,
          summary: measure.qualityDetail,
          evidence: "No observation is stored for this measure.",
          limitation: "A missing source is not zero and is not an off-track result.",
          followUp: "Connect the source before asking for a trend.",
        })
      );
    }
    if (
      measure.key === "serving" &&
      measure.quality === "available" &&
      measure.staffing &&
      measure.staffing.gap > 0
    ) {
      const largest = [...measure.staffing.campuses].sort((a, b) => b.gap - a.gap)[0];
      insights.push(
        insight(measure, asOf, {
          id: "serving:gap",
          category: "warning",
          severity: "watch",
          title: "Volunteer roster is short of the rotation pool",
          summary: `${measure.staffing.current.toLocaleString()} current roster seats against ${measure.staffing.need.toLocaleString()} rotation-pool seats. Open seats: ${measure.staffing.gap.toLocaleString()}.${largest ? ` Largest campus gap: ${largest.label} (${largest.gap.toLocaleString()}).` : ""}`,
          evidence: evidenceLine(measure),
          limitation:
            "These are roster seats. People who serve in more than one role may be counted more than once. This is not weekly participation.",
          followUp: "Review the campus with the largest open-seat count in Volunteer Matrix.",
        })
      );
    }
  }
  const year = extras?.yearOverYear;
  if (year && year.current.value != null && year.prior.value != null) {
    const attendance = measures.find((measure) => measure.key === "attendance");
    const delta = year.current.value - year.prior.value;
    insights.push({
      id: "attendance:year",
      category: "trend",
      severity: "info",
      title: "Closed-month attendance compared with the same month last year",
      summary: `${monthLabel(year.current.periodStart)} is ${year.current.value.toLocaleString()} and ${monthLabel(year.prior.periodStart)} is ${year.prior.value.toLocaleString()}. Difference: ${delta.toLocaleString()}.`,
      evidence: `${monthLabel(year.current.periodStart)}: ${year.current.value.toLocaleString()}. ${monthLabel(year.prior.periodStart)}: ${year.prior.value.toLocaleString()}.`,
      limitation:
        "This compares the monthly in-person average for the same calendar month. It does not explain the cause, and it is not last Sunday's headcount.",
      metricKey: "attendance",
      asOf,
      campusLabel: attendance?.campusLabel ?? "Church-wide",
      periodLabel: monthLabel(year.current.periodStart),
      reportHref: attendance?.reportHref ?? "/dashboard?section=weekend-reach",
      refreshedAt: attendance?.refreshedAt ?? null,
      followUp: "Ask how attendance changed versus the same month last year before adding an issue.",
      lifecycle: "current",
    });
  }
  const seen = new Set<string>();
  return insights.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function buildMeetingInsights(items: OsWorkItem[], today: string, asOf: string): OsInsight[] {
  const insights: OsInsight[] = [];
  const overdue = items.filter(
    (item) =>
      item.kind === "todo" &&
      item.rockStatus !== "complete" &&
      item.dueOn != null &&
      item.dueOn < today
  );
  if (overdue.length > 0) {
    insights.push({
      id: "meeting:overdue",
      category: "warning",
      severity: "watch",
      title: "Commitments are past their due date",
      summary: `${overdue.length} open to-do${overdue.length === 1 ? " is" : "s are"} due before ${today}.`,
      evidence: overdue.map((item) => `${item.title} (due ${item.dueOn})`).join("; "),
      limitation: "This lists stored to-dos only. A promise that was never entered is not counted.",
      metricKey: "commitments",
      asOf,
      campusLabel: "This meeting",
      periodLabel: today,
      reportHref: null,
      refreshedAt: asOf,
      followUp: "Review the to-do list in this meeting. Nothing is created automatically.",
      lifecycle: "current",
    });
  }
  const openIssues = items.filter(
    (item) => item.kind === "issue" && item.issueStatus !== "solved" && item.issueStatus !== "long_term"
  );
  if (openIssues.length > 0) {
    const oldest = [...openIssues].sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""))[0];
    insights.push({
      id: "meeting:open-issues",
      category: "opportunity",
      severity: "info",
      title: "Unresolved issues are still on the list",
      summary: `${openIssues.length} open issue${openIssues.length === 1 ? "" : "s"} carry forward into this meeting.`,
      evidence: oldest?.title ? `Oldest open issue: ${oldest.title}.` : "Open issues are stored for this team.",
      limitation: "Vote totals are not part of this finding. Solving still happens in IDS.",
      metricKey: "issues",
      asOf,
      campusLabel: "This meeting",
      periodLabel: today,
      reportHref: null,
      refreshedAt: asOf,
      followUp: "Start IDS on the confirmed priority. Voting does not decide the solution.",
      lifecycle: "current",
    });
  }
  return insights;
}

function insight(
  measure: OsMeasure,
  asOf: string,
  fields: {
    id: string;
    category: OsInsight["category"];
    severity: OsInsight["severity"];
    title: string;
    summary: string;
    evidence: string;
    limitation: string;
    followUp: string;
  }
): OsInsight {
  return {
    ...fields,
    metricKey: measure.key,
    asOf,
    campusLabel: measure.campusLabel,
    periodLabel: measure.periodLabel,
    reportHref: measure.reportHref,
    refreshedAt: measure.refreshedAt,
    lifecycle: measure.quality === "stale" ? "stale" : "current",
  };
}

function evidenceLine(measure: OsMeasure): string {
  const value =
    measure.value == null ? "no value" : measure.value.toLocaleString();
  return `${measure.label}: ${value}. ${measure.periodLabel}. ${measure.campusLabel}. ${measure.sourceLabel}.`;
}

export function answerQuestion(
  question: string,
  input: {
    measures: OsMeasure[];
    attendanceMonths: AttendanceMonth[];
    ceiling: string;
    campusLabel: string;
    commitments?: { title: string; dueOn: string | null; done: boolean }[];
    modelConfigured?: boolean;
  }
): OsAnswer {
  const text = question.trim().toLowerCase();
  const citations = (keys: string[]) =>
    input.measures
      .filter((measure) => keys.includes(measure.key))
      .map((measure) => ({
        label: `${measure.sourceLabel} · ${measure.periodLabel}`,
        href: measure.reportHref,
      }));

  if (text.includes("attendance") && text.includes("last year")) {
    const pair = sameMonthLastYear(input.attendanceMonths, input.ceiling);
    const measure = input.measures.find((item) => item.key === "attendance");
    if (!pair) {
      return {
        question,
        status: "unavailable",
        findings:
          "A same-month-last-year attendance comparison is not available from the connected monthly series.",
        figures: [],
        limitation:
          "Sunday headcount and the monthly attendance average are different measures. This answer does not turn one into the other.",
        citations: citations(["attendance"]),
      };
    }
    const delta = pair.current.value - pair.prior.value;
    const direction = delta === 0 ? "unchanged" : delta > 0 ? "higher" : "lower";
    return {
      question,
      status: "answered",
      findings: `Church attendance for ${monthLabel(pair.current.periodStart)} is ${pair.current.value.toLocaleString()}, ${direction} than ${monthLabel(pair.prior.periodStart)} (${pair.prior.value.toLocaleString()}).`,
      figures: [
        `${monthLabel(pair.current.periodStart)}: ${pair.current.value.toLocaleString()}`,
        `${monthLabel(pair.prior.periodStart)}: ${pair.prior.value.toLocaleString()}`,
        `Difference: ${delta.toLocaleString()}`,
      ],
      limitation: `This uses the monthly in-person average, campus ${input.campusLabel}. It is not last Sunday's headcount${measure ? ` (${measure.periodLabel})` : ""}.`,
      citations: citations(["attendance"]),
    };
  }

  if (text.includes("staff") || text.includes("volunteer")) {
    const serving = input.measures.find((item) => item.key === "serving");
    if (!serving || serving.quality !== "available" || !serving.staffing) {
      return {
        question,
        status: "unavailable",
        findings: serving?.qualityDetail ?? "The volunteer roster is not available.",
        figures: [],
        limitation: "No staffing gap is invented when the roster cannot be read.",
        citations: citations(["serving"]),
      };
    }
    const ranked = [...serving.staffing.campuses].sort((a, b) => b.gap - a.gap);
    return {
      question,
      status: "answered",
      findings: `The current roster has ${serving.staffing.current.toLocaleString()} seats against a rotation pool of ${serving.staffing.need.toLocaleString()}. ${ranked[0] ? `${ranked[0].label} has the largest open-seat count (${ranked[0].gap.toLocaleString()}).` : ""}`,
      figures: ranked.map(
        (campus) =>
          `${campus.label}: ${campus.current.toLocaleString()} current, ${campus.need.toLocaleString()} needed, gap ${campus.gap.toLocaleString()}`
      ),
      limitation:
        "Gap means rotation-pool seats minus current roster seats. People are not confirmed unique across roles.",
      citations: citations(["serving"]),
    };
  }

  if (text.includes("last meeting") || text.includes("since our last")) {
    return {
      question,
      status: "unavailable",
      findings:
        "No completed meeting is stored for this team, so there is no snapshot to compare with today.",
      figures: [],
      limitation: "Meeting history has not been saved. This is not a claim that nothing changed.",
      citations: [],
    };
  }

  if (text.includes("overdue") || text.includes("commitment")) {
    if (!input.commitments) {
      return {
        question,
        status: "unavailable",
        findings: "Team commitments are not saved yet, so overdue items cannot be listed.",
        figures: [],
        limitation: "An empty list is not stored, and missing commitments are not counted as zero.",
        citations: [],
      };
    }
    const today = isoToday();
    const overdue = input.commitments.filter(
      (item) => !item.done && item.dueOn != null && item.dueOn < today
    );
    if (overdue.length === 0) {
      return {
        question,
        status: "answered",
        findings: "No open stored commitment is past its due date.",
        figures: [],
        limitation: "This reads saved to-dos only. A commitment that was never entered is not counted as zero.",
        citations: [],
      };
    }
    return {
      question,
      status: "answered",
      findings: `${overdue.length} open commitment${overdue.length === 1 ? " is" : "s are"} past the due date.`,
      figures: overdue.map((item) => `${item.title}: due ${item.dueOn}`),
      limitation: "This reads saved to-dos only. It does not create new to-dos.",
      citations: [],
    };
  }

  if (text.includes("giving") || text.includes("budget")) {
    const giving = input.measures.find((item) => item.key === "giving");
    if (!giving || giving.quality === "restricted") {
      return {
        question,
        status: "restricted",
        findings: "Giving is outside this account's Financials access.",
        figures: [],
        limitation: "The amount is omitted. Team membership does not grant it.",
        citations: [],
      };
    }
    if (giving.quality !== "available" || giving.value == null) {
      return {
        question,
        status: "unavailable",
        findings: giving.qualityDetail,
        figures: [],
        limitation: "No giving figure is estimated.",
        citations: citations(["giving"]),
      };
    }
    return {
      question,
      status: "answered",
      findings: `${giving.periodLabel} church-wide giving is ${formatMoney(giving.value)}. A matching budget target is not mapped, so this is not a budget-variance result.`,
      figures: [`${giving.periodLabel}: ${formatMoney(giving.value)}`],
      limitation:
        "This is a closed calendar month. It is not a weekly total, and it is not compared with a budget.",
      citations: citations(["giving"]),
    };
  }

  const modelNote = input.modelConfigured
    ? "The configured model is only used when it stays inside these figures."
    : `No language model is configured (${MISSING_MODEL_CONFIG}), so nothing is guessed.`;
  return {
    question,
    status: "unavailable",
    findings: `That question cannot be answered from the connected sources. ${modelNote}`,
    figures: [],
    limitation: "Web search and model memory are not used for church-performance questions.",
    citations: [],
  };
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function monthLabel(periodStart: string): string {
  const date = new Date(`${periodStart}T12:00:00`);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function formatMoney(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function qualityTone(quality: OsQuality): string {
  if (quality === "available") return "pill";
  if (quality === "stale" || quality === "manual") return "pill warn";
  if (quality === "restricted" || quality === "error") return "pill bad";
  return "pill gray";
}
