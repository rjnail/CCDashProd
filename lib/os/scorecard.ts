import { CAMPUS_GIVING_CLOSED, formatMoney } from "./rules";
import type {
  OsManualDefinition,
  OsManualReading,
  OsMeasure,
  OsQuality,
  OsScorecardNote,
  OsScorecardTarget,
  OsSharedTarget,
  OsTeam,
  ScorecardComparison,
  ScorecardManualStatus,
  ScorecardStatusMode,
  ScorecardUnit,
} from "./types";

export const SCORECARD_READY_KEY = "__scorecard_ready__";
export const SCORECARD_MIGRATION_FILE = "supabase/migrations/20261029220000_pulse_scorecard.sql";
export const SCORECARD_WRITE_TABLES = ["pulse_items", "pulse_scorecard_audit"] as const;
export const OWNER_IS_TEAM_SPECIFIC = true;

const CONNECTED_KEYS = ["giving", "attendance", "serving", "kids", "guests", "baptisms", "groups", "priorities"] as const;

export type CanonicalMetric = {
  key: string;
  label: string;
  sourceType: "connected" | "manual";
  unit: ScorecardUnit;
  periodKind: string;
  periodLabel: string;
};

const CANONICAL: CanonicalMetric[] = [
  { key: "giving", label: "Giving", sourceType: "connected", unit: "currency", periodKind: "closed_month", periodLabel: "Monthly total" },
  { key: "attendance", label: "Sunday attendance", sourceType: "connected", unit: "people", periodKind: "sunday", periodLabel: "Weekly Sunday" },
  { key: "serving", label: "Volunteer roster", sourceType: "connected", unit: "people", periodKind: "current_roster", periodLabel: "Current roster" },
  { key: "kids", label: "Kids attendance", sourceType: "connected", unit: "people", periodKind: "monthly_average", periodLabel: "Monthly average" },
  { key: "guests", label: "First-time guests", sourceType: "connected", unit: "people", periodKind: "fiscal_year", periodLabel: "Fiscal year" },
  { key: "baptisms", label: "Baptism signups", sourceType: "connected", unit: "count", periodKind: "fiscal_year_signups", periodLabel: "Fiscal-year signups" },
  { key: "groups", label: "People in groups", sourceType: "connected", unit: "people", periodKind: "unavailable", periodLabel: "Not connected" },
  { key: "priorities", label: "Strategic priorities", sourceType: "manual", unit: "count", periodKind: "monthly", periodLabel: "Monthly" },
];

export function canonicalMetrics(): CanonicalMetric[] {
  return CANONICAL.map((metric) => ({ ...metric }));
}

export function canonicalMetric(key: string): CanonicalMetric | null {
  return CANONICAL.find((metric) => metric.key === key) ?? null;
}

export function isManualMetric(key: string): boolean {
  return key.startsWith("manual:") || key === "priorities";
}

export function libraryAccess(input: {
  team: OsTeam;
  canReadGiving: boolean;
  metricKey: string;
}): { visible: boolean; reason: string } {
  if (input.metricKey === "giving") {
    if (input.team === "pastoral") {
      return { visible: false, reason: "The Pastoral scorecard does not include giving." };
    }
    if (input.team !== "executive") {
      return { visible: false, reason: "Giving stays on the Executive scorecard." };
    }
    if (!input.canReadGiving) {
      return { visible: false, reason: "Giving stays behind Financials access." };
    }
  }
  if (input.metricKey.startsWith("manual:")) return { visible: true, reason: "" };
  if (!CONNECTED_KEYS.includes(input.metricKey as (typeof CONNECTED_KEYS)[number])) {
    return { visible: false, reason: "That measure is not available on this scorecard." };
  }
  return { visible: true, reason: "" };
}

export function visibleMetricKeys(input: { team: OsTeam; canReadGiving: boolean }): string[] {
  return CONNECTED_KEYS.filter((key) => libraryAccess({ ...input, metricKey: key }).visible);
}

export function givingWriteAllowed(input: {
  team: OsTeam;
  canReadGiving: boolean;
  metricKey: string | null | undefined;
  campus?: string | null;
}): { allowed: boolean; reason: string } {
  if (input.metricKey !== "giving") return { allowed: true, reason: "" };
  const access = libraryAccess({ team: input.team, canReadGiving: input.canReadGiving, metricKey: "giving" });
  if (!access.visible) return { allowed: false, reason: access.reason };
  if ((input.campus ?? "church-wide") !== "church-wide") {
    return { allowed: false, reason: CAMPUS_GIVING_CLOSED };
  }
  return { allowed: true, reason: "" };
}

