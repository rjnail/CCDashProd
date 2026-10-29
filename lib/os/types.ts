export const OS_TEAMS = ["executive", "pastoral", "leadership"] as const;

export type OsTeam = (typeof OS_TEAMS)[number];

export const OS_TEAM_LABELS: Record<OsTeam, string> = {
  executive: "Executive Team",
  pastoral: "Pastoral Team",
  leadership: "Leadership Team",
};

export const OS_MEETING_LABELS: Record<OsTeam, string> = {
  executive: "Executive Meeting",
  pastoral: "Pastoral Meeting",
  leadership: "Leadership Meeting",
};

export type OsRockStatus = "on_track" | "off_track" | "complete";
export type OsIssueStatus = "open" | "discussing" | "long_term" | "solved";

export type OsWorkItem = {
  id: string;
  kind: "rock" | "todo" | "issue";
  title: string;
  owner: string;
  ownerUserId: string | null;
  dueOn: string | null;
  rockStatus: OsRockStatus | null;
  priority: number | null;
  issueStatus: OsIssueStatus | null;
  decision: string;
  metricKey: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  version: number;
  sortOrder: number;
  topRank: number | null;
  rootIssue: string;
  neededDecision: string;
  notes: string;
  sourceIssueId: string | null;
  comments?: { id: string; text: string; createdAt: string; authorUserId: string | null }[];
};

export type OsMember = {
  id: string;
  name: string;
  facilitator: boolean;
};

export type OsVoteView = {
  roundId: string | null;
  status: "none" | "open" | "closed";
  myIssueIds: string[];
  remaining: number;
  totals: { issueId: string; votes: number }[] | null;
  suggestedOrder: string[] | null;
  tieIssueIds: string[];
};

export type OsVoteHistoryEntry = {
  roundId: string;
  closedAt: string;
  totals: { issueId: string; votes: number }[];
  confirmed: { issueId: string; rank: number }[];
};

export type ScorecardUnit = "people" | "currency" | "count" | "percent" | "other";
export type ScorecardComparison = "higher" | "lower" | "range";
export type ScorecardStatusMode = "automatic" | "manual";
export type ScorecardManualStatus = "on_track" | "needs_attention" | "off_track";

export type OsScorecardTarget = {
  value: number;
  unit: ScorecardUnit;
  setBy: string;
  setAt: string;
};

export type OsManualReading = {
  id: string;
  metricKey: string;
  team: OsTeam;
  campus: string;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  value: number;
  unit: ScorecardUnit;
  actorId: string;
  actorName: string;
  createdAt: string;
  correctsId: string | null;
};

export type OsSharedTarget = {
  metricKey: string;
  campus: string;
  periodKey: string;
  value: number;
  setAt: string;
  conflict: boolean;
};

export type OsManualDefinition = {
  metricKey: string;
  label: string;
  definition: string;
  unit: ScorecardUnit;
  frequency: string;
  campus: string;
  comparison: ScorecardComparison;
  rangeMin: number | null;
  rangeMax: number | null;
  attentionMin: number | null;
  attentionMax: number | null;
  explicitMax: number | null;
  published: boolean;
  homeTeam: OsTeam;
};

export type OsScorecardNote = {
  id: string;
  team: OsTeam;
  metricKey: string;
  label: string;
  owner: string;
  ownerUserId: string | null;
  target: string;
  manualValue: string;
  allowValue: boolean;
  version: number;
  sortOrder: number;
  campus: string;
  periodKind: string;
  statusMode: ScorecardStatusMode;
  manualStatus: ScorecardManualStatus | null;
  overrideReason: string;
  statusSetBy: string;
  statusSetByName: string;
  statusSetAt: string | null;
  statusPeriodKey: string;
  targets: Record<string, OsScorecardTarget>;
  definition: string;
  unit: ScorecardUnit;
  frequency: string;
  comparison: ScorecardComparison;
  rangeMin: number | null;
  rangeMax: number | null;
  attentionMin: number | null;
  attentionMax: number | null;
  explicitMax: number | null;
  published: boolean;
  updatedAt: string | null;
};

export type OsQuality =
  | "available"
  | "missing"
  | "stale"
  | "error"
  | "unavailable"
  | "restricted"
  | "manual";

export type OsCampus = "church-wide" | "mount-pleasant" | "alma" | "st-johns";

export type OsMeasure = {
  key: string;
  label: string;
  definition: string;
  unit: ScorecardUnit;
  periodLabel: string;
  periodKind: string;
  campusLabel: string;
  value: number | null;
  sourceLabel: string;
  reportHref: string | null;
  refreshedAt: string | null;
  quality: OsQuality;
  qualityDetail: string;
  history: { label: string; value: number | null }[];
  staffing: {
    current: number;
    need: number;
    gap: number;
    campuses: { label: string; current: number; need: number; gap: number }[];
  } | null;
};

export type AttendanceMonth = {
  periodStart: string;
  value: number;
};

export type OsInsight = {
  id: string;
  category: "trend" | "warning" | "opportunity" | "data-quality";
  severity: "info" | "watch" | "high";
  title: string;
  summary: string;
  evidence: string;
  limitation: string;
  metricKey: string;
  asOf: string;
  campusLabel: string;
  periodLabel: string;
  reportHref: string | null;
  refreshedAt: string | null;
  followUp: string;
  lifecycle: "current" | "stale";
};

export type OsAskContext = {
  surface: "dashboard" | "pulse";
  surfaceLabel: string;
  teamLabel: string | null;
  teamKey: string | null;
  campusLabel: string;
  campusSlug: string | null;
  periodLabel: string;
  latestSourceUpdate: string | null;
  modelConfigured: boolean;
  modelMissing: string | null;
};

export type OsAnswer = {
  question: string;
  status: "answered" | "unavailable" | "restricted";
  findings: string;
  figures: string[];
  limitation: string;
  citations: { label: string; href: string | null }[];
};

export type OsMeetingArchive = {
  id: string;
  sessionId: string;
  finishedAt: string;
  rating: number;
  campus: OsCampus;
  campusLabel: string;
  notes: string;
  headlines: string;
  decision: string;
  elapsedLabel: string;
  overTime: boolean;
  openRocks: string[];
  openTodos: string[];
  openIssues: string[];
  measures: { key: string; label: string; value: number | null; periodLabel: string; campusLabel: string }[];
};

export type OsPageData = {
  team: OsTeam;
  campus: OsCampus;
  campusLabel: string;
  measures: OsMeasure[];
  focusKeys: string[];
  attendanceMonths: AttendanceMonth[];
  insights: OsInsight[];
  meetingInsights: OsInsight[];
  modelConfigured: boolean;
  modelMissing: string | null;
  persistence: "preview";
  viewerId: string;
  viewerName: string;
  canOpenUsers: boolean;
  reportLinks: { href: string; label: string }[];
  teams: OsTeam[];
  storageReady: boolean;
  canEdit: boolean;
  canFacilitate: boolean;
  canParticipate: boolean;
  canEditSharedTarget: boolean;
  canPublishManual: boolean;
  denied: boolean;
  items: OsWorkItem[];
  notes: OsScorecardNote[];
  catalogMeasures: OsMeasure[];
  manualReadings: OsManualReading[];
  sharedTargets: OsSharedTarget[];
  manualDefinitions: OsManualDefinition[];
  scorecardConfigured: boolean;
  scorecardAuditReady: boolean;
  members: OsMember[];
  vote: OsVoteView;
  voteHistory: OsVoteHistoryEntry[];
  archives: OsMeetingArchive[];
  periodLabel: string;
  latestSourceUpdate: string | null;
};
