import { eligibleOwners, isFictionalOwnerName } from "./owners";
import { canReadGiving } from "./rules";
import { givingWriteAllowed } from "./scorecard";
import { OS_TEAMS, OS_TEAM_LABELS, type OsIssueStatus, type OsRockStatus, type OsTeam } from "./types";

export const PLANNING_MIGRATION_FILE = "supabase/migrations/20261029234500_pulse_planning.sql";

export const PULSE_MIGRATION_SET = [
  "supabase/migrations/20261029133000_pulse_meeting.sql",
  "supabase/migrations/20261029194500_pulse_ids.sql",
  "supabase/migrations/20261029201000_pulse_tangent_signal.sql",
  "supabase/migrations/20261029220000_pulse_scorecard.sql",
  PLANNING_MIGRATION_FILE,
] as const;

export const PLANNING_UNAVAILABLE =
  "Vision and accountability content is not stored until the Pulse migrations are applied to a named development database.";

export const PLANNING_NOT_STORED = `This edit was not stored. ${PLANNING_UNAVAILABLE}`;

const TEXT_MAX = 2000;
const SHORT_MAX = 200;
const LIST_MAX = 12;
const MEASURE_MAX = 8;

export const VISION_KEYS = ["values", "focus", "target", "strategy", "picture"] as const;
export const TRACTION_KEYS = ["annual"] as const;
export const SWOT_KEYS = ["swotStrengths", "swotWeaknesses", "swotOpportunities", "swotThreats"] as const;
export const SECTION_KEYS = [...VISION_KEYS, ...TRACTION_KEYS, ...SWOT_KEYS] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];
export type PlanningScope = "church" | OsTeam;
export type SwotKey = (typeof SWOT_KEYS)[number];

export const SECTION_TITLES: Record<SectionKey, string> = {
  values: "Core Values",
  focus: "Core Focus",
  target: "10-Year Target",
  strategy: "Ministry Reach Strategy",
  picture: "3-Year Picture",
  annual: "1-Year Plan",
  swotStrengths: "Strengths",
  swotWeaknesses: "Weaknesses",
  swotOpportunities: "Opportunities",
  swotThreats: "Threats",
};

export type MeasureField = { label: string; target: string };

export type ValuesContent = { kind: "values"; values: string[] };
export type FocusContent = { kind: "focus"; purpose: string; niche: string };
export type TargetContent = { kind: "target"; futureDate: string; measures: MeasureField[]; description: string };
export type StrategyContent = {
  kind: "strategy";
  whoWeServe: string;
  distinctives: string;
  pathway: string;
  promise: string;
};
export type PictureContent = { kind: "picture"; futureDate: string; outcomes: MeasureField[]; description: string };
export type AnnualContent = { kind: "annual"; futureDate: string; goals: string[] };
export type SwotContent = { kind: "swot"; items: string[] };

export type SectionContent =
  | ValuesContent
  | FocusContent
  | TargetContent
  | StrategyContent
  | PictureContent
  | AnnualContent
  | SwotContent;

export type SectionRecord = {
  scope: PlanningScope;
  key: SectionKey;
  content: SectionContent;
  updatedAt: string;
  updatedBy: string;
  updatedByName: string | null;
};

export type ResolvedSection = {
  key: SectionKey;
  content: SectionContent;
  inherited: boolean;
  origin: "empty" | "church" | "team";
  badge: "Church-wide draft" | "Church-wide reference" | "Team draft";
  updatedAt: string | null;
  updatedByName: string | null;
};

export type PlanningVersion = {
  id: string;
  scope: PlanningScope;
  authorId: string;
  createdAt: string;
  sections: { key: SectionKey; content: SectionContent; inherited: boolean }[];
  recordRefs: { rocks: string[]; issues: string[] };
};

export type PlanningVersionView = PlanningVersion & { authorName: string | null };

export type Publication = {
  id: string;
  versionId: string;
  scope: PlanningScope;
  actorId: string;
  createdAt: string;
  status: "approved";
};

export type PlanningView = {
  stored: boolean;
  migrationFile: string;
  church: Partial<Record<SectionKey, SectionRecord>>;
  own: Partial<Record<SectionKey, SectionRecord>>;
  versions: PlanningVersionView[];
  approvedVersionIds: string[];
};

