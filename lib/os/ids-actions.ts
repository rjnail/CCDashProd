"use server";

import { getUserProfile } from "@/lib/metrics";
import { isAdmin } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import {
  appendIssueNote,
  closeVoteRound,
  dismissInsight,
  insertIssue,
  insertLinkedTodo,
  moveIssueLongTerm,
  openVoteRound,
  replaceMyVotes,
  resolveIssue,
  saveIssueDraft,
  saveIssueOrder,
  saveIssueOwner,
  saveIssuePriority,
  saveTopThree,
} from "./ids-store";
import { SAVE_NOT_STORED, isMissingPulseTable } from "./pulse-db";
import { canReadGiving } from "./rules";
import { OS_TEAMS, type OsTeam } from "./types";

type Actor =
  | { ok: false; error: string }
  | { ok: true; userId: string; team: OsTeam; facilitator: boolean; canReadGiving: boolean };

async function actor(team: string): Promise<Actor> {
  if (!OS_TEAMS.includes(team as OsTeam)) return { ok: false, error: "Unknown meeting." };
  const supabase = await createClient();
  const profile = await getUserProfile(supabase);
  if (!profile) return { ok: false, error: "Sign in to edit a meeting." };
  const { data, error } = await supabase
    .from("pulse_team_members")
    .select("capability")
    .eq("user_id", profile.id)
    .eq("team", team);
  if (isMissingPulseTable(error)) return { ok: false, error: SAVE_NOT_STORED };
  if (error) return { ok: false, error: error.message };
  const capabilities = (data ?? []).map((row) => row.capability as string);
  const participant = capabilities.some((capability) =>
    ["viewer", "contributor", "facilitator"].includes(capability)
  );
  if (!participant) return { ok: false, error: "You don't have access to that meeting." };
  return {
    ok: true,
    userId: profile.id,
    team: team as OsTeam,
    facilitator: isAdmin(profile) || capabilities.includes("facilitator"),
    canReadGiving: canReadGiving({ financialInsights: profile.financial_insights, isAdmin: isAdmin(profile) }),
  };
}

function denied(result: Actor): result is { ok: false; error: string } {
  return !result.ok;
}

export async function captureIssue(input: {
  team: string;
  title: string;
  metricKey?: string | null;
  ownerUserId?: string | null;
}) {
  const auth = await actor(input.team);
  if (denied(auth)) return auth;
  return insertIssue({
    team: auth.team,
    title: input.title,
    userId: auth.userId,
    metricKey: input.metricKey,
    canReadGiving: auth.canReadGiving,
    ownerUserId: input.ownerUserId,
  });
}

export async function addIssueNote(input: { team: string; id: string; version: number; text: string }) {
  const auth = await actor(input.team);
  if (denied(auth)) return auth;
  if (!auth.facilitator) return { ok: false as const, error: "Only the facilitator can add a note." };
  return appendIssueNote({ ...input, team: auth.team, userId: auth.userId });
}

export async function setIssuePriority(input: { team: string; id: string; version: number; priority: number | null }) {
  const auth = await actor(input.team);
  if (denied(auth)) return auth;
  if (!auth.facilitator) return { ok: false as const, error: "Only the facilitator can set the priority." };
  return saveIssuePriority({ ...input, team: auth.team });
}

export async function saveFocus(input: {
  team: string;
  id: string;
  version: number;
  rootIssue: string;
  neededDecision: string;
  notes: string;
}) {
  const auth = await actor(input.team);
  if (denied(auth)) return auth;
  if (!auth.facilitator) return { ok: false as const, error: "Only the facilitator can edit the issue being solved." };
  return saveIssueDraft({ ...input, team: auth.team });
}

export async function assignIssueOwner(input: { team: string; id: string; version: number; ownerUserId: string }) {
  const auth = await actor(input.team);
  if (denied(auth)) return auth;
  if (!auth.facilitator) return { ok: false as const, error: "Only the facilitator can set the issue owner." };
  return saveIssueOwner({ ...input, team: auth.team });
}

export async function reorderIssues(input: { team: string; ordered: { id: string; version: number }[] }) {
  const auth = await actor(input.team);
  if (denied(auth)) return auth;
  if (!auth.facilitator) return { ok: false as const, error: "Only the facilitator can reorder issues." };
  return saveIssueOrder({ team: auth.team, ordered: input.ordered });
}

export async function confirmTopThree(input: {
  team: string;
  roundId: string | null;
  ranked: { id: string; version: number }[];
}) {
  const auth = await actor(input.team);
  if (denied(auth)) return auth;
  if (!auth.facilitator) return { ok: false as const, error: "Only the facilitator can confirm Top 3." };
  return saveTopThree({ ...input, team: auth.team });
}

export async function markIssueLongTerm(input: { team: string; id: string; version: number }) {
  const auth = await actor(input.team);
  if (denied(auth)) return auth;
  if (!auth.facilitator) return { ok: false as const, error: "Only the facilitator can move an issue to long-term." };
  return moveIssueLongTerm({ ...input, team: auth.team });
}

export async function createLinkedTodo(input: {
  team: string;
  issueId: string;
  title: string;
  ownerUserId: string;
  dueOn: string;
}) {
  const auth = await actor(input.team);
  if (denied(auth)) return auth;
  if (!auth.facilitator) return { ok: false as const, error: "Only the facilitator can create the linked to-do." };
  return insertLinkedTodo({ ...input, team: auth.team, userId: auth.userId });
}

export async function solveIssue(input: {
  team: string;
  id: string;
  version: number;
  resolution: string;
  idempotencyKey: string;
}) {
  const auth = await actor(input.team);
  if (denied(auth)) return auth;
  if (!auth.facilitator) return { ok: false as const, error: "Only the facilitator can resolve an issue." };
  return resolveIssue({ ...input, team: auth.team, userId: auth.userId });
}

export async function beginVoteRound(input: { team: string }) {
  const auth = await actor(input.team);
  if (denied(auth)) return auth;
  if (!auth.facilitator) return { ok: false as const, error: "Only the facilitator can open voting." };
  return openVoteRound({ team: auth.team, userId: auth.userId });
}

export async function endVoteRound(input: { team: string; roundId: string }) {
  const auth = await actor(input.team);
  if (denied(auth)) return auth;
  if (!auth.facilitator) return { ok: false as const, error: "Only the facilitator can close voting." };
  return closeVoteRound({ team: auth.team, roundId: input.roundId, userId: auth.userId });
}

export async function castMyVotes(input: { team: string; roundId: string; issueIds: string[] }) {
  const auth = await actor(input.team);
  if (denied(auth)) return auth;
  return replaceMyVotes({
    team: auth.team,
    roundId: input.roundId,
    issueIds: input.issueIds,
    userId: auth.userId,
  });
}

export async function dismissCommunityInsight(input: {
  insightId: string;
  surface: "dashboard" | "pulse";
  team?: string;
}) {
  const supabase = await createClient();
  const profile = await getUserProfile(supabase);
  if (!profile) return { ok: false as const, error: "Sign in to dismiss an insight." };
  const team = input.surface === "pulse" ? input.team ?? "" : "";
  if (input.surface === "pulse") {
    const auth = await actor(team);
    if (denied(auth)) return auth;
  }
  return dismissInsight({
    userId: profile.id,
    insightId: input.insightId,
    surface: input.surface,
    team,
  });
}
