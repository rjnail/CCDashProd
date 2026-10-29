import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  linkedTodoDraft,
  nextUnresolved,
  normalizeSelection,
  requireResolution,
  suggestOrder,
  versionsMatch,
  withIssueNote,
} from "./ids";
import { isFictionalOwnerName } from "./owners";
import { SAVE_NOT_STORED, isMissingPulseTable } from "./pulse-db";
import { givingWriteAllowed } from "./scorecard";
import type { OsTeam } from "./types";

export const IDS_NOT_STORED =
  "Voting, long-term issues, and resolutions are not stored until supabase/migrations/20261029194500_pulse_ids.sql is applied to a named development database. Your text is still here.";

export const CONFLICT = "Someone else updated this issue. Your text is still here.";

const ADMIN_MISSING =
  "This edit was not stored. The server admin key is not configured. Your text is still here.";

type SaveResult = { ok: true; nextIssueId?: string | null } | { ok: false; error: string };

type ItemRecord = {
  id: string;
  details: Record<string, unknown>;
  issue_status: string | null;
  updated_at: string | null;
  version: number;
};

function adminClient(): SupabaseClient | null {
  try {
    return createAdminClient();
  } catch {
    return null;
  }
}

function asObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    return { owner: value };
  }
  return { owner: value };
}

function versionOf(details: Record<string, unknown>): number {
  return typeof details.version === "number" ? details.version : 1;
}

async function loadItem(
  admin: SupabaseClient,
  id: string,
  team: OsTeam
): Promise<ItemRecord | "missing" | "absent"> {
  const { data, error } = await admin
    .from("pulse_items")
    .select("id, details, issue_status, updated_at")
    .eq("id", id)
    .eq("team", team)
    .is("removed_at", null)
    .maybeSingle();
  if (isMissingPulseTable(error)) return "missing";
  if (error) throw new Error(error.message);
  if (!data) return "absent";
  const details = asObject(data.details);
  return {
    id: data.id,
    details,
    issue_status: data.issue_status,
    updated_at: data.updated_at,
    version: versionOf(details),
  };
}

async function saveItem(
  admin: SupabaseClient,
  team: OsTeam,
  row: ItemRecord,
  expectedVersion: number,
  patch: {
    details?: Record<string, unknown>;
    issue_status?: string | null;
    decision?: string;
    owner_id?: string | null;
    title?: string;
    due_on?: string | null;
    metric_key?: string | null;
    priority?: number | null;
  }
): Promise<SaveResult> {
  if (!versionsMatch(row.version, expectedVersion)) return { ok: false, error: CONFLICT };
  const details = JSON.stringify({ ...row.details, ...patch.details, version: expectedVersion + 1 });
  const payload: Record<string, unknown> = { details, updated_at: new Date().toISOString() };
  if (patch.issue_status !== undefined) payload.issue_status = patch.issue_status;
  if (patch.decision !== undefined) payload.decision = patch.decision;
  if (patch.owner_id !== undefined) payload.owner_id = patch.owner_id;
  if (patch.title !== undefined) payload.title = patch.title;
  if (patch.due_on !== undefined) payload.due_on = patch.due_on;
  if (patch.metric_key !== undefined) payload.metric_key = patch.metric_key;
  if (patch.priority !== undefined) payload.priority = patch.priority;
  let query = admin.from("pulse_items").update(payload).eq("id", row.id).eq("team", team);
  if (row.updated_at) query = query.eq("updated_at", row.updated_at);
  const { data, error } = await query.select("id");
  if (isMissingPulseTable(error)) return { ok: false, error: SAVE_NOT_STORED };
  if (error?.code === "23514") return { ok: false, error: IDS_NOT_STORED };
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: CONFLICT };
  return { ok: true };
}

async function openIssues(admin: SupabaseClient, team: OsTeam) {
  const { data, error } = await admin
    .from("pulse_items")
    .select("id, title, details, issue_status, created_at")
    .eq("team", team)
    .eq("kind", "issue")
    .is("removed_at", null);
  if (isMissingPulseTable(error)) return { missing: true as const, rows: [] };
  if (error) throw new Error(error.message);
  return {
    missing: false as const,
    rows: (data ?? []).map((row) => {
      const details = asObject(row.details);
      return {
        id: row.id as string,
        title: row.title as string,
        status: (row.issue_status as string | null) ?? "open",
        sortOrder: typeof details.sortOrder === "number" ? details.sortOrder : 0,
        topRank: details.topRank === 1 || details.topRank === 2 || details.topRank === 3 ? details.topRank : null,
        createdAt: (row.created_at as string | null) ?? "",
        version: versionOf(details),
        details,
        updatedAt: null as string | null,
      };
    }),
  };
}