export type SeatNode = {
  id: string;
  title: string;
  functionLabel: string;
  personId: string | null;
  personName: string | null;
  parentId: string | null;
  accountabilities: string[];
  updatedAt: string;
  archivedAt: string | null;
};

export type SeatReference = { id: string; seatId: string | null; label: string };

export type SeatView = {
  stored: boolean;
  migrationFile: string;
  seats: SeatNode[];
  people: { id: string; name: string }[];
  references: SeatReference[];
};

export type ArchiveSubordinateChoice = "move_to_parent" | "archive_with_seat";
export type ArchiveReferenceChoice = "keep" | "detach";

export function isSectionKey(value: string): value is SectionKey {
  return (SECTION_KEYS as readonly string[]).includes(value);
}

export function isSwotKey(key: SectionKey): key is SwotKey {
  return (SWOT_KEYS as readonly string[]).includes(key);
}

export function isPlanningScope(value: string): value is PlanningScope {
  return value === "church" || OS_TEAMS.includes(value as OsTeam);
}

export function emptyContent(key: SectionKey): SectionContent {
  switch (key) {
    case "values":
      return { kind: "values", values: [] };
    case "focus":
      return { kind: "focus", purpose: "", niche: "" };
    case "target":
      return { kind: "target", futureDate: "", measures: [], description: "" };
    case "strategy":
      return { kind: "strategy", whoWeServe: "", distinctives: "", pathway: "", promise: "" };
    case "picture":
      return { kind: "picture", futureDate: "", outcomes: [], description: "" };
    case "annual":
      return { kind: "annual", futureDate: "", goals: [] };
    default:
      return { kind: "swot", items: [] };
  }
}

export function emptyPlanningView(): PlanningView {
  return {
    stored: false,
    migrationFile: PLANNING_MIGRATION_FILE,
    church: {},
    own: {},
    versions: [],
    approvedVersionIds: [],
  };
}

export function emptySeatView(): SeatView {
  return {
    stored: false,
    migrationFile: PLANNING_MIGRATION_FILE,
    seats: [],
    people: [],
    references: [],
  };
}

export function isEmptyContent(content: SectionContent): boolean {
  return contentFields(content).every((field) => !field.value.trim());
}

export function contentFields(content: SectionContent): { label: string; value: string }[] {
  switch (content.kind) {
    case "values":
      return content.values.map((value, index) => ({ label: `Value ${index + 1}`, value }));
    case "focus":
      return [
        { label: "Purpose / cause / passion", value: content.purpose },
        { label: "Niche", value: content.niche },
      ];
    case "target":
      return [
        { label: "Future date", value: content.futureDate },
        ...content.measures.map((measure, index) => ({
          label: `Measure ${index + 1}`,
          value: [measure.label, measure.target].filter(Boolean).join(" · "),
        })),
        { label: "Description", value: content.description },
      ];
    case "strategy":
      return [
        { label: "Who we serve", value: content.whoWeServe },
        { label: "Distinctives", value: content.distinctives },
        { label: "Pathway", value: content.pathway },
        { label: "Promise", value: content.promise },
      ];
    case "picture":
      return [
        { label: "Future date", value: content.futureDate },
        ...content.outcomes.map((outcome, index) => ({
          label: `Outcome ${index + 1}`,
          value: [outcome.label, outcome.target].filter(Boolean).join(" · "),
        })),
        { label: "Description", value: content.description },
      ];
    case "annual":
      return [
        { label: "Future date", value: content.futureDate },
        ...content.goals.map((goal, index) => ({ label: `Goal ${index + 1}`, value: goal })),
      ];
    case "swot":
      return content.items.map((item, index) => ({ label: `Item ${index + 1}`, value: item }));
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asText(value: unknown, max: number): { ok: true; value: string } | { ok: false; reason: string } {
  if (typeof value !== "string") return { ok: false, reason: "Enter text in the matching field." };
  return { ok: true, value: value.trim().slice(0, max) };
}

function asDate(value: unknown): { ok: true; value: string } | { ok: false; reason: string } {
  const text = asText(value, 10);
  if (!text.ok) return text;
  if (!text.value) return { ok: true, value: "" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text.value)) return { ok: false, reason: "Enter the future date as a date." };
  const [year, month, day] = text.value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return { ok: false, reason: "Enter a real calendar date." };
  }
  return { ok: true, value: text.value };
}

