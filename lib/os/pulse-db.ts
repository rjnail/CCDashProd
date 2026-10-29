import type { SupabaseClient } from "@supabase/supabase-js";
import { remainingVotes, storedIssueComments } from "./ids";
import { SCORECARD_READY_KEY, parseReading, parseScorecardNote } from "./scorecard";
import {
  OS_TEAMS,
  type OsIssueStatus,
  type OsManualReading,
  type OsMember,
  type OsRockStatus,
  type OsScorecardNote,
  type OsTeam,
  type OsVoteHistoryEntry,
  type OsVoteView,
  type OsWorkItem,
} from "./types";

export const MEETINGS_NOT_STORED =
  "Meeting memberships are not stored until the Pulse migration is applied to a named development database.";

export const SAVE_NOT_STORED =
  "This edit was not stored. The Pulse tables are not on this database yet. What you typed is still here.";

const ACCESS_CAPABILITIES = ["viewer", "contributor", "facilitator"];
const ROCK_STATUSES: OsRockStatus[] = ["on_track", "off_track", "complete"];
const ISSUE_STATUSES: OsIssueStatus[] = ["open", "discussing", "long_term", "solved"];

type MemberRow = { user_id?: string; team: string; capability: string };

type ItemRow = {
  id: string;
  kind: string;
  title: string;
  details: string | null;
  due_on: string | null;
  rock_status: string | null;
  priority: number | null;
  issue_status: string | null;
  decision: string | null;
  metric_key: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  owner_id?: string | null;
  campus?: string | null;
  period_label?: string | null;
};

export const EMPTY_VOTE: OsVoteView = {
  roundId: null,
  status: "none",
  myIssueIds: [],
  remaining: 3,
  totals: null,
  suggestedOrder: null,
  tieIssueIds: [],
};

export function isMissingPulseTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("could not find the table")
  );
}

export function parseMeetingList(value: unknown): { ok: true; teams: OsTeam[] } | { ok: false } {
  if (!Array.isArray(value)) return { ok: false };
  const teams: OsTeam[] = [];
  for (const item of value) {
    if (!OS_TEAMS.includes(item as OsTeam)) return { ok: false };
    if (!teams.includes(item as OsTeam)) teams.push(item as OsTeam);
  }
  return { ok: true, teams };
}

function teamsFromRows(rows: MemberRow[]): OsTeam[] {
  return OS_TEAMS.filter((team) =>
    rows.some((row) => row.team === team && ACCESS_CAPABILITIES.includes(row.capability))
  );
}

export async function readOwnMeetings(
  supabase: SupabaseClient,
  userId: string
): Promise<{ missing: true; teams: OsTeam[] } | { missing: false; teams: OsTeam[] }> {
  const { data, error } = await supabase
    .from("pulse_team_members")
    .select("team, capability")
    .eq("user_id", userId);

  if (isMissingPulseTable(error)) return { missing: true, teams: [] };
  if (error) throw new Error(error.message);
  return { missing: false, teams: teamsFromRows((data ?? []) as MemberRow[]) };
}

export async function readTeamRecords(
  supabase: SupabaseClient,
  team: OsTeam
): Promise<{
  missing: boolean;
  items: OsWorkItem[];
  notes: OsScorecardNote[];
  readings: OsManualReading[];
  configured: boolean;
}> {
  const { data, error } = await supabase
    .from("pulse_items")
    .select(
      "id, kind, title, details, due_on, rock_status, priority, issue_status, decision, metric_key, created_at, updated_at, owner_id, campus, period_label"
    )
    .eq("team", team)
    .is("removed_at", null)
    .order("created_at", { ascending: true });

  if (isMissingPulseTable(error)) return { missing: true, items: [], notes: [], readings: [], configured: false };
  if (error) throw new Error(error.message);

  const items: OsWorkItem[] = [];
  const notes: OsScorecardNote[] = [];
  const readings: OsManualReading[] = [];
  let configured = false;
  for (const row of (data ?? []) as ItemRow[]) {
    if (row.kind === "rock" || row.kind === "todo" || row.kind === "issue") {
      items.push(toWorkItem(row));
    } else if (row.kind === "headline") {
      if (row.metric_key === SCORECARD_READY_KEY) configured = true;
      const note = parseScorecardNote(team, {
        id: row.id,
        metricKey: row.metric_key,
        title: row.title,
        details: row.details,
        campus: row.campus,
        periodLabel: row.period_label,
        ownerId: row.owner_id,
        updatedAt: row.updated_at,
      });
      if (note) notes.push(note);
      const reading = parseReading(team, {
        id: row.id,
        metricKey: row.metric_key,
        details: row.details,
        campus: row.campus,
        periodLabel: row.period_label,
      });
      if (reading) readings.push(reading);
    }
  }
  return { missing: false, items, notes, readings, configured };
}

