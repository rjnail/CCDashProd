"use server";

import { getUserProfile } from "@/lib/metrics";
import { isAdmin } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { CONCLUDE_NOT_ALLOWED, CONCLUDE_NOT_SAVED, CONCLUDE_SAVED, parseMeetingRating } from "./conclude";
import { saveConcludedMeeting } from "./conclude-store";
import { loadPulsePage } from "./load";
import { isMissingPulseTable } from "./pulse-db";
import { canReadGiving } from "./rules";
import { OS_TEAMS, type OsTeam } from "./types";

export async function concludeMeeting(input: {
  team: string;
  campus: string;
  notes: string;
  headlines: string;
  decision: string;
  rating: string;
  elapsedSeconds: number;
  stage: number;
}): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  if (!OS_TEAMS.includes(input.team as OsTeam)) return { ok: false, error: "Unknown meeting." };
  const rating = parseMeetingRating(input.rating);
  if (rating == null) return { ok: false, error: "Choose an explicit meeting rating before concluding." };
  const supabase = await createClient();
  const profile = await getUserProfile(supabase);
  if (!profile) return { ok: false, error: "Sign in to conclude a meeting." };
  const membership = await supabase
    .from("pulse_team_members")
    .select("capability")
    .eq("user_id", profile.id)
    .eq("team", input.team);
  if (isMissingPulseTable(membership.error)) return { ok: false, error: CONCLUDE_NOT_SAVED };
  if (membership.error) return { ok: false, error: CONCLUDE_NOT_SAVED };
  const capabilities = (membership.data ?? []).map((row) => row.capability as string);
  const onTeam = capabilities.some((capability) => ["viewer", "contributor", "facilitator"].includes(capability));
  if (!onTeam) return { ok: false, error: "You don't have access to that meeting." };
  if (!isAdmin(profile) && !capabilities.includes("facilitator")) {
    return { ok: false, error: CONCLUDE_NOT_ALLOWED };
  }
  const page = await loadPulsePage(supabase, profile, input.team, input.campus);
  if (page.denied || page.team !== input.team) return { ok: false, error: "You don't have access to that meeting." };
  const saved = await saveConcludedMeeting({
    team: page.team,
    userId: profile.id,
    campus: page.campus,
    campusLabel: page.campusLabel,
    notes: input.notes,
    headlines: input.headlines,
    decision: input.decision,
    rating,
    elapsedSeconds: input.elapsedSeconds,
    stage: input.stage,
    canReadGiving: canReadGiving({ financialInsights: profile.financial_insights, isAdmin: isAdmin(profile) }),
    measures: page.measures.map((measure) => ({
      key: measure.key,
      label: measure.label,
      value: measure.value,
      periodLabel: measure.periodLabel,
      periodKind: measure.periodKind,
      campusLabel: measure.campusLabel,
      quality: measure.quality,
    })),
  });
  if (!saved.ok) return saved;
  return { ok: true, message: CONCLUDE_SAVED };
}