export function omitRestrictedGiving<T extends { metricKey: string | null; campus?: string | null }>(
  rows: readonly T[],
  team: OsTeam,
  canReadGiving: boolean
): T[] {
  return rows.filter(
    (row) =>
      givingWriteAllowed({
        team,
        canReadGiving,
        metricKey: row.metricKey,
        campus: row.campus,
      }).allowed
  );
}

export type ScopeOption = { id: string; label: string; supported: boolean; reason: string };

export function campusOptions(metricKey: string): ScopeOption[] {
  const live = "Church-wide is the live scope. Campus filters are ignored, and campus readings are not invented.";
  const manual = isManualMetric(metricKey);
  return [
    { id: "church-wide", label: "Church-wide", supported: true, reason: "" },
    { id: "mount-pleasant", label: "Mount Pleasant", supported: manual, reason: manual ? "" : live },
    { id: "alma", label: "Alma", supported: manual, reason: manual ? "" : live },
    { id: "st-johns", label: "St. Johns", supported: manual, reason: manual ? "" : live },
  ];
}

export function frequencyOptions(metricKey: string): ScopeOption[] {
  const metric = canonicalMetric(metricKey);
  if (metric?.sourceType === "connected") {
    return [{ id: metric.periodKind, label: metric.periodLabel, supported: true, reason: "" }];
  }
  return ["weekly", "monthly", "quarterly"].map((id) => ({
    id,
    label: GRAIN_LABELS[id] ?? id,
    supported: true,
    reason: "",
  }));
}

const GRAIN_LABELS: Record<string, string> = {
  closed_month: "monthly total",
  sunday: "weekly Sunday",
  monthly_average: "monthly average",
  current_roster: "current roster",
  fiscal_year: "fiscal year",
  fiscal_year_signups: "fiscal-year signups",
  weekly: "weekly",
  monthly: "monthly",
  quarterly: "quarterly",
  unavailable: "not connected",
};

export function periodGrainLabel(periodKind: string): string {
  return GRAIN_LABELS[periodKind] ?? periodKind.replaceAll("_", " ");
}

export function observationKey(campus: string, periodKind: string, periodLabel: string): string {
  return `${campus}|${periodKind}|${periodLabel}`;
}

export function scopeCopy(input: {
  label: string;
  campusLabel: string;
  periodKind: string;
  teamLabel: string;
}): string {
  return `${input.label} · ${input.campusLabel} · ${periodGrainLabel(input.periodKind)}. Saving a target updates the shared target for every team reviewing this measure and scope. The owner stays on ${input.teamLabel}.`;
}

export function canEditScorecardRow(input: { isAdmin: boolean; facilitator: boolean }): boolean {
  return input.isAdmin || input.facilitator;
}

export function canEditChurchwideTarget(input: { isAdmin: boolean; canEditBenchmarks: boolean }): boolean {
  return input.isAdmin || input.canEditBenchmarks;
}

export function canMutateTeam(input: { isAdmin: boolean; facilitatorTeams: readonly OsTeam[]; team: OsTeam }): boolean {
  return input.isAdmin || input.facilitatorTeams.includes(input.team);
}

export function canPublishManual(input: { isAdmin: boolean }): boolean {
  return input.isAdmin;
}

export type ScorecardStatus = {
  key:
    | "on_track"
    | "needs_attention"
    | "off_track"
    | "target_not_set"
    | "unavailable"
    | "stale"
    | "error"
    | "restricted"
    | "range_unconfigured"
    | "manual";
  label: string;
  calculatedKey: ScorecardStatus["key"] | null;
  calculatedLabel: string | null;
  reason: string;
  actorName: string;
};

const STATUS_LABEL: Record<Exclude<ScorecardStatus["key"], "manual">, string> = {
  on_track: "On track",
  needs_attention: "Needs attention",
  off_track: "Off track",
  target_not_set: "Target not set",
  unavailable: "Unavailable",
  stale: "Stale",
  error: "Source error",
  restricted: "Restricted",
  range_unconfigured: "Range not configured",
};

export function statusPill(key: ScorecardStatus["key"]): string {
  if (key === "on_track" || key === "manual") return "pill";
  if (key === "needs_attention" || key === "stale") return "pill warn";
  if (key === "off_track" || key === "error" || key === "restricted") return "pill bad";
  return "pill gray";
}

function sourceStatus(quality: OsQuality, value: number | null): ScorecardStatus | null {
  if (quality === "restricted") {
    return { key: "restricted", label: STATUS_LABEL.restricted, calculatedKey: null, calculatedLabel: null, reason: "", actorName: "" };
  }
  if (quality === "error") {
    return { key: "error", label: STATUS_LABEL.error, calculatedKey: null, calculatedLabel: null, reason: "", actorName: "" };
  }
  if (quality === "stale") {
    return { key: "stale", label: STATUS_LABEL.stale, calculatedKey: null, calculatedLabel: null, reason: "", actorName: "" };
  }
  if (quality === "missing" || quality === "unavailable" || value == null) {
    if (quality === "manual") return null;
    return { key: "unavailable", label: STATUS_LABEL.unavailable, calculatedKey: null, calculatedLabel: null, reason: "", actorName: "" };
  }
  return null;
}