function detailObject(details: string | null): Record<string, unknown> {
  if (!details) return {};
  try {
    const parsed = JSON.parse(details) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return { owner: details };
  }
  return { owner: details };
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toWorkItem(row: ItemRow): OsWorkItem {
  const details = detailObject(row.details);
  const rockStatus = ROCK_STATUSES.includes(row.rock_status as OsRockStatus)
    ? (row.rock_status as OsRockStatus)
    : null;
  const issueStatus = ISSUE_STATUSES.includes(row.issue_status as OsIssueStatus)
    ? (row.issue_status as OsIssueStatus)
    : null;
  const topRank = details.topRank;
  const sortOrder = details.sortOrder;
  return {
    id: row.id,
    kind: row.kind as OsWorkItem["kind"],
    title: row.title,
    owner: text(details.owner),
    ownerUserId: row.owner_id ?? (typeof details.ownerUserId === "string" ? details.ownerUserId : null),
    dueOn: row.due_on,
    rockStatus,
    priority: typeof row.priority === "number" ? row.priority : null,
    issueStatus,
    decision: row.decision ?? "",
    metricKey: row.metric_key,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    version: typeof details.version === "number" ? details.version : 1,
    sortOrder: typeof sortOrder === "number" ? sortOrder : 0,
    topRank: topRank === 1 || topRank === 2 || topRank === 3 ? topRank : null,
    rootIssue: text(details.rootIssue),
    neededDecision: text(details.neededDecision),
    notes: text(details.notes),
    sourceIssueId: typeof details.sourceIssueId === "string" ? details.sourceIssueId : null,
    comments: storedIssueComments(details.comments),
  };
}

export async function readTeamRoster(
  supabase: SupabaseClient,
  team: OsTeam
): Promise<OsMember[]> {
  const { data, error } = await supabase.rpc("pulse_team_roster", { p_team: team });
  if (isMissingPulseTable(error) || isMissingFunction(error)) return [];
  if (error) return [];
  const members: OsMember[] = [];
  for (const row of (data ?? []) as { user_id?: string; display_name?: string | null; capability?: string }[]) {
    if (!row.user_id || members.some((member) => member.id === row.user_id)) continue;
    members.push({
      id: row.user_id,
      name: row.display_name?.trim() || "Team member",
      facilitator: row.capability === "facilitator",
    });
  }
  return members;
}

export async function readDismissedInsights(
  supabase: SupabaseClient,
  surface: "dashboard" | "pulse",
  team: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from("pulse_insight_dismissals")
    .select("insight_id")
    .eq("surface", surface)
    .eq("team", team);
  if (isMissingPulseTable(error)) return [];
  if (error) return [];
  return ((data ?? []) as { insight_id?: string }[])
    .map((row) => row.insight_id)
    .filter((id): id is string => Boolean(id));
}

type RoundRow = {
  id: string;
  status: string;
  closed_at: string | null;
  totals: unknown;
  suggested: unknown;
  confirmed: unknown;
};

export async function readVoteBoard(
  supabase: SupabaseClient,
  team: OsTeam,
  userId: string
): Promise<{ missing: boolean; vote: OsVoteView; history: OsVoteHistoryEntry[] }> {
  const { data, error } = await supabase
    .from("pulse_vote_rounds")
    .select("id, status, closed_at, totals, suggested, confirmed")
    .eq("team", team)
    .order("opened_at", { ascending: false });
  if (isMissingPulseTable(error)) return { missing: true, vote: EMPTY_VOTE, history: [] };
  if (error) return { missing: false, vote: EMPTY_VOTE, history: [] };

  const rounds = (data ?? []) as RoundRow[];
  const history = rounds
    .filter((round) => round.status === "closed")
    .map((round) => ({
      roundId: round.id,
      closedAt: round.closed_at ?? "",
      totals: voteCounts(round.totals),
      confirmed: confirmedRanks(round.confirmed),
    }));
  const open = rounds.find((round) => round.status === "open");
  const current = open ?? rounds.find((round) => round.status === "closed") ?? null;
  if (!current) return { missing: false, vote: EMPTY_VOTE, history };

  const mine = await supabase
    .from("pulse_votes")
    .select("issue_id")
    .eq("round_id", current.id)
    .eq("voter_id", userId);
  const myIssueIds = ((mine.data ?? []) as { issue_id?: string }[])
    .map((row) => row.issue_id)
    .filter((id): id is string => Boolean(id));

  if (current.status !== "closed") {
    return {
      missing: false,
      vote: {
        roundId: current.id,
        status: "open",
        myIssueIds,
        remaining: remainingVotes(myIssueIds),
        totals: null,
        suggestedOrder: null,
        tieIssueIds: [],
      },
      history,
    };
  }

  const suggested = suggestedOrder(current.suggested);
  return {
    missing: false,
    vote: {
      roundId: current.id,
      status: "closed",
      myIssueIds,
      remaining: 0,
      totals: voteCounts(current.totals),
      suggestedOrder: suggested.order,
      tieIssueIds: suggested.tieIssueIds,
    },
    history,
  };
}

function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  return error.code === "42883" || message.includes("could not find the function") || message.includes("pulse_team_roster");
}

