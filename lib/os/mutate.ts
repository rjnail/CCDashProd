"use server";

import { getUserProfile } from "@/lib/metrics";
import { isAdmin } from "@/lib/permissions";
import { canReadGiving } from "./rules";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isFictionalOwnerName } from "./owners";
import { readOwnMeetings } from "./pulse-db";
import { writePulseRow } from "./pulse-admin";
import { memberName } from "./scorecard-store";
import {
  OS_TEAMS,
  type OsIssueStatus,
  type OsRockStatus,
  type OsTeam,
} from "./types";

export type PulseSaveResult = { ok: true } | { ok: false; error: string };

const ROCK_STATUSES: OsRockStatus[] = ["on_track", "off_track", "complete"];
const ISSUE_STATUSES: OsIssueStatus[] = ["open", "discussing", "long_term", "solved"];

async function requireEditor(team: string): Promise<{ userId: string; team: OsTeam; canReadGiving: boolean } | PulseSaveResult> {
  if (!OS_TEAMS.includes(team as OsTeam)) {
    return { ok: false, error: "Unknown meeting." };
  }
  const supabase = await createClient();
  const profile = await getUserProfile(supabase);
  if (!profile) return { ok: false, error: "Sign in to edit a meeting." };
  if (!isAdmin(profile)) {
    return { ok: false, error: "Only an administrator can edit meeting items." };
  }
  const membership = await readOwnMeetings(supabase, profile.id);
  if (!membership.missing && !membership.teams.includes(team as OsTeam)) {
    return { ok: false, error: "You don't have access to that meeting." };
  }
  return {
    userId: profile.id,
    team: team as OsTeam,
    canReadGiving: canReadGiving({ financialInsights: profile.financial_insights, isAdmin: true }),
  };
}

function failed(result: { userId: string; team: OsTeam; canReadGiving: boolean } | PulseSaveResult): result is PulseSaveResult {
  return "ok" in result;
}

function detailsObject(details: unknown): Record<string, unknown> {
  if (!details) return {};
  if (typeof details === "object" && !Array.isArray(details)) return { ...(details as Record<string, unknown>) };
  if (typeof details !== "string") return {};
  try {
    const parsed = JSON.parse(details) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    return { owner: details };
  }
  return { owner: details };
}

async function storedDetails(id: string, team: OsTeam): Promise<Record<string, unknown>> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("pulse_items").select("details").eq("id", id).eq("team", team).maybeSingle();
  if (error || !data) return {};
  return detailsObject(data.details);
}

export async function savePulseItem(input: {
  id?: string;
  team: string;
  kind: "rock" | "todo" | "issue";
  title: string;
  ownerUserId: string | null;
  dueOn?: string;
  rockStatus?: string;
  priority?: number | null;
  issueStatus?: string;
  decision?: string;
  metricKey?: string | null;
}): Promise<PulseSaveResult> {
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Enter a title before saving." };

  const auth = await requireEditor(input.team);
  if (failed(auth)) return auth;

  const ownerUserId = input.ownerUserId?.trim() || null;
  let ownerName = "";
  if (ownerUserId) {
    let name: string | null = null;
    try {
      name = await memberName(createAdminClient(), auth.team, ownerUserId);
    } catch {
      name = null;
    }
    if (!name || isFictionalOwnerName(name)) return { ok: false, error: "Choose an owner from this meeting." };
    ownerName = name;
  }

  const rockStatus = ROCK_STATUSES.includes(input.rockStatus as OsRockStatus)
    ? (input.rockStatus as OsRockStatus)
    : null;
  const issueStatus = ISSUE_STATUSES.includes(input.issueStatus as OsIssueStatus)
    ? (input.issueStatus as OsIssueStatus)
    : null;
  const priority =
    typeof input.priority === "number" && input.priority >= 0 && input.priority <= 3
      ? input.priority
      : null;
  const previous = input.id ? await storedDetails(input.id, auth.team) : {};
  const createdIssue =
    input.kind === "issue" && !input.id
      ? {
          rootIssue: "",
          neededDecision: "",
          notes: "",
          version: 1,
          sortOrder: Date.now(),
          topRank: null,
          sourceIssueId: null,
        }
      : {};

  return writePulseRow({
    id: input.id,
    team: auth.team,
    kind: input.kind,
    title: title.slice(0, 180),
    details: JSON.stringify({
      ...createdIssue,
      ...previous,
      owner: ownerName,
      ownerUserId,
    }),
    dueOn: input.dueOn?.trim() || null,
    rockStatus: input.kind === "issue" ? null : rockStatus,
    priority: input.kind === "issue" ? priority : null,
    issueStatus: input.kind === "issue" ? issueStatus ?? "open" : null,
    decision: input.kind === "issue" ? (input.decision ?? "").trim() : "",
    metricKey: input.metricKey ?? null,
    ownerId: ownerUserId,
    canReadGiving: auth.canReadGiving,
    userId: auth.userId,
  });
}

export async function saveScorecardNote(input: {
  id?: string;
  team: string;
  metricKey: string;
  label: string;
  owner: string;
  target: string;
  manualValue: string;
  allowValue: boolean;
}): Promise<PulseSaveResult> {
  const label = input.label.trim();
  const owner = input.owner.trim();
  const target = input.target.trim();
  const manualValue = input.allowValue ? input.manualValue.trim() : "";
  if (!label) return { ok: false, error: "Enter a name before saving." };
  if (!owner && !target && !manualValue) {
    return { ok: false, error: "Enter a target, owner, or manual value before saving." };
  }

  const auth = await requireEditor(input.team);
  if (failed(auth)) return auth;

  return writePulseRow({
    id: input.id,
    team: auth.team,
    kind: "headline",
    title: label.slice(0, 180),
    details: JSON.stringify({
      role: input.metricKey.startsWith("manual:") || input.allowValue ? "manual" : "scorecard",
      owner,
      target,
      manualValue,
    }),
    dueOn: null,
    rockStatus: null,
    priority: null,
    issueStatus: null,
    decision: "",
    metricKey: input.metricKey,
    canReadGiving: auth.canReadGiving,
    userId: auth.userId,
  });
}