function asStringList(
  value: unknown,
  max: number,
  reason: string
): { ok: true; value: string[] } | { ok: false; reason: string } {
  if (!Array.isArray(value)) return { ok: false, reason };
  if (value.some((item) => typeof item !== "string")) return { ok: false, reason };
  const items = value.map((item) => item.trim().slice(0, SHORT_MAX)).filter(Boolean).slice(0, max);
  return { ok: true, value: items };
}

function asMeasures(
  value: unknown,
  reason: string
): { ok: true; value: MeasureField[] } | { ok: false; reason: string } {
  if (!Array.isArray(value)) return { ok: false, reason };
  const rows: MeasureField[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) return { ok: false, reason };
    const label = asText(record.label, SHORT_MAX);
    const target = asText(record.target, SHORT_MAX);
    if (!label.ok || !target.ok) return { ok: false, reason };
    if (!label.value && !target.value) continue;
    rows.push({ label: label.value, target: target.value });
    if (rows.length >= MEASURE_MAX) break;
  }
  return { ok: true, value: rows };
}

export function parseSectionContent(
  key: SectionKey,
  value: unknown
): { ok: true; content: SectionContent } | { ok: false; reason: string } {
  if (typeof value === "string") return { ok: false, reason: "Keep dates, targets, goals, values, and descriptions in separate fields." };
  const record = asRecord(value);
  if (!record) return { ok: false, reason: "That section is missing its fields." };
  switch (key) {
    case "values": {
      if (record.kind !== "values") return { ok: false, reason: "Core Values needs its own list." };
      const values = asStringList(record.values, LIST_MAX, "Enter each core value in its own field.");
      if (!values.ok) return values;
      return { ok: true, content: { kind: "values", values: values.value } };
    }
    case "focus": {
      if (record.kind !== "focus") return { ok: false, reason: "Core Focus keeps purpose and niche separate." };
      const purpose = asText(record.purpose, TEXT_MAX);
      const niche = asText(record.niche, TEXT_MAX);
      if (!purpose.ok) return purpose;
      if (!niche.ok) return niche;
      return { ok: true, content: { kind: "focus", purpose: purpose.value, niche: niche.value } };
    }
    case "target": {
      if (record.kind !== "target") return { ok: false, reason: "The 10-year target keeps the date, measures, and description separate." };
      const futureDate = asDate(record.futureDate);
      const measures = asMeasures(record.measures, "Enter each measure as a name and a target.");
      const description = asText(record.description, TEXT_MAX);
      if (!futureDate.ok) return futureDate;
      if (!measures.ok) return measures;
      if (!description.ok) return description;
      return { ok: true, content: { kind: "target", futureDate: futureDate.value, measures: measures.value, description: description.value } };
    }
    case "strategy": {
      if (record.kind !== "strategy") return { ok: false, reason: "Ministry Reach Strategy keeps its fields separate." };
      const whoWeServe = asText(record.whoWeServe, TEXT_MAX);
      const distinctives = asText(record.distinctives, TEXT_MAX);
      const pathway = asText(record.pathway, TEXT_MAX);
      const promise = asText(record.promise, TEXT_MAX);
      if (!whoWeServe.ok) return whoWeServe;
      if (!distinctives.ok) return distinctives;
      if (!pathway.ok) return pathway;
      if (!promise.ok) return promise;
      return {
        ok: true,
        content: {
          kind: "strategy",
          whoWeServe: whoWeServe.value,
          distinctives: distinctives.value,
          pathway: pathway.value,
          promise: promise.value,
        },
      };
    }
    case "picture": {
      if (record.kind !== "picture") return { ok: false, reason: "The 3-year picture keeps the date, outcomes, and description separate." };
      const futureDate = asDate(record.futureDate);
      const outcomes = asMeasures(record.outcomes, "Enter each outcome as a name and a target.");
      const description = asText(record.description, TEXT_MAX);
      if (!futureDate.ok) return futureDate;
      if (!outcomes.ok) return outcomes;
      if (!description.ok) return description;
      return { ok: true, content: { kind: "picture", futureDate: futureDate.value, outcomes: outcomes.value, description: description.value } };
    }
    case "annual": {
      if (record.kind !== "annual") return { ok: false, reason: "The 1-year plan keeps the date and goals separate." };
      const futureDate = asDate(record.futureDate);
      const goals = asStringList(record.goals, LIST_MAX, "Enter each annual goal in its own field.");
      if (!futureDate.ok) return futureDate;
      if (!goals.ok) return goals;
      return { ok: true, content: { kind: "annual", futureDate: futureDate.value, goals: goals.value } };
    }
    default: {
      if (record.kind !== "swot") return { ok: false, reason: "SWOT items stay in their own list." };
      const items = asStringList(record.items, LIST_MAX, "Enter each SWOT item in its own field.");
      if (!items.ok) return items;
      return { ok: true, content: { kind: "swot", items: items.value } };
    }
  }
}