function voteCounts(value: unknown): { issueId: string; votes: number }[] {
  if (!Array.isArray(value)) return [];
  const totals: { issueId: string; votes: number }[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const issueId = "issueId" in row && typeof row.issueId === "string" ? row.issueId : "";
    const votes = "votes" in row && typeof row.votes === "number" ? row.votes : null;
    if (!issueId || votes == null) continue;
    totals.push({ issueId, votes });
  }
  return totals;
}

function confirmedRanks(value: unknown): { issueId: string; rank: number }[] {
  if (!Array.isArray(value)) return [];
  const ranks: { issueId: string; rank: number }[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const issueId = "issueId" in row && typeof row.issueId === "string" ? row.issueId : "";
    const rank = "rank" in row && typeof row.rank === "number" ? row.rank : null;
    if (!issueId || rank == null || rank < 1 || rank > 3) continue;
    ranks.push({ issueId, rank });
  }
  return ranks;
}

function suggestedOrder(value: unknown): { order: string[] | null; tieIssueIds: string[] } {
  if (!value || typeof value !== "object") return { order: null, tieIssueIds: [] };
  const order = "order" in value && Array.isArray(value.order) ? value.order.filter((id) => typeof id === "string") : null;
  const tieIssueIds =
    "tieIssueIds" in value && Array.isArray(value.tieIssueIds)
      ? value.tieIssueIds.filter((id) => typeof id === "string")
      : [];
  return { order, tieIssueIds };
}

export function groupMeetings(rows: MemberRow[]): Map<string, OsTeam[]> {
  const byUser = new Map<string, MemberRow[]>();
  for (const row of rows) {
    if (!row.user_id) continue;
    const list = byUser.get(row.user_id) ?? [];
    list.push(row);
    byUser.set(row.user_id, list);
  }
  return new Map([...byUser.entries()].map(([id, list]) => [id, teamsFromRows(list)]));
}