function comparePerformance(input: {
  actual: number;
  target: number | null;
  comparison: ScorecardComparison;
  rangeMin: number | null;
  rangeMax: number | null;
  attentionMin: number | null;
  attentionMax: number | null;
}): ScorecardStatus {
  const blank = { calculatedKey: null, calculatedLabel: null, reason: "", actorName: "" } as const;
  if (input.comparison === "range") {
    if (input.rangeMin == null || input.rangeMax == null) {
      return { key: "range_unconfigured", label: STATUS_LABEL.range_unconfigured, ...blank };
    }
    if (input.actual >= input.rangeMin && input.actual <= input.rangeMax) {
      return { key: "on_track", label: STATUS_LABEL.on_track, ...blank };
    }
    const belowBand = input.attentionMin != null && input.actual < input.rangeMin && input.actual >= input.attentionMin;
    const aboveBand = input.attentionMax != null && input.actual > input.rangeMax && input.actual <= input.attentionMax;
    if (belowBand || aboveBand) return { key: "needs_attention", label: STATUS_LABEL.needs_attention, ...blank };
    return { key: "off_track", label: STATUS_LABEL.off_track, ...blank };
  }
  if (input.target == null) return { key: "target_not_set", label: STATUS_LABEL.target_not_set, ...blank };
  if (input.comparison === "lower") {
    if (input.actual <= input.target) return { key: "on_track", label: STATUS_LABEL.on_track, ...blank };
    if (input.attentionMax != null && input.actual <= input.attentionMax) {
      return { key: "needs_attention", label: STATUS_LABEL.needs_attention, ...blank };
    }
    return { key: "off_track", label: STATUS_LABEL.off_track, ...blank };
  }
  if (input.actual >= input.target) return { key: "on_track", label: STATUS_LABEL.on_track, ...blank };
  if (input.attentionMin != null && input.actual >= input.attentionMin) {
    return { key: "needs_attention", label: STATUS_LABEL.needs_attention, ...blank };
  }
  return { key: "off_track", label: STATUS_LABEL.off_track, ...blank };
}

export function scorecardStatus(input: {
  quality: OsQuality;
  sourceValue: number | null;
  manual: boolean;
  readingValue: number | null;
  target: number | null;
  comparison: ScorecardComparison;
  rangeMin: number | null;
  rangeMax: number | null;
  attentionMin: number | null;
  attentionMax: number | null;
  statusMode: ScorecardStatusMode;
  manualStatus: ScorecardManualStatus | null;
  statusPeriodKey: string;
  currentPeriodKey: string;
  reason: string;
  actorName: string;
}): ScorecardStatus {
  const actual = input.manual ? input.readingValue : input.sourceValue;
  const blocked = sourceStatus(input.manual ? "manual" : input.quality, actual);
  if (input.manual && actual == null) {
    return { key: "unavailable", label: STATUS_LABEL.unavailable, calculatedKey: null, calculatedLabel: null, reason: "", actorName: "" };
  }
  if (!input.manual && blocked) return blocked;
  const calculated = comparePerformance({
    actual: actual as number,
    target: input.target,
    comparison: input.comparison,
    rangeMin: input.rangeMin,
    rangeMax: input.rangeMax,
    attentionMin: input.attentionMin,
    attentionMax: input.attentionMax,
  });
  const overrideApplies =
    input.statusMode === "manual" &&
    input.manualStatus != null &&
    input.statusPeriodKey === input.currentPeriodKey &&
    input.reason.trim().length > 0;
  if (!overrideApplies) return calculated;
  return {
    key: "manual",
    label: "Manually set",
    calculatedKey: calculated.key,
    calculatedLabel: calculated.label,
    reason: input.reason.trim(),
    actorName: input.actorName,
  };
}

export function parseNumeric(input: string): { ok: true; value: number | null } | { ok: false; error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { ok: true, value: null };
  const cleaned = trimmed.replace(/[$,%\s,]/g, "");
  if (!cleaned) return { ok: false, error: "Enter a numeric target." };
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return { ok: false, error: "Enter a numeric target." };
  return { ok: true, value };
}