export function sectionVisibleToScope(record: SectionRecord, scope: PlanningScope): boolean {
  if (record.scope !== "church" && record.scope !== scope) return false;
  if (isSwotKey(record.key) && scope !== record.scope) return false;
  return true;
}

export function resolveSection(input: {
  key: SectionKey;
  scope: PlanningScope;
  church: SectionRecord | null;
  own: SectionRecord | null;
}): ResolvedSection {
  const empty = emptyContent(input.key);
  const church = input.church && sectionVisibleToScope(input.church, "church") ? input.church : null;
  const own =
    input.scope !== "church" && input.own && input.own.scope === input.scope && sectionVisibleToScope(input.own, input.scope)
      ? input.own
      : null;

  if (isSwotKey(input.key)) {
    const source = input.scope === "church" ? church : own;
    if (!source || source.key !== input.key) {
      return {
        key: input.key,
        content: empty,
        inherited: false,
        origin: "empty",
        badge: input.scope === "church" ? "Church-wide draft" : "Team draft",
        updatedAt: null,
        updatedByName: null,
      };
    }
    return {
      key: input.key,
      content: source.content,
      inherited: false,
      origin: input.scope === "church" ? "church" : "team",
      badge: input.scope === "church" ? "Church-wide draft" : "Team draft",
      updatedAt: source.updatedAt,
      updatedByName: source.updatedByName,
    };
  }

  if (input.scope === "church") {
    if (!church || church.key !== input.key) {
      return {
        key: input.key,
        content: empty,
        inherited: false,
        origin: "empty",
        badge: "Church-wide draft",
        updatedAt: null,
        updatedByName: null,
      };
    }
    return {
      key: input.key,
      content: church.content,
      inherited: false,
      origin: "church",
      badge: "Church-wide draft",
      updatedAt: church.updatedAt,
      updatedByName: church.updatedByName,
    };
  }

  if (own && own.key === input.key) {
    return {
      key: input.key,
      content: own.content,
      inherited: false,
      origin: "team",
      badge: "Team draft",
      updatedAt: own.updatedAt,
      updatedByName: own.updatedByName,
    };
  }

  const shared = church && church.key === input.key ? church : null;
  return {
    key: input.key,
    content: shared ? structuredClone(shared.content) : empty,
    inherited: true,
    origin: shared ? "church" : "empty",
    badge: "Church-wide reference",
    updatedAt: shared?.updatedAt ?? null,
    updatedByName: shared?.updatedByName ?? null,
  };
}

export function applySectionWrite(input: {
  church: SectionRecord | null;
  own: SectionRecord | null;
  scope: PlanningScope;
  key: SectionKey;
  content: SectionContent;
  actorId: string;
  at: string;
}): { church: SectionRecord | null; own: SectionRecord | null } {
  const next: SectionRecord = {
    scope: input.scope,
    key: input.key,
    content: structuredClone(input.content),
    updatedAt: input.at,
    updatedBy: input.actorId,
    updatedByName: null,
  };
  if (input.scope === "church") {
    return { church: next, own: input.own ? structuredClone(input.own) : null };
  }
  return { church: input.church ? structuredClone(input.church) : null, own: next };
}

