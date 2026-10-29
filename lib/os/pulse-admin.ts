import { createAdminClient } from "@/lib/supabase/admin";
import {
  MEETINGS_NOT_STORED,
  SAVE_NOT_STORED,
  groupMeetings,
  isMissingPulseTable,
} from "./pulse-db";
import { givingWriteAllowed } from "./scorecard";
import type { OsIssueStatus, OsRockStatus, OsTeam } from "./types";

type SaveResult = { ok: true } | { ok: false; error: string };
type MeetingLoad = { stored: boolean; warning: string | null; byUser: Map<string, OsTeam[]> };

const ACCESS_CAPABILITIES = ["viewer", "contributor", "facilitator"];

export async function loadPulseMeetings(): Promise<MeetingLoad> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("pulse_team_members")
    .select("user_id, team, capability");

  if (isMissingPulseTable(error)) {
    return { stored: false, warning: MEETINGS_NOT_STORED, byUser: new Map() };
  }
  if (error) throw new Error(error.message);
  return {
    stored: true,
    warning: null,
    byUser: groupMeetings(data ?? []),
  };
}

export async function syncPulseMeetings(userId: string, teams: OsTeam[]): Promise<SaveResult> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("pulse_team_members")
    .select("team, capability")
    .eq("user_id", userId);

  if (isMissingPulseTable(error)) return { ok: false, error: MEETINGS_NOT_STORED };
  if (error) return { ok: false, error: error.message };

  const existing = data ?? [];
  const selected = new Set(teams);
  const remove = [
    ...new Set(
      existing
        .map((row) => row.team)
        .filter((team): team is OsTeam => !selected.has(team as OsTeam))
    ),
  ];

  for (const team of remove) {
    const { error: deleteError } = await admin
      .from("pulse_team_members")
      .delete()
      .eq("user_id", userId)
      .eq("team", team);
    if (isMissingPulseTable(deleteError)) return { ok: false, error: MEETINGS_NOT_STORED };
    if (deleteError) return { ok: false, error: deleteError.message };
  }

  for (const team of teams) {
    const already = existing.some(
      (row) => row.team === team && ACCESS_CAPABILITIES.includes(row.capability)
    );
    if (already) continue;
    const { error: insertError } = await admin.from("pulse_team_members").insert({
      user_id: userId,
      team,
      capability: "viewer",
    });
    if (isMissingPulseTable(insertError)) return { ok: false, error: MEETINGS_NOT_STORED };
    if (insertError) return { ok: false, error: insertError.message };
  }

  return { ok: true };
}

type ItemWrite = {
  id?: string;
  team: OsTeam;
  kind: "rock" | "todo" | "issue" | "headline";
  title: string;
  details: string;
  dueOn: string | null;
  rockStatus: OsRockStatus | null;
  priority: number | null;
  issueStatus: OsIssueStatus | null;
  decision: string;
  metricKey: string | null;
  ownerId?: string | null;
  canReadGiving?: boolean;
  userId: string;
};

export async function writePulseRow(input: ItemWrite): Promise<SaveResult> {
  const gate = givingWriteAllowed({
    team: input.team,
    canReadGiving: input.canReadGiving === true,
    metricKey: input.metricKey,
    campus: "church-wide",
  });
  if (!gate.allowed) return { ok: false, error: gate.reason };
  const admin = createAdminClient();
  const payload = {
    team: input.team,
    kind: input.kind,
    title: input.title,
    details: input.details,
    due_on: input.dueOn,
    rock_status: input.rockStatus,
    priority: input.priority,
    issue_status: input.issueStatus,
    decision: input.decision,
    metric_key: input.metricKey,
    campus: "church-wide",
    updated_at: new Date().toISOString(),
    ...(input.ownerId !== undefined ? { owner_id: input.ownerId } : {}),
  };

  const result = input.id
    ? await admin.from("pulse_items").update(payload).eq("id", input.id).eq("team", input.team)
    : await admin.from("pulse_items").insert({ ...payload, created_by: input.userId });

  if (isMissingPulseTable(result.error)) return { ok: false, error: SAVE_NOT_STORED };
  if (result.error) return { ok: false, error: result.error.message };
  return { ok: true };
}
