"use server";

import { getUserProfile } from "@/lib/metrics";
import { createClient } from "@/lib/supabase/server";
import { loadDashboardInsights, loadPulsePage } from "./load";
import { groundedWording, readModelConfig } from "./model";
import { readOwnMeetings, readTeamRecords } from "./pulse-db";
import { answerQuestion, closedMonthCeiling } from "./rules";
import { OS_TEAMS, type OsAnswer, type OsTeam } from "./types";

const asks = new Map<string, number[]>();

function limited(userId: string): boolean {
  const now = Date.now();
  const recent = (asks.get(userId) ?? []).filter((time) => now - time < 60_000);
  if (recent.length >= 20) {
    asks.set(userId, recent);
    return true;
  }
  recent.push(now);
  asks.set(userId, recent);
  return false;
}

function unavailable(question: string, findings: string, limitation: string): OsAnswer {
  return { question, status: "unavailable", findings, figures: [], limitation, citations: [] };
}

export async function askPulse(question: string, team: string, campus?: string | null): Promise<OsAnswer> {
  return askCommunityOs(question, { surface: "pulse", team, campus });
}

export async function askCommunityOs(
  question: string,
  scope:
    | { surface: "pulse"; team: string; campus?: string | null }
    | { surface: "dashboard"; campusSlug: string | null; campusName: string }
): Promise<OsAnswer> {
  const trimmed = question.trim().slice(0, 400);
  const model = readModelConfig();
  if (!trimmed) {
    return unavailable(
      question,
      "Enter a question.",
      model.missing
        ? `No language model is configured (${model.missing}).`
        : "Answers stay inside authorized application data."
    );
  }

  const supabase = await createClient();
  const profile = await getUserProfile(supabase);
  if (!profile) {
    return unavailable(trimmed, "Sign in to ask about ministry data.", "Answers use the signed-in account's existing access.");
  }
  if (limited(profile.id)) {
    return unavailable(trimmed, "Too many questions were just asked.", "Wait a minute, then ask again. Nothing was guessed.");
  }

  if (scope.surface === "dashboard") {
    const bundle = await loadDashboardInsights(supabase, profile, scope.campusSlug, scope.campusName);
    const membership = await readOwnMeetings(supabase, profile.id);
    const commitments = membership.missing
      ? undefined
      : (
          await Promise.all(membership.teams.map((team) => readTeamRecords(supabase, team)))
        ).flatMap((records) =>
          records.items
            .filter((item) => item.kind === "todo")
            .map((item) => ({
              title: item.title,
              dueOn: item.dueOn,
              done: item.rockStatus === "complete",
            }))
        );
    return finish(trimmed, {
      measures: bundle.measures,
      attendanceMonths: bundle.attendanceMonths,
      ceiling: closedMonthCeiling(new Date()),
      campusLabel: bundle.ask.campusLabel,
      commitments,
      modelConfigured: model.configured,
    });
  }

  if (!OS_TEAMS.includes(scope.team as OsTeam)) {
    return unavailable(trimmed, "That meeting is not available.", "Answers stay inside meetings you can open.");
  }
  const page = await loadPulsePage(supabase, profile, scope.team, scope.campus);
  if (page.denied) {
    return unavailable(trimmed, "You don't have access to that meeting.", "Team records stay inside the signed-in account.");
  }
  return finish(trimmed, {
    measures: page.measures,
    attendanceMonths: page.attendanceMonths,
    ceiling: closedMonthCeiling(new Date()),
    campusLabel: page.campusLabel,
    commitments: page.items
      .filter((item) => item.kind === "todo")
      .map((item) => ({ title: item.title, dueOn: item.dueOn, done: item.rockStatus === "complete" })),
    modelConfigured: model.configured,
  });
}

async function finish(
  question: string,
  input: {
    measures: Parameters<typeof answerQuestion>[1]["measures"];
    attendanceMonths: Parameters<typeof answerQuestion>[1]["attendanceMonths"];
    ceiling: string;
    campusLabel: string;
    commitments?: { title: string; dueOn: string | null; done: boolean }[];
    modelConfigured: boolean;
  }
): Promise<OsAnswer> {
  const answer = answerQuestion(question, {
    measures: input.measures,
    attendanceMonths: input.attendanceMonths,
    ceiling: input.ceiling,
    campusLabel: input.campusLabel,
    commitments: input.commitments,
    modelConfigured: input.modelConfigured,
  });
  if (answer.status !== "unavailable" || !input.modelConfigured) return answer;
  const evidence = [
    answer.findings,
    answer.limitation,
    ...answer.figures,
    ...input.measures.map(
      (measure) =>
        `${measure.label}: ${measure.value == null ? "no value" : measure.value}. ${measure.periodLabel}. ${measure.campusLabel}. ${measure.quality}. ${measure.qualityDetail}`
    ),
  ].join("\n");
  const grounded = await groundedWording(question, evidence);
  if (!grounded || "unavailable" in grounded) return answer;
  return {
    ...answer,
    status: "answered",
    findings: grounded.text,
    limitation: `${answer.limitation} Wording was checked against the supplied figures.`,
  };
}

export async function askDashboard(
  question: string,
  campusSlug: string | null,
  campusName: string
): Promise<OsAnswer> {
  return askCommunityOs(question, { surface: "dashboard", campusSlug, campusName });
}