export function dropTeamOverride(input: {
  church: SectionRecord | null;
  own: SectionRecord | null;
}): { church: SectionRecord | null; own: null } {
  return { church: input.church ? structuredClone(input.church) : null, own: null };
}

export function buildVersion(input: {
  id: string;
  scope: PlanningScope;
  authorId: string;
  createdAt: string;
  church: Partial<Record<SectionKey, SectionRecord | null>>;
  own: Partial<Record<SectionKey, SectionRecord | null>>;
  rockIds: string[];
  issueIds: string[];
}): PlanningVersion {
  return {
    id: input.id,
    scope: input.scope,
    authorId: input.authorId,
    createdAt: input.createdAt,
    sections: SECTION_KEYS.map((key) => {
      const resolved = resolveSection({
        key,
        scope: input.scope,
        church: input.church[key] ?? null,
        own: input.own[key] ?? null,
      });
      return { key, content: structuredClone(resolved.content), inherited: resolved.inherited };
    }),
    recordRefs: {
      rocks: [...input.rockIds],
      issues: [...input.issueIds],
    },
  };
}

export function keepSavedVersion(saved: PlanningVersion, _proposed: PlanningVersion): PlanningVersion {
  return structuredClone(saved);
}

export function versionHasSubstance(version: PlanningVersion): boolean {
  if (version.recordRefs.rocks.length > 0 || version.recordRefs.issues.length > 0) return true;
  return version.sections.some((section) => !isEmptyContent(section.content));
}

export function approveVersion(input: {
  version: PlanningVersion;
  alreadyApproved: boolean;
  isAdmin: boolean;
  actorId: string;
  at: string;
  id: string;
}): { ok: true; publication: Publication; version: PlanningVersion } | { ok: false; reason: string } {
  if (!input.isAdmin) return { ok: false, reason: "Only an administrator can approve a planning version." };
  if (input.alreadyApproved) return { ok: false, reason: "That version is already approved." };
  if (!versionHasSubstance(input.version)) return { ok: false, reason: "Empty starter content cannot be approved." };
  return {
    ok: true,
    version: structuredClone(input.version),
    publication: {
      id: input.id,
      versionId: input.version.id,
      scope: input.version.scope,
      actorId: input.actorId,
      createdAt: input.at,
      status: "approved",
    },
  };
}

export function verifiedRecordRefs(
  requested: { rocks: string[]; issues: string[] },
  existing: { rocks: string[]; issues: string[] }
): { rocks: string[]; issues: string[] } {
  const rocks = new Set(existing.rocks);
  const issues = new Set(existing.issues);
  return {
    rocks: requested.rocks.filter((id) => rocks.has(id)),
    issues: requested.issues.filter((id) => issues.has(id)),
  };
}

export type SharedWorkItem = {
  id: string;
  team: OsTeam;
  kind: "rock" | "issue";
  title: string;
  owner: string;
  dueOn: string | null;
  rockStatus: OsRockStatus | null;
  issueStatus: OsIssueStatus | null;
};

export function tractionItems<T extends { kind: string; issueStatus?: string | null }>(
  items: readonly T[],
  kind: "rock" | "issue"
): T[] {
  if (kind === "rock") return items.filter((item) => item.kind === "rock");
  return items.filter((item) => item.kind === "issue" && item.issueStatus !== "solved");
}

export function tractionNote(scope: PlanningScope, team: OsTeam): string | null {
  if (scope !== "church") return null;
  return `Filtered to ${OS_TEAM_LABELS[team]}. Church-wide planning links to that team's Rocks and issues and does not copy them.`;
}

export function canViewPlanning(input: { isAdmin: boolean; participant: boolean }): boolean {
  return input.isAdmin || input.participant;
}

export function canEditChurchPlanning(input: { isAdmin: boolean; canEditBenchmarks: boolean }): boolean {
  return input.isAdmin || input.canEditBenchmarks;
}

