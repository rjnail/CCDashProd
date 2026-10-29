"use server";

import { getUserProfile } from "@/lib/metrics";
import { isAdmin } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { SAVE_NOT_STORED, isMissingPulseTable } from "./pulse-db";
import { dismissTangent, raiseTangent, readOpenTangent, type TangentSignal } from "./tangent-store";
import { OS_TEAMS, type OsTeam } from "./types";

type Actor =
  | { ok: false; error: string }
  | { ok: true; userId: string; team: OsTeam; facilitator: boolean };

async function actor(team: string): Promise<Actor> {
  if (!OS_TEAMS.includes(team as OsTeam)) return { ok: false, error: "Unknown meeting." };
  const supabase = await createClient();
  const profile = await getUserProfile(supabase);
  if (!profile) return { ok: false, error: "Sign in to use the meeting." };
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
  };
}

export async function readMeetingTangent(team: string): Promise<{ ok: true; signal: TangentSignal | null } | { ok: false; error: string }> {
  const auth = await actor(team);
  if (!auth.ok) return auth;
  return readOpenTangent(auth.team);
}

export async function raiseMeetingTangent(input: {
  team: string;
  issueId: string;
}): Promise<{ ok: true; signal: TangentSignal | null } | { ok: false; error: string }> {
  const auth = await actor(input.team);
  if (!auth.ok) return auth;
  return raiseTangent({ team: auth.team, issueId: input.issueId, userId: auth.userId });
}

export async function dismissMeetingTangent(input: {
  team: string;
  eventId: string;
  action: "return" | "continue" | "captured";
}): Promise<{ ok: true; signal: TangentSignal | null } | { ok: false; error: string }> {
  const auth = await actor(input.team);
  if (!auth.ok) return auth;
  return dismissTangent({
    team: auth.team,
    eventId: input.eventId,
    userId: auth.userId,
    facilitator: auth.facilitator,
    action: input.action,
  });
}
