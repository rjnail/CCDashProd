import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingPulseTable } from "./pulse-db";
import { tangentDecision, tangentLabel, type TangentSignal } from "./tangent";
import type { OsTeam } from "./types";

export const TANGENT_NOT_SHARED =
  "This alert was not shared with the meeting. Other participants did not see it.";

export type { TangentSignal };

type Result = { ok: true; signal: TangentSignal | null } | { ok: false; error: string };

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
    return {};
  }
  return {};
}

async function activeSession(
  admin: SupabaseClient,
  team: OsTeam,
  userId: string
): Promise<{ id: string } | "missing" | { error: string }> {
  const existing = await admin
    .from("pulse_sessions")
    .select("id")
    .eq("team", team)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (isMissingPulseTable(existing.error)) return "missing";
  if (existing.error) return { error: existing.error.message };
  if (existing.data?.id) return { id: existing.data.id as string };
  const inserted = await admin
    .from("pulse_sessions")
    .insert({ team, status: "active", created_by: userId, stage: 5 })
    .select("id")
    .maybeSingle();
  if (isMissingPulseTable(inserted.error)) return "missing";
  if (inserted.error) {
    const again = await admin
      .from("pulse_sessions")
      .select("id")
      .eq("team", team)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (again.data?.id) return { id: again.data.id as string };
    return { error: inserted.error.message };
  }
  if (!inserted.data?.id) return { error: TANGENT_NOT_SHARED };
  return { id: inserted.data.id as string };
}

export async function readOpenTangent(team: OsTeam): Promise<Result> {
  const admin = adminClient();
  if (!admin) return { ok: false, error: TANGENT_NOT_SHARED };
  const session = await admin
    .from("pulse_sessions")
    .select("id")
    .eq("team", team)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (isMissingPulseTable(session.error)) return { ok: true, signal: null };
  if (session.error) return { ok: false, error: session.error.message };
  if (!session.data?.id) return { ok: true, signal: null };
  const alert = await admin
    .from("pulse_tangent_alerts")
    .select("id, label, triggered_at")
    .eq("session_id", session.data.id)
    .is("dismissed_at", null)
    .limit(1)
    .maybeSingle();
  if (isMissingPulseTable(alert.error)) return { ok: true, signal: null };
  if (alert.error) return { ok: false, error: alert.error.message };
  if (!alert.data) return { ok: true, signal: null };
  return {
    ok: true,
    signal: {
      id: alert.data.id as string,
      label: alert.data.label as string,
      triggeredAt: alert.data.triggered_at as string,
    },
  };
}

export async function raiseTangent(input: { team: OsTeam; issueId: string; userId: string }): Promise<Result> {
  const admin = adminClient();
  if (!admin) return { ok: false, error: TANGENT_NOT_SHARED };
  const issue = await admin
    .from("pulse_items")
    .select("title, details, kind")
    .eq("id", input.issueId)
    .eq("team", input.team)
    .eq("kind", "issue")
    .is("removed_at", null)
    .maybeSingle();
  if (isMissingPulseTable(issue.error)) return { ok: false, error: TANGENT_NOT_SHARED };
  if (issue.error) return { ok: false, error: issue.error.message };
  if (!issue.data) return { ok: false, error: "That issue is not in this meeting." };
  const details = asObject(issue.data.details);
  const label = tangentLabel(typeof details.rootIssue === "string" ? details.rootIssue : "", issue.data.title as string);
  const session = await activeSession(admin, input.team, input.userId);
  if (session === "missing") return { ok: false, error: TANGENT_NOT_SHARED };
  if ("error" in session) return { ok: false, error: `${TANGENT_NOT_SHARED} ${session.error}` };

  const recent = await admin
    .from("pulse_tangent_alerts")
    .select("id, triggered_at, dismissed_at")
    .eq("session_id", session.id)
    .order("triggered_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (isMissingPulseTable(recent.error)) return { ok: false, error: TANGENT_NOT_SHARED };
  if (recent.error) return { ok: false, error: recent.error.message };
  const activeId = recent.data && !recent.data.dismissed_at ? (recent.data.id as string) : null;
  const lastTriggeredAt = recent.data?.triggered_at ? Date.parse(recent.data.triggered_at as string) : null;
  const decision = tangentDecision({ now: Date.now(), activeId, lastTriggeredAt });
  if (decision.type === "cooldown") {
    return { ok: false, error: "A tangent alert was just sent. This click was not shared." };
  }
  if (decision.type === "coalesce") {
    const current = await admin
      .from("pulse_tangent_alerts")
      .select("id, label, triggered_at")
      .eq("id", decision.id)
      .maybeSingle();
    if (!current.data) return { ok: false, error: TANGENT_NOT_SHARED };
    return {
      ok: true,
      signal: {
        id: current.data.id as string,
        label: current.data.label as string,
        triggeredAt: current.data.triggered_at as string,
      },
    };
  }
  const inserted = await admin
    .from("pulse_tangent_alerts")
    .insert({ session_id: session.id, team: input.team, label })
    .select("id, label, triggered_at")
    .maybeSingle();
  if (isMissingPulseTable(inserted.error)) return { ok: false, error: TANGENT_NOT_SHARED };
  if (inserted.error?.code === "23505") {
    const open = await readOpenTangent(input.team);
    return open;
  }
  if (inserted.error || !inserted.data) return { ok: false, error: TANGENT_NOT_SHARED };
  return {
    ok: true,
    signal: {
      id: inserted.data.id as string,
      label: inserted.data.label as string,
      triggeredAt: inserted.data.triggered_at as string,
    },
  };
}

export async function dismissTangent(input: {
  team: OsTeam;
  eventId: string;
  userId: string;
  facilitator: boolean;
  action: "return" | "continue" | "captured";
}): Promise<Result> {
  if (input.action === "continue" && !input.facilitator) {
    return { ok: false, error: "Only the facilitator can acknowledge the tangent." };
  }
  const admin = adminClient();
  if (!admin) return { ok: false, error: TANGENT_NOT_SHARED };
  const { data, error } = await admin
    .from("pulse_tangent_alerts")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("id", input.eventId)
    .eq("team", input.team)
    .is("dismissed_at", null)
    .select("id");
  if (isMissingPulseTable(error)) return { ok: false, error: TANGENT_NOT_SHARED };
  if (error) return { ok: false, error: error.message };
  void data;
  void input.userId;
  return { ok: true, signal: null };
}