export function canEditTeamPlanning(input: {
  isAdmin: boolean;
  facilitatorTeams: readonly OsTeam[];
  team: OsTeam;
}): boolean {
  return input.isAdmin || input.facilitatorTeams.includes(input.team);
}

export function canManageSeats(input: { isAdmin: boolean }): boolean {
  return input.isAdmin;
}

export function canApprovePlan(input: { isAdmin: boolean }): boolean {
  return input.isAdmin;
}

export function planningWriteAllowed(input: {
  scope: PlanningScope;
  isAdmin: boolean;
  canEditBenchmarks: boolean;
  facilitatorTeams: readonly OsTeam[];
}): { ok: true } | { ok: false; reason: string } {
  if (input.scope === "church") {
    if (!canEditChurchPlanning(input)) {
      return { ok: false, reason: "Church-wide planning needs an administrator or shared-benchmark access." };
    }
    return { ok: true };
  }
  if (!canEditTeamPlanning({ ...input, team: input.scope })) {
    return { ok: false, reason: "Only that team's facilitator can edit its planning draft." };
  }
  return { ok: true };
}

export function givingAllowedForTeam(input: { team: OsTeam; financialInsights: boolean; isAdmin: boolean }): boolean {
  return givingWriteAllowed({
    team: input.team,
    canReadGiving: canReadGiving(input),
    metricKey: "giving",
    campus: "church-wide",
  }).allowed;
}

export function planningAccess(input: {
  isAdmin: boolean;
  canEditBenchmarks: boolean;
  facilitatorTeams: readonly OsTeam[];
  team: OsTeam;
  financialInsights: boolean;
  participant?: boolean;
}) {
  return {
    canView: canViewPlanning({ isAdmin: input.isAdmin, participant: input.participant ?? true }),
    canEditChurchPlanning: canEditChurchPlanning(input),
    canEditTeamPlanning: canEditTeamPlanning(input),
    canManageSeats: canManageSeats(input),
    canApprove: canApprovePlan(input),
    givingAllowed: givingAllowedForTeam(input),
  };
}

export function seatAssignmentGrantsAccess<T extends { canReadGiving: boolean; capability: string | null }>(
  before: T,
  personId: string | null
): T & { personId: string | null } {
  return { ...before, personId };
}

export function seatRowForSave(input: {
  title: string;
  functionLabel: string;
  personId: string | null;
  parentId: string | null;
  accountabilities: string[];
}): {
  title: string;
  function_label: string;
  person_id: string | null;
  parent_id: string | null;
  accountabilities: string[];
} {
  return {
    title: input.title,
    function_label: input.functionLabel,
    person_id: input.personId,
    parent_id: input.parentId,
    accountabilities: [...input.accountabilities],
  };
}

export function concurrentEditResult(
  expected: string | null,
  current: string | null
): "insert" | "update" | "conflict" {
  if (current == null && expected == null) return "insert";
  if (current == null || expected == null || current !== expected) return "conflict";
  return "update";
}

export function wouldCreateCycle(
  seats: readonly { id: string; parentId: string | null }[],
  seatId: string,
  nextParentId: string | null
): boolean {
  if (!nextParentId) return false;
  let current: string | null = nextParentId;
  const seen = new Set<string>();
  while (current) {
    if (current === seatId || seen.has(current)) return true;
    seen.add(current);
    current = seats.find((seat) => seat.id === current)?.parentId ?? null;
  }
  return false;
}

export function parentChoiceAllowed(
  seats: readonly { id: string; parentId: string | null }[],
  seatId: string,
  nextParentId: string | null
): { ok: true } | { ok: false; reason: string } {
  if (nextParentId && !seats.some((seat) => seat.id === nextParentId)) {
    return { ok: false, reason: "Choose a seat that is already on the chart." };
  }
  if (wouldCreateCycle(seats, seatId, nextParentId)) {
    return { ok: false, reason: "That seat cannot report to itself or to a seat under it." };
  }
  return { ok: true };
}