export function formatActual(value: number, unit: ScorecardUnit): string {
  if (unit === "currency") return formatMoney(value);
  if (unit === "percent") {
    return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)}%`;
  }
  return value.toLocaleString("en-US");
}

export function formatTargetDisplay(value: number | null, unit: ScorecardUnit): string {
  if (value == null) return "Not set";
  return formatActual(value, unit);
}

export function validateActualValue(input: {
  value: number;
  unit: ScorecardUnit;
  explicitMax: number | null;
}): string | null {
  if (!Number.isFinite(input.value)) return "Enter a numeric actual.";
  if (input.explicitMax != null && input.value > input.explicitMax) {
    return `This definition caps the value at ${formatActual(input.explicitMax, input.unit)}.`;
  }
  return null;
}

export function validateManualDraft(input: {
  name: string;
  definition: string;
  unit: string;
  frequency: string;
  campus: string;
  comparison: string;
  ownerUserId: string;
  rangeMin: string;
  rangeMax: string;
  attentionMin: string;
  attentionMax: string;
  explicitMax: string;
  target: string;
}): { ok: true; value: ManualDraft } | { ok: false; error: string } {
  const name = input.name.trim();
  const definition = input.definition.trim();
  if (!name) return { ok: false, error: "Enter a name before saving." };
  if (!definition) return { ok: false, error: "Enter what is counted, including any denominator." };
  if (!["people", "currency", "count", "percent", "other"].includes(input.unit)) {
    return { ok: false, error: "Choose a unit." };
  }
  if (!["weekly", "monthly", "quarterly"].includes(input.frequency)) {
    return { ok: false, error: "Choose a reporting frequency." };
  }
  if (!["church-wide", "mount-pleasant", "alma", "st-johns"].includes(input.campus)) {
    return { ok: false, error: "Choose a campus scope." };
  }
  if (!["higher", "lower", "range"].includes(input.comparison)) {
    return { ok: false, error: "Choose how actuals should be compared with the target." };
  }
  if (!input.ownerUserId) return { ok: false, error: "Choose one owner from this meeting." };
  const rangeMin = parseNumeric(input.rangeMin);
  const rangeMax = parseNumeric(input.rangeMax);
  const attentionMin = parseNumeric(input.attentionMin);
  const attentionMax = parseNumeric(input.attentionMax);
  const explicitMax = parseNumeric(input.explicitMax);
  const target = parseNumeric(input.target);
  if (!rangeMin.ok) return rangeMin;
  if (!rangeMax.ok) return rangeMax;
  if (!attentionMin.ok) return attentionMin;
  if (!attentionMax.ok) return attentionMax;
  if (!explicitMax.ok) return explicitMax;
  if (!target.ok) return target;
  if (input.comparison === "range" && (rangeMin.value == null || rangeMax.value == null)) {
    return { ok: false, error: "Enter both ends of the range." };
  }
  if (rangeMin.value != null && rangeMax.value != null && rangeMin.value > rangeMax.value) {
    return { ok: false, error: "The start of the range has to be less than or equal to the end." };
  }
  return {
    ok: true,
    value: {
      name: name.slice(0, 180),
      definition: definition.slice(0, 500),
      unit: input.unit as ScorecardUnit,
      frequency: input.frequency,
      campus: input.campus,
      comparison: input.comparison as ScorecardComparison,
      ownerUserId: input.ownerUserId,
      rangeMin: rangeMin.value,
      rangeMax: rangeMax.value,
      attentionMin: attentionMin.value,
      attentionMax: attentionMax.value,
      explicitMax: explicitMax.value,
      target: target.value,
    },
  };
}

export type ManualDraft = {
  name: string;
  definition: string;
  unit: ScorecardUnit;
  frequency: string;
  campus: string;
  comparison: ScorecardComparison;
  ownerUserId: string;
  rangeMin: number | null;
  rangeMax: number | null;
  attentionMin: number | null;
  attentionMax: number | null;
  explicitMax: number | null;
  target: number | null;
};

export function validateRowSave(input: {
  manual: boolean;
  canEditTarget: boolean;
  targetText: string;
  savedTarget: number | null;
  statusMode: ScorecardStatusMode;
  manualStatus: ScorecardManualStatus | null;
  reason: string;
  ownerUserId: string | null;
  memberIds: readonly string[];
  actualText: string;
  periodStart: string;
  periodEnd: string;
  explicitMax: number | null;
  unit: ScorecardUnit;
}): { ok: true; target: number | null; actual: number | null } | { ok: false; error: string } {
  const target = parseNumeric(input.targetText);
  if (!target.ok) return target;
  if (!input.canEditTarget && target.value !== input.savedTarget) {
    return {
      ok: false,
      error: "This target is shared by every team reviewing this measure. You can change this team's owner and status, but not the church-wide target.",
    };
  }
  if (input.ownerUserId && !input.memberIds.includes(input.ownerUserId)) {
    return { ok: false, error: "Choose an owner from this meeting." };
  }
  if (input.statusMode === "manual") {
    if (!input.manualStatus) return { ok: false, error: "Choose On track, Needs attention, or Off track." };
    if (!input.reason.trim()) return { ok: false, error: "Enter a reason for the manual status." };
  }
  const actual = parseNumeric(input.actualText);
  if (!actual.ok) return { ok: false, error: actual.error === "Enter a numeric target." ? "Enter a numeric actual." : actual.error };
  if (actual.value != null && !input.manual) {
    return { ok: false, error: "Connected actuals stay on the source report and cannot be edited here." };
  }
  if (actual.value != null) {
    if (!input.periodStart || !input.periodEnd) return { ok: false, error: "Enter the period start and end for this actual." };
    if (input.periodEnd < input.periodStart) return { ok: false, error: "The period end is before the start." };
    const capped = validateActualValue({ value: actual.value, unit: input.unit, explicitMax: input.explicitMax });
    if (capped) return { ok: false, error: capped };
  }
  return { ok: true, target: input.canEditTarget ? target.value : input.savedTarget, actual: actual.value };
}

export function mergeTargetMap(
  existing: Record<string, OsScorecardTarget>,
  periodKey: string,
  next: OsScorecardTarget | null
): Record<string, OsScorecardTarget> {
  const copy = { ...existing };
  if (next == null) delete copy[periodKey];
  else copy[periodKey] = next;
  return copy;
}

export function applyRowSave<T extends { sourceValue: number | null }>(
  state: T,
  patch: { target?: number | null; ownerUserId?: string | null; statusMode?: ScorecardStatusMode }
): T {
  return { ...state, ...patch, sourceValue: state.sourceValue };
}

export function resolveSharedTarget(
  entries: { metricKey: string; campus: string; periodKey: string; value: number; setAt: string }[],
  query: { metricKey: string; campus: string; periodKey: string }
): OsSharedTarget | null {
  const matches = entries.filter(
    (entry) => entry.metricKey === query.metricKey && entry.campus === query.campus && entry.periodKey === query.periodKey
  );
  if (matches.length === 0) return null;
  const latest = [...matches].sort((a, b) => a.setAt.localeCompare(b.setAt)).at(-1);
  if (!latest) return null;
  const conflict = new Set(matches.map((entry) => entry.value)).size > 1;
  return { ...query, value: latest.value, setAt: latest.setAt, conflict };
}

export function targetValueFor(
  note: Pick<OsScorecardNote, "target" | "targets"> | null,
  shared: OsSharedTarget | null,
  periodKey: string
): number | null {
  if (shared) return shared.value;
  const keyed = note?.targets?.[periodKey]?.value;
  if (typeof keyed === "number") return keyed;
  if (!note?.target) return null;
  const parsed = parseNumeric(note.target);
  return parsed.ok ? parsed.value : null;
}

export type StoredSelection = {
  id: string;
  team: OsTeam;
  metricKey: string;
  campus: string;
  periodKind: string;
  removed: boolean;
  version: number;
  sortOrder: number;
  ownerUserId: string | null;
};

export type SelectionWrite =
  | {
      op: "insert";
      team: OsTeam;
      metricKey: string;
      campus: string;
      periodKind: string;
      sortOrder: number;
      ownerUserId: string | null;
      label: string;
    }
  | { op: "restore"; id: string; team: OsTeam; sortOrder: number; ownerUserId: string | null; expectedVersion: number }
  | { op: "remove"; id: string; team: OsTeam; expectedVersion: number }
  | { op: "order"; id: string; team: OsTeam; sortOrder: number; expectedVersion: number }
  | { op: "meta"; team: OsTeam };

export function authorizeSelectionWrites(input: {
  team: OsTeam;
  canReadGiving: boolean;
  writes: readonly SelectionWrite[];
  stored: readonly StoredSelection[];
}): { ok: true; writes: SelectionWrite[] } | { ok: false; error: string } {
  const writes: SelectionWrite[] = [];
  for (const write of input.writes) {
    if (write.team !== input.team) return { ok: false, error: "That change belongs to another team." };
    const stored = write.op === "restore" || write.op === "order" || write.op === "remove"
      ? input.stored.find((row) => row.id === write.id)
      : undefined;
    const metricKey = write.op === "insert" ? write.metricKey : stored?.metricKey ?? null;
    const campus = write.op === "insert" ? write.campus : stored?.campus ?? null;
    if (write.op !== "remove" && metricKey === "giving") {
      const gate = givingWriteAllowed({
        team: input.team,
        canReadGiving: input.canReadGiving,
        metricKey,
        campus,
      });
      if (!gate.allowed) continue;
    }
    writes.push(write);
  }
  return { ok: true, writes };
}

export function reviewMetricKeys(input: {
  configured: boolean;
  defaults: readonly string[];
  notes: readonly { metricKey: string; sortOrder: number; manual: boolean }[];
}): string[] {
  if (!input.configured) {
    const extras = input.notes
      .filter((note) => note.manual && !input.defaults.includes(note.metricKey))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((note) => note.metricKey);
    return [...new Set([...input.defaults, ...extras])];
  }
  return [
    ...new Set(
      [...input.notes]
        .sort((a, b) => a.sortOrder - b.sortOrder || a.metricKey.localeCompare(b.metricKey))
        .map((note) => note.metricKey)
    ),
  ];
}

function activeStored(stored: readonly StoredSelection[], team: OsTeam, metricKey: string, campus: string, periodKind: string) {
  return stored.find(
    (row) =>
      row.team === team &&
      row.metricKey === metricKey &&
      row.campus === campus &&
      row.periodKind === periodKind &&
      !row.removed
  );
}

export function planSelectionChange(input: {
  team: OsTeam;
  configured: boolean;
  defaults: readonly { metricKey: string; campus: string; periodKind: string; label: string }[];
  stored: readonly StoredSelection[];
  change:
    | { type: "add"; metricKey: string; campus: string; periodKind: string; ownerUserId: string | null; label: string }
    | { type: "remove"; metricKey: string; campus: string; periodKind: string }
    | { type: "reorder"; metricKeys: readonly string[] };
}): { ok: true; writes: SelectionWrite[] } | { ok: false; error: string } {
  const mine = input.stored.filter((row) => row.team === input.team);
  const writes: SelectionWrite[] = [];
  const materialize = !input.configured;

  if (input.change.type === "add") {
    const added = input.change;
    const duplicate =
      mine.some((row) => !row.removed && row.metricKey === added.metricKey) ||
      (!input.configured && input.defaults.some((row) => row.metricKey === added.metricKey));
    if (duplicate) return { ok: false, error: "That measure, campus, and reporting period are already on this scorecard." };
    if (materialize) {
      input.defaults.forEach((row, index) => {
        if (activeStored(mine, input.team, row.metricKey, row.campus, row.periodKind)) return;
        writes.push({
          op: "insert",
          team: input.team,
          metricKey: row.metricKey,
          campus: row.campus,
          periodKind: row.periodKind,
          sortOrder: index,
          ownerUserId: null,
          label: row.label,
        });
      });
      writes.push({ op: "meta", team: input.team });
    }
    const removed = mine.find(
      (row) =>
        row.metricKey === added.metricKey &&
        row.campus === added.campus &&
        row.periodKind === added.periodKind &&
        row.removed
    );
    const sortOrder = input.defaults.length + mine.filter((row) => !row.removed).length;
    if (removed) {
      writes.push({
        op: "restore",
        id: removed.id,
        team: input.team,
        sortOrder,
        ownerUserId: added.ownerUserId,
        expectedVersion: removed.version,
      });
    } else {
      writes.push({
        op: "insert",
        team: input.team,
        metricKey: added.metricKey,
        campus: added.campus,
        periodKind: added.periodKind,
        sortOrder,
        ownerUserId: added.ownerUserId,
        label: added.label,
      });
    }
    return { ok: true, writes };
  }

  if (input.change.type === "remove") {
    const removedChange = input.change;
    const current = reviewMetricKeys({
      configured: input.configured,
      defaults: input.defaults.map((row) => row.metricKey),
      notes: mine.filter((row) => !row.removed).map((row) => ({
        metricKey: row.metricKey,
        sortOrder: row.sortOrder,
        manual: isManualMetric(row.metricKey),
      })),
    });
    if (!current.includes(removedChange.metricKey)) {
      return { ok: false, error: "That measure is not on this scorecard." };
    }
    if (materialize) {
      input.defaults.forEach((row, index) => {
        if (row.metricKey === removedChange.metricKey) return;
        if (activeStored(mine, input.team, row.metricKey, row.campus, row.periodKind)) return;
        writes.push({
          op: "insert",
          team: input.team,
          metricKey: row.metricKey,
          campus: row.campus,
          periodKind: row.periodKind,
          sortOrder: index,
          ownerUserId: null,
          label: row.label,
        });
      });
      writes.push({ op: "meta", team: input.team });
    }
    const stored = activeStored(mine, input.team, removedChange.metricKey, removedChange.campus, removedChange.periodKind);
    if (stored) writes.push({ op: "remove", id: stored.id, team: input.team, expectedVersion: stored.version });
    return {
      ok: true,
      writes: writes.filter((write) => write.op !== "insert" || write.metricKey !== removedChange.metricKey),
    };
  }

  const current = reviewMetricKeys({
    configured: input.configured,
    defaults: input.defaults.map((row) => row.metricKey),
    notes: mine.filter((row) => !row.removed).map((row) => ({
      metricKey: row.metricKey,
      sortOrder: row.sortOrder,
      manual: isManualMetric(row.metricKey),
    })),
  });
  if (
    input.change.metricKeys.length !== current.length ||
    input.change.metricKeys.some((key) => !current.includes(key))
  ) {
    return { ok: false, error: "The scorecard order changed. Refresh this list and try again." };
  }
  input.change.metricKeys.forEach((key, index) => {
    const sample = input.defaults.find((row) => row.metricKey === key);
    const stored = mine.find((row) => row.metricKey === key && !row.removed);
    if (stored) {
      writes.push({ op: "order", id: stored.id, team: input.team, sortOrder: index, expectedVersion: stored.version });
      return;
    }
    writes.push({
      op: "insert",
      team: input.team,
      metricKey: key,
      campus: sample?.campus ?? "church-wide",
      periodKind: sample?.periodKind ?? "monthly",
      sortOrder: index,
      ownerUserId: null,
      label: sample?.label ?? key,
    });
  });
  if (materialize) writes.push({ op: "meta", team: input.team });
  return { ok: true, writes };
}

export function addReading(existing: readonly OsManualReading[], next: OsManualReading): OsManualReading[] {
  return [...existing, next];
}

export function lensCampus(storedCampus: string, lens: string): string {
  if (lens === "mount-pleasant" || lens === "alma" || lens === "st-johns") return lens;
  return storedCampus || "church-wide";
}

export function lensTargetMatches(storedCampus: string, lens: string): boolean {
  if (lens !== "mount-pleasant" && lens !== "alma" && lens !== "st-johns") return true;
  return (storedCampus || "church-wide") === lens;
}

export function displayedReading(
  readings: readonly OsManualReading[],
  metricKey: string,
  campus: string
): OsManualReading | null {
  const matches = readings.filter((reading) => reading.metricKey === metricKey && reading.campus === campus);
  return [...matches].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1) ?? null;
}

export function readingValue(reading: OsManualReading | null): number | null {
  return reading ? reading.value : null;
}

export function ownerLabel(
  ownerUserId: string | null,
  ownerName: string,
  members: readonly { id: string; name: string }[]
): string {
  if (!ownerUserId) return "Unassigned";
  return members.find((member) => member.id === ownerUserId)?.name || ownerName || "Assigned member";
}

export function moveKeys(keys: readonly string[], index: number, direction: -1 | 1): string[] {
  return placeKeys(keys, index, index + direction);
}

export function placeKeys(keys: readonly string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= keys.length || to >= keys.length) return [...keys];
  const next = [...keys];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function filterManualDefinitions(
  definitions: readonly OsManualDefinition[],
  viewer: { team: OsTeam; isAdmin: boolean }
): OsManualDefinition[] {
  return definitions.filter(
    (definition) => definition.published || definition.homeTeam === viewer.team || viewer.isAdmin
  );
}

function detailObject(details: unknown): Record<string, unknown> {
  if (!details) return {};
  if (typeof details === "object" && !Array.isArray(details)) return details as Record<string, unknown>;
  if (typeof details !== "string") return {};
  try {
    const parsed = JSON.parse(details) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    return { owner: details };
  }
  return { owner: details };
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function unitOf(value: unknown, fallback: ScorecardUnit): ScorecardUnit {
  if (value === "people" || value === "currency" || value === "count" || value === "percent" || value === "other") return value;
  return fallback;
}

export function parseScorecardNote(
  team: OsTeam,
  row: {
    id: string;
    metricKey: string | null;
    title: string;
    details: unknown;
    campus?: string | null;
    periodLabel?: string | null;
    ownerId?: string | null;
    updatedAt?: string | null;
  }
): OsScorecardNote | null {
  if (row.metricKey === SCORECARD_READY_KEY) return null;
  const details = detailObject(row.details);
  const role = text(details.role);
  if (role !== "scorecard" && role !== "manual") return null;
  const metricKey = row.metricKey ?? row.id;
  const targets: Record<string, OsScorecardTarget> = {};
  if (details.targets && typeof details.targets === "object" && !Array.isArray(details.targets)) {
    for (const [key, value] of Object.entries(details.targets as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const record = value as Record<string, unknown>;
      const parsed = numberOrNull(record.value);
      if (parsed == null) continue;
      targets[key] = {
        value: parsed,
        unit: unitOf(record.unit, "count"),
        setBy: text(record.setBy),
        setAt: text(record.setAt),
      };
    }
  }
  const comparison = details.comparison === "lower" || details.comparison === "range" ? details.comparison : "higher";
  const manualStatus =
    details.manualStatus === "on_track" || details.manualStatus === "needs_attention" || details.manualStatus === "off_track"
      ? details.manualStatus
      : null;
  return {
    id: row.id,
    team,
    metricKey,
    label: row.title,
    owner: text(details.owner),
    ownerUserId: row.ownerId ?? (typeof details.ownerUserId === "string" ? details.ownerUserId : null),
    target: text(details.target),
    manualValue: text(details.manualValue),
    allowValue: role === "manual" || metricKey.startsWith("manual:"),
    version: typeof details.version === "number" ? details.version : 1,
    sortOrder: typeof details.sortOrder === "number" ? details.sortOrder : 0,
    campus: row.campus || text(details.campus) || "church-wide",
    periodKind: row.periodLabel || text(details.periodKind) || canonicalMetric(metricKey)?.periodKind || "monthly",
    statusMode: details.statusMode === "manual" ? "manual" : "automatic",
    manualStatus,
    overrideReason: text(details.overrideReason),
    statusSetBy: text(details.statusSetBy),
    statusSetByName: text(details.statusSetByName),
    statusSetAt: text(details.statusSetAt) || null,
    statusPeriodKey: text(details.statusPeriodKey),
    targets,
    definition: text(details.definition),
    unit: unitOf(details.unit, canonicalMetric(metricKey)?.unit ?? "count"),
    frequency: text(details.frequency) || row.periodLabel || canonicalMetric(metricKey)?.periodKind || "monthly",
    comparison,
    rangeMin: numberOrNull(details.rangeMin),
    rangeMax: numberOrNull(details.rangeMax),
    attentionMin: numberOrNull(details.attentionMin),
    attentionMax: numberOrNull(details.attentionMax),
    explicitMax: numberOrNull(details.explicitMax),
    published: details.published === true,
    updatedAt: row.updatedAt ?? null,
  };
}

export function parseReading(
  team: OsTeam,
  row: {
    id: string;
    metricKey: string | null;
    details: unknown;
    campus?: string | null;
    periodLabel?: string | null;
  }
): OsManualReading | null {
  const details = detailObject(row.details);
  if (text(details.role) !== "reading") return null;
  const value = numberOrNull(details.value);
  if (value == null || !row.metricKey) return null;
  return {
    id: row.id,
    metricKey: row.metricKey,
    team,
    campus: row.campus || text(details.campus) || "church-wide",
    periodStart: text(details.periodStart),
    periodEnd: text(details.periodEnd),
    periodLabel: row.periodLabel || text(details.periodLabel),
    value,
    unit: unitOf(details.unit, "count"),
    actorId: text(details.actorId),
    actorName: text(details.actorName),
    createdAt: text(details.createdAt),
    correctsId: text(details.correctsId) || null,
  };
}

export function toManualDefinition(note: OsScorecardNote): OsManualDefinition | null {
  if (!note.allowValue && !note.metricKey.startsWith("manual:")) return null;
  return {
    metricKey: note.metricKey,
    label: note.label,
    definition: note.definition,
    unit: note.unit,
    frequency: note.frequency,
    campus: note.campus,
    comparison: note.comparison,
    rangeMin: note.rangeMin,
    rangeMax: note.rangeMax,
    attentionMin: note.attentionMin,
    attentionMax: note.attentionMax,
    explicitMax: note.explicitMax,
    published: note.published,
    homeTeam: note.team,
  };
}

export function syntheticManualMeasure(note: OsScorecardNote, reading: OsManualReading | null): OsMeasure {
  return {
    key: note.metricKey,
    label: note.label,
    definition: note.definition || "Manual measure entered for this meeting.",
    unit: note.unit,
    periodLabel: reading?.periodLabel || periodGrainLabel(note.frequency),
    periodKind: note.frequency || note.periodKind,
    campusLabel: note.campus === "church-wide" ? "Church-wide" : note.campus,
    value: null,
    sourceLabel: "Manual entry",
    reportHref: null,
    refreshedAt: reading?.createdAt ?? null,
    quality: "manual",
    qualityDetail: reading
      ? `Entered by ${reading.actorName || "a team member"} for ${reading.periodLabel || "the recorded period"}.`
      : "No manual actual has been entered. An empty period is not zero.",
    history: [],
    staffing: null,
  };
}

export function writesStayOnScorecard(writes: readonly SelectionWrite[]): boolean {
  return writes.every((write) => write.team.length > 0) && !JSON.stringify(writes).includes("pulse_archives") && !JSON.stringify(writes).includes("metric_snapshots");
}