async function namedOwner(
  admin: SupabaseClient,
  team: OsTeam,
  ownerUserId: string
): Promise<{ ok: true; id: string; name: string } | { ok: false; error: string }> {
  const id = ownerUserId.trim();
  if (!id) return { ok: true, id: "", name: "" };
  const { data: member, error: memberError } = await admin
    .from("pulse_team_members")
    .select("user_id")
    .eq("team", team)
    .eq("user_id", id)
    .limit(1);
  if (isMissingPulseTable(memberError)) return { ok: false, error: SAVE_NOT_STORED };
  if (!member?.length) return { ok: false, error: "Choose an owner from this meeting." };
  const profile = await admin.from("user_profiles").select("display_name").eq("id", id).maybeSingle();
  const name = profile.data?.display_name?.trim() || "Team member";
  if (isFictionalOwnerName(name)) return { ok: false, error: "Choose an owner from this meeting." };
  return { ok: true, id, name };
}

export async function insertIssue(input: {
  team: OsTeam;
  title: string;
  userId: string;
  metricKey?: string | null;
  canReadGiving?: boolean;
  ownerUserId?: string | null;
}): Promise<SaveResult> {
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Enter a title before saving." };
  const gate = givingWriteAllowed({
    team: input.team,
    canReadGiving: input.canReadGiving === true,
    metricKey: input.metricKey,
    campus: "church-wide",
  });
  if (!gate.allowed) return { ok: false, error: gate.reason };
  const admin = adminClient();
  if (!admin) return { ok: false, error: ADMIN_MISSING };
  const existing = await openIssues(admin, input.team);
  if (existing.missing) return { ok: false, error: SAVE_NOT_STORED };
  const owner = await namedOwner(admin, input.team, input.ownerUserId ?? "");
  if (!owner.ok) return owner;
  const sortOrder = existing.rows.reduce((max, row) => Math.max(max, row.sortOrder), 0) + 1;
  const { error } = await admin.from("pulse_items").insert({
    team: input.team,
    kind: "issue",
    title: title.slice(0, 180),
    details: JSON.stringify({
      owner: owner.name,
      ownerUserId: owner.id || null,
      rootIssue: "",
      neededDecision: "",
      notes: "",
      comments: [],
      version: 1,
      sortOrder,
      topRank: null,
      sourceIssueId: null,
    }),
    issue_status: "open",
    decision: "",
    metric_key: input.metricKey ?? null,
    campus: "church-wide",
    created_by: input.userId,
    owner_id: owner.id || null,
  });
  if (isMissingPulseTable(error)) return { ok: false, error: SAVE_NOT_STORED };
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function appendIssueNote(input: {
  team: OsTeam;
  id: string;
  version: number;
  text: string;
  userId: string;
}): Promise<SaveResult> {
  const text = input.text.trim();
  if (!text) return { ok: false, error: "Enter a note." };
  const admin = adminClient();
  if (!admin) return { ok: false, error: ADMIN_MISSING };
  const row = await loadItem(admin, input.id, input.team);
  if (row === "missing") return { ok: false, error: SAVE_NOT_STORED };
  if (row === "absent") return { ok: false, error: "That issue is no longer on this meeting." };
  const legacy = typeof row.details.notes === "string" ? row.details.notes : "";
  const next = withIssueNote({
    notes: legacy,
    comments: row.details.comments,
    added: {
      id: crypto.randomUUID(),
      text: text.slice(0, 2000),
      createdAt: new Date().toISOString(),
      authorUserId: input.userId,
    },
  });
  return saveItem(admin, input.team, row, input.version, {
    details: { comments: next.comments, notes: next.notes },
  });
}

export async function saveIssuePriority(input: {
  team: OsTeam;
  id: string;
  version: number;
  priority: number | null;
}): Promise<SaveResult> {
  const priority =
    input.priority == null
      ? null
      : Number.isInteger(input.priority) && input.priority >= 0 && input.priority <= 3
        ? input.priority
        : undefined;
  if (priority === undefined) return { ok: false, error: "Choose a priority from 0 to 3." };
  const admin = adminClient();
  if (!admin) return { ok: false, error: ADMIN_MISSING };
  const row = await loadItem(admin, input.id, input.team);
  if (row === "missing") return { ok: false, error: SAVE_NOT_STORED };
  if (row === "absent") return { ok: false, error: "That issue is no longer on this meeting." };
  return saveItem(admin, input.team, row, input.version, { priority });
}

export async function saveIssueDraft(input: {
  team: OsTeam;
  id: string;
  version: number;
  rootIssue: string;
  neededDecision: string;
  notes: string;
}): Promise<SaveResult> {
  const admin = adminClient();
  if (!admin) return { ok: false, error: ADMIN_MISSING };
  const row = await loadItem(admin, input.id, input.team);
  if (row === "missing") return { ok: false, error: SAVE_NOT_STORED };
  if (row === "absent") return { ok: false, error: "That issue is no longer on this meeting." };
  return saveItem(admin, input.team, row, input.version, {
    details: {
      rootIssue: input.rootIssue.trim().slice(0, 500),
      neededDecision: input.neededDecision.trim().slice(0, 500),
      notes: input.notes.trim().slice(0, 4000),
    },
  });
}

export async function saveIssueOwner(input: {
  team: OsTeam;
  id: string;
  version: number;
  ownerUserId: string;
}): Promise<SaveResult> {
  const admin = adminClient();
  if (!admin) return { ok: false, error: ADMIN_MISSING };
  const row = await loadItem(admin, input.id, input.team);
  if (row === "missing") return { ok: false, error: SAVE_NOT_STORED };
  if (row === "absent") return { ok: false, error: "That issue is no longer on this meeting." };
  const ownerUserId = input.ownerUserId.trim();
  if (!ownerUserId) {
    return saveItem(admin, input.team, row, input.version, {
      owner_id: null,
      details: { owner: "", ownerUserId: null },
    });
  }
  const { data: member, error: memberError } = await admin
    .from("pulse_team_members")
    .select("user_id")
    .eq("team", input.team)
    .eq("user_id", ownerUserId)
    .limit(1);
  if (isMissingPulseTable(memberError)) return { ok: false, error: SAVE_NOT_STORED };
  if (!member?.length) return { ok: false, error: "Choose an owner from this meeting." };
  const profile = await admin.from("user_profiles").select("display_name").eq("id", ownerUserId).maybeSingle();
  const name = profile.data?.display_name?.trim() || "Team member";
  if (isFictionalOwnerName(name)) return { ok: false, error: "Choose an owner from this meeting." };
  return saveItem(admin, input.team, row, input.version, {
    owner_id: ownerUserId,
    details: { owner: name, ownerUserId },
  });
}

export async function saveIssueOrder(input: {
  team: OsTeam;
  ordered: { id: string; version: number }[];
}): Promise<SaveResult> {
  const admin = adminClient();
  if (!admin) return { ok: false, error: ADMIN_MISSING };
  const loaded: ItemRecord[] = [];
  for (const item of input.ordered) {
    const row = await loadItem(admin, item.id, input.team);
    if (row === "missing") return { ok: false, error: SAVE_NOT_STORED };
    if (row === "absent") return { ok: false, error: "That issue is no longer on this meeting." };
    if (!versionsMatch(row.version, item.version)) return { ok: false, error: CONFLICT };
    loaded.push(row);
  }
  for (const [index, row] of loaded.entries()) {
    const saved = await saveItem(admin, input.team, row, row.version, {
      details: { sortOrder: index + 1 },
    });
    if (!saved.ok) return saved;
  }
  return { ok: true };
}

export async function saveTopThree(input: {
  team: OsTeam;
  roundId: string | null;
  ranked: { id: string; version: number }[];
}): Promise<SaveResult> {
  if (input.ranked.length > 3) return { ok: false, error: "Top 3 can include three issues." };
  const ids = input.ranked.map((item) => item.id);
  if (new Set(ids).size !== ids.length) return { ok: false, error: "Choose each Top 3 issue once." };
  const admin = adminClient();
  if (!admin) return { ok: false, error: ADMIN_MISSING };
  const existing = await openIssues(admin, input.team);
  if (existing.missing) return { ok: false, error: SAVE_NOT_STORED };
  const byId = new Map(existing.rows.map((row) => [row.id, row]));
  for (const item of input.ranked) {
    const row = byId.get(item.id);
    if (!row || (row.status !== "open" && row.status !== "discussing")) {
      return { ok: false, error: "Top 3 comes from open issues." };
    }
    if (!versionsMatch(row.version, item.version)) return { ok: false, error: CONFLICT };
  }
  for (const row of existing.rows) {
    const rank = input.ranked.findIndex((item) => item.id === row.id);
    const nextRank = rank >= 0 ? rank + 1 : null;
    if (row.topRank === nextRank) continue;
    const loaded = await loadItem(admin, row.id, input.team);
    if (loaded === "missing") return { ok: false, error: SAVE_NOT_STORED };
    if (loaded === "absent") return { ok: false, error: CONFLICT };
    const saved = await saveItem(admin, input.team, loaded, loaded.version, {
      details: { topRank: nextRank },
    });
    if (!saved.ok) return saved;
  }
  if (input.roundId) {
    const confirmed = input.ranked.map((item, index) => ({ issueId: item.id, rank: index + 1 }));
    const { error } = await admin
      .from("pulse_vote_rounds")
      .update({ confirmed })
      .eq("id", input.roundId)
      .eq("team", input.team)
      .eq("status", "closed");
    if (error && !isMissingPulseTable(error)) return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function moveIssueLongTerm(input: {
  team: OsTeam;
  id: string;
  version: number;
}): Promise<SaveResult> {
  const admin = adminClient();
  if (!admin) return { ok: false, error: ADMIN_MISSING };
  const row = await loadItem(admin, input.id, input.team);
  if (row === "missing") return { ok: false, error: SAVE_NOT_STORED };
  if (row === "absent") return { ok: false, error: "That issue is no longer on this meeting." };
  const saved = await saveItem(admin, input.team, row, input.version, { issue_status: "long_term" });
  if (!saved.ok) return saved;
  const existing = await openIssues(admin, input.team);
  return {
    ok: true,
    nextIssueId: existing.missing
      ? null
      : nextUnresolved(
          existing.rows.map((item) => ({ ...item, status: item.id === input.id ? "long_term" : item.status })),
          input.id
        ),
  };
}

export async function insertLinkedTodo(input: {
  team: OsTeam;
  issueId: string;
  title: string;
  ownerUserId: string;
  dueOn: string;
  userId: string;
}): Promise<SaveResult> {
  const draft = linkedTodoDraft(input);
  if (!draft.ok) return draft;
  const admin = adminClient();
  if (!admin) return { ok: false, error: ADMIN_MISSING };
  const issue = await loadItem(admin, input.issueId, input.team);
  if (issue === "missing") return { ok: false, error: SAVE_NOT_STORED };
  if (issue === "absent") return { ok: false, error: "That issue is no longer on this meeting." };
  const { data: member, error: memberError } = await admin
    .from("pulse_team_members")
    .select("user_id")
    .eq("team", input.team)
    .eq("user_id", draft.ownerUserId)
    .limit(1);
  if (isMissingPulseTable(memberError)) return { ok: false, error: SAVE_NOT_STORED };
  if (!member?.length) return { ok: false, error: "Choose an owner from this meeting." };
  const profile = await admin.from("user_profiles").select("display_name").eq("id", draft.ownerUserId).maybeSingle();
  const name = profile.data?.display_name?.trim() || "Team member";
  if (isFictionalOwnerName(name)) return { ok: false, error: "Choose an owner from this meeting." };
  const { error } = await admin.from("pulse_items").insert({
    team: input.team,
    kind: "todo",
    title: draft.title.slice(0, 180),
    details: JSON.stringify({
      owner: name,
      ownerUserId: draft.ownerUserId,
      sourceIssueId: input.issueId,
      version: 1,
    }),
    due_on: draft.dueOn,
    rock_status: null,
    issue_status: null,
    decision: "",
    campus: "church-wide",
    created_by: input.userId,
    owner_id: draft.ownerUserId,
  });
  if (isMissingPulseTable(error)) return { ok: false, error: SAVE_NOT_STORED };
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function resolveIssue(input: {
  team: OsTeam;
  id: string;
  version: number;
  resolution: string;
  idempotencyKey: string;
  userId: string;
}): Promise<SaveResult> {
  const resolution = requireResolution(input.resolution);
  if (!resolution.ok) return resolution;
  const key = input.idempotencyKey.trim();
  if (!/^[A-Za-z0-9-]{8,80}$/.test(key)) return { ok: false, error: "The save could not be identified. Try again." };
  const admin = adminClient();
  if (!admin) return { ok: false, error: ADMIN_MISSING };
  const row = await loadItem(admin, input.id, input.team);
  if (row === "missing") return { ok: false, error: SAVE_NOT_STORED };
  if (row === "absent") return { ok: false, error: "That issue is no longer on this meeting." };

  const linked = await admin
    .from("pulse_items")
    .select("id, details")
    .eq("team", input.team)
    .eq("kind", "todo")
    .is("removed_at", null);
  if (isMissingPulseTable(linked.error)) return { ok: false, error: SAVE_NOT_STORED };
  const linkedIds = ((linked.data ?? []) as { id: string; details: string | null }[])
    .filter((item) => asObject(item.details).sourceIssueId === input.id)
    .map((item) => item.id);

  const prior = await admin
    .from("pulse_issue_resolutions")
    .select("issue_id")
    .eq("idempotency_key", key)
    .maybeSingle();
  if (isMissingPulseTable(prior.error)) return { ok: false, error: IDS_NOT_STORED };
  if (prior.error) return { ok: false, error: prior.error.message };
  if (prior.data && prior.data.issue_id !== input.id) {
    return { ok: false, error: "That save key was already used." };
  }
  if (!prior.data && !versionsMatch(row.version, input.version)) {
    return { ok: false, error: CONFLICT };
  }
  if (!prior.data) {
    const inserted = await admin.from("pulse_issue_resolutions").insert({
      issue_id: input.id,
      team: input.team,
      idempotency_key: key,
      resolution: resolution.resolution.slice(0, 4000),
      actor_id: input.userId,
      linked_action_ids: linkedIds,
    });
    if (isMissingPulseTable(inserted.error)) return { ok: false, error: IDS_NOT_STORED };
    if (inserted.error && inserted.error.code !== "23505") return { ok: false, error: inserted.error.message };
  } else if (row.issue_status === "solved") {
    const existing = await openIssues(admin, input.team);
    return { ok: true, nextIssueId: existing.missing ? null : nextUnresolved(existing.rows, input.id) };
  }

  if (row.issue_status !== "solved") {
    const saved = await saveItem(admin, input.team, row, row.version, {
      issue_status: "solved",
      decision: resolution.resolution.slice(0, 4000),
    });
    if (!saved.ok) return saved;
  }
  const existing = await openIssues(admin, input.team);
  return {
    ok: true,
    nextIssueId: existing.missing
      ? null
      : nextUnresolved(
          existing.rows.map((item) => ({ ...item, status: item.id === input.id ? "solved" : item.status })),
          input.id
        ),
  };
}

export async function openVoteRound(input: { team: OsTeam; userId: string }): Promise<SaveResult> {
  const admin = adminClient();
  if (!admin) return { ok: false, error: ADMIN_MISSING };
  const existing = await admin
    .from("pulse_vote_rounds")
    .select("id")
    .eq("team", input.team)
    .eq("status", "open")
    .limit(1);
  if (isMissingPulseTable(existing.error)) return { ok: false, error: IDS_NOT_STORED };
  if (existing.error) return { ok: false, error: existing.error.message };
  if (existing.data?.length) return { ok: false, error: "A voting round is already open." };
  const { error } = await admin.from("pulse_vote_rounds").insert({
    team: input.team,
    status: "open",
    opened_by: input.userId,
    totals: null,
    suggested: null,
    confirmed: null,
  });
  if (isMissingPulseTable(error)) return { ok: false, error: IDS_NOT_STORED };
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function closeVoteRound(input: {
  team: OsTeam;
  roundId: string;
  userId: string;
}): Promise<SaveResult> {
  const admin = adminClient();
  if (!admin) return { ok: false, error: ADMIN_MISSING };
  const round = await admin
    .from("pulse_vote_rounds")
    .select("id, status")
    .eq("id", input.roundId)
    .eq("team", input.team)
    .maybeSingle();
  if (isMissingPulseTable(round.error)) return { ok: false, error: IDS_NOT_STORED };
  if (!round.data || round.data.status !== "open") return { ok: false, error: "That voting round is already closed." };
  const ballots = await admin.from("pulse_votes").select("voter_id, issue_id").eq("round_id", input.roundId);
  if (ballots.error) return { ok: false, error: ballots.error.message };
  const issues = await openIssues(admin, input.team);
  if (issues.missing) return { ok: false, error: SAVE_NOT_STORED };
  const openIds = new Set(
    issues.rows.filter((row) => row.status === "open" || row.status === "discussing").map((row) => row.id)
  );
  const totalsMap = new Map<string, number>();
  const seen = new Set<string>();
  for (const ballot of (ballots.data ?? []) as { voter_id: string; issue_id: string }[]) {
    if (!openIds.has(ballot.issue_id)) continue;
    const key = `${ballot.voter_id}:${ballot.issue_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    totalsMap.set(ballot.issue_id, (totalsMap.get(ballot.issue_id) ?? 0) + 1);
  }
  const totals = [...totalsMap.entries()].map(([issueId, votes]) => ({ issueId, votes }));
  const suggestion = suggestOrder(
    issues.rows
      .filter((row) => openIds.has(row.id))
      .map((row) => ({ id: row.id, sortOrder: row.sortOrder, createdAt: row.createdAt })),
    totals
  );
  const { data, error } = await admin
    .from("pulse_vote_rounds")
    .update({
      status: "closed",
      closed_by: input.userId,
      closed_at: new Date().toISOString(),
      totals,
      suggested: suggestion,
    })
    .eq("id", input.roundId)
    .eq("team", input.team)
    .eq("status", "open")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: true };
  return { ok: true };
}

export async function replaceMyVotes(input: {
  team: OsTeam;
  roundId: string;
  issueIds: string[];
  userId: string;
}): Promise<SaveResult> {
  const admin = adminClient();
  if (!admin) return { ok: false, error: ADMIN_MISSING };
  const round = await admin
    .from("pulse_vote_rounds")
    .select("id, status")
    .eq("id", input.roundId)
    .eq("team", input.team)
    .maybeSingle();
  if (isMissingPulseTable(round.error)) return { ok: false, error: IDS_NOT_STORED };
  if (!round.data || round.data.status !== "open") {
    return { ok: false, error: "Voting is closed. Your selection was not saved." };
  }
  const issues = await openIssues(admin, input.team);
  if (issues.missing) return { ok: false, error: SAVE_NOT_STORED };
  const openIds = issues.rows
    .filter((row) => row.status === "open" || row.status === "discussing")
    .map((row) => row.id);
  const selected = normalizeSelection(input.issueIds, openIds);
  if (!selected.ok) return selected;
  const removed = await admin.from("pulse_votes").delete().eq("round_id", input.roundId).eq("voter_id", input.userId);
  if (isMissingPulseTable(removed.error)) return { ok: false, error: IDS_NOT_STORED };
  if (removed.error) return { ok: false, error: removed.error.message };
  if (selected.selected.length === 0) return { ok: true };
  const inserted = await admin.from("pulse_votes").insert(
    selected.selected.map((issueId) => ({
      round_id: input.roundId,
      voter_id: input.userId,
      issue_id: issueId,
    }))
  );
  if (inserted.error) return { ok: false, error: inserted.error.message };
  return { ok: true };
}

export async function dismissInsight(input: {
  userId: string;
  insightId: string;
  surface: "dashboard" | "pulse";
  team: string;
}): Promise<SaveResult> {
  const admin = adminClient();
  if (!admin) return { ok: false, error: ADMIN_MISSING };
  const { error } = await admin.from("pulse_insight_dismissals").insert({
    user_id: input.userId,
    insight_id: input.insightId.slice(0, 160),
    surface: input.surface,
    team: input.team,
    reason: "Dismissed from insights",
  });
  if (isMissingPulseTable(error)) return { ok: false, error: IDS_NOT_STORED };
  if (error?.code === "23505") return { ok: true };
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