export function descendantIds(seats: readonly { id: string; parentId: string | null }[], rootId: string): string[] {
  const children = new Map<string, string[]>();
  for (const seat of seats) {
    if (!seat.parentId) continue;
    const list = children.get(seat.parentId) ?? [];
    list.push(seat.id);
    children.set(seat.parentId, list);
  }
  const found: string[] = [];
  const stack = [...(children.get(rootId) ?? [])];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    found.push(id);
    stack.push(...(children.get(id) ?? []));
  }
  return found;
}

export function validateSeatDraft(input: {
  title: string;
  functionLabel: string;
  personId: string | null;
  accountabilities: string[];
  eligiblePersonIds: readonly string[];
  freeTextPerson?: string | null;
}): { ok: true; title: string; functionLabel: string; personId: string | null; accountabilities: string[] } | { ok: false; reason: string } {
  if (input.freeTextPerson && input.freeTextPerson.trim()) {
    return { ok: false, reason: "Choose a person from the list or leave the seat vacant." };
  }
  const title = input.title.trim().slice(0, SHORT_MAX);
  const functionLabel = input.functionLabel.trim().slice(0, SHORT_MAX);
  if (!title || !functionLabel) return { ok: false, reason: "Enter a seat title and a function label." };
  if (!Array.isArray(input.accountabilities) || input.accountabilities.some((item) => typeof item !== "string")) {
    return { ok: false, reason: "Enter one to five accountabilities." };
  }
  const accountabilities = input.accountabilities.map((item) => item.trim().slice(0, SHORT_MAX)).filter(Boolean);
  if (accountabilities.length < 1 || accountabilities.length > 5) {
    return { ok: false, reason: "Enter one to five accountabilities." };
  }
  const personId = input.personId?.trim() || null;
  if (personId && !input.eligiblePersonIds.includes(personId)) {
    return { ok: false, reason: "Choose a person from the list or leave the seat vacant." };
  }
  if (personId && isFictionalOwnerName(personId)) {
    return { ok: false, reason: "Choose a person from the list or leave the seat vacant." };
  }
  return { ok: true, title, functionLabel, personId, accountabilities };
}

export function eligiblePeople(
  members: readonly { id: string; name: string }[]
): { id: string; name: string }[] {
  return eligibleOwners(members);
}

export function archiveSeat(input: {
  seats: SeatNode[];
  seatId: string;
  at: string;
  subordinateChoice: ArchiveSubordinateChoice | null;
  referenceChoice: ArchiveReferenceChoice | null;
  references: SeatReference[];
}): { ok: true; seats: SeatNode[]; references: SeatReference[] } | { ok: false; reason: string } {
  const seat = input.seats.find((item) => item.id === input.seatId && !item.archivedAt);
  if (!seat) return { ok: false, reason: "That seat is not on the chart." };
  const children = input.seats.filter((item) => item.parentId === input.seatId && !item.archivedAt);
  const refs = input.references.filter((item) => item.seatId === input.seatId);
  if (children.length > 0 && !input.subordinateChoice) {
    return { ok: false, reason: "Choose what happens to the seats below this one." };
  }
  if (refs.length > 0 && !input.referenceChoice) {
    return { ok: false, reason: "Choose what happens to records that reference this seat." };
  }
  let next = input.seats.map((item) => ({ ...item, accountabilities: [...item.accountabilities] }));
  if (input.subordinateChoice === "move_to_parent") {
    next = next.map((item) =>
      item.parentId === input.seatId && !item.archivedAt ? { ...item, parentId: seat.parentId } : item
    );
  } else if (input.subordinateChoice === "archive_with_seat") {
    const drop = new Set([input.seatId, ...descendantIds(next, input.seatId)]);
    next = next.map((item) => (drop.has(item.id) && !item.archivedAt ? { ...item, archivedAt: input.at } : item));
  }
  next = next.map((item) => (item.id === input.seatId ? { ...item, archivedAt: input.at } : item));
  let references = input.references.map((item) => ({ ...item }));
  if (input.referenceChoice === "detach") {
    references = references.map((item) => (item.seatId === input.seatId ? { ...item, seatId: null } : item));
  }
  return { ok: true, seats: next, references };
}

export function activeSeats(seats: readonly SeatNode[]): SeatNode[] {
  return seats.filter((seat) => !seat.archivedAt);
}
