"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getUserProfile } from "@/lib/metrics";
import { canEditBenchmarks, isAdmin } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { canReadGiving } from "./rules";
import { SAVE_NOT_STORED, isMissingPulseTable } from "./pulse-db";
import {
  campusOptions,
  canEditChurchwideTarget,
  canEditScorecardRow,
  canMutateTeam,
  canPublishManual,
  frequencyOptions,
  isManualMetric,
  authorizeSelectionWrites,
  givingWriteAllowed,
  observationKey,
  omitRestrictedGiving,
  periodGrainLabel,
  planSelectionChange,
  validateManualDraft,
  validateRowSave,
  type SelectionWrite,
  type StoredSelection,
} from "./scorecard";
import { applySelectionWrites, memberName, saveScorecardEdition } from "./scorecard-store";
import { OS_TEAMS, type OsManualReading, type OsScorecardNote, type OsSharedTarget, type OsTeam, type ScorecardManualStatus, type ScorecardStatusMode, type ScorecardUnit } from "./types";

export type ScorecardActionResult =
  | {
      ok: true;
      note?: OsScorecardNote;
      notes?: OsScorecardNote[];
      reading?: OsManualReading | null;
      sharedTarget?: OsSharedTarget | null;
      configured?: boolean;
    }
  | { ok: false; error: string };

async function actor(team: string): Promise<
  | { ok: false; error: string }
  | {
      ok: true;
      userId: string;
      name: string;
      team: OsTeam;
      facilitator: boolean;
      admin: boolean;
      benchmarkEditor: boolean;
      canReadGiving: boolean;
    }
> {
  if (!OS_TEAMS.includes(team as OsTeam)) return { ok: false, error: "Unknown meeting." };
  const supabase = await createClient();
  const profile = await getUserProfile(supabase);
  if (!profile) return { ok: false, error: "Sign in to edit a scorecard." };
  const { data, error } = await supabase
    .from("pulse_team_members")
    .select("team, capability")
    .eq("user_id", profile.id);
  if (isMissingPulseTable(error)) return { ok: false, error: SAVE_NOT_STORED };
  if (error) return { ok: false, error: error.message };
  const rows = (data ?? []) as { team: string; capability: string }[];
  const facilitatorTeams = rows.filter((row) => row.capability === "facilitator").map((row) => row.team as OsTeam);
  const onTeam = rows.some(
    (row) => row.team === team && ["viewer", "contributor", "facilitator"].includes(row.capability)
  );
  if (!onTeam) return { ok: false, error: "You don't have access to that meeting." };
  const admin = isAdmin(profile);
  return {
    ok: true,
    userId: profile.id,
    name: profile.display_name?.trim() || "Team member",
    team: team as OsTeam,
    facilitator: admin || facilitatorTeams.includes(team as OsTeam),
    admin,
    benchmarkEditor: canEditBenchmarks(profile),
    canReadGiving: canReadGiving({ financialInsights: profile.financial_insights, isAdmin: admin }),
  };
}

function denied(result: Awaited<ReturnType<typeof actor>>): result is { ok: false; error: string } {
  return !result.ok;
}

function assertEditor(auth: Exclude<Awaited<ReturnType<typeof actor>>, { ok: false }>): ScorecardActionResult | null {
  if (!canMutateTeam({ isAdmin: auth.admin, facilitatorTeams: auth.facilitator ? [auth.team] : [], team: auth.team })) {
    return { ok: false, error: "Only an administrator or facilitator of this team can edit the scorecard." };
  }
  if (!canEditScorecardRow({ isAdmin: auth.admin, facilitator: auth.facilitator })) {
    return { ok: false, error: "Only an administrator or facilitator of this team can edit the scorecard." };
  }
  return null;
}

function selectionResult(
  auth: Exclude<Awaited<ReturnType<typeof actor>>, { ok: false }>,
  plan: { ok: true; writes: SelectionWrite[] } | { ok: false; error: string },
  stored: StoredSelection[],
  templates: Record<string, Record<string, unknown>>
): Promise<ScorecardActionResult> {
  if (!plan.ok) return Promise.resolve(plan);
  const guarded = authorizeSelectionWrites({
    team: auth.team,
    canReadGiving: auth.canReadGiving,
    writes: plan.writes,
    stored,
  });
  if (!guarded.ok) return Promise.resolve(guarded);
  return applySelectionWrites({
    team: auth.team,
    canReadGiving: auth.canReadGiving,
    userId: auth.userId,
    actorName: auth.name,
    writes: guarded.writes,
    templates,
  }).then((result) => {
    if (!result.ok) return result;
    return { ...result, notes: omitRestrictedGiving(result.notes, auth.team, auth.canReadGiving) };
  });
}

export async function saveScorecardRow(input: {
  team: string;
  id?: string;
  metricKey: string;
  label: string;
  campus: string;
  periodKind: string;
  periodLabel: string;
  expectedVersion: number | null;
  ownerUserId: string | null;
  targetText: string;
  savedTarget: number | null;
  statusMode: ScorecardStatusMode;
  manualStatus: ScorecardManualStatus | null;
  reason: string;
  unit: ScorecardUnit;
  actualText?: string;
  periodStart?: string;
  periodEnd?: string;
  readingCampus?: string;
}): Promise<ScorecardActionResult> {
  const auth = await actor(input.team);
  if (denied(auth)) return auth;
  const blocked = assertEditor(auth);
  if (blocked) return blocked;
  const access = givingWriteAllowed({
    team: auth.team,
    canReadGiving: auth.canReadGiving,
    metricKey: input.metricKey,
    campus: input.campus,
  });
  const manual = isManualMetric(input.metricKey);
  if (!manual && !access.allowed) return { ok: false, error: access.reason || "That measure is not available on this scorecard." };
  if (input.readingCampus) {
    const readingGate = givingWriteAllowed({
      team: auth.team,
      canReadGiving: auth.canReadGiving,
      metricKey: input.metricKey,
      campus: input.readingCampus,
    });
    if (!readingGate.allowed) return { ok: false, error: readingGate.reason };
  }
  const campus = campusOptions(input.metricKey).find((option) => option.id === input.campus);
  if (!campus?.supported) return { ok: false, error: campus?.reason || "That campus is not available for this measure." };
  const frequency = frequencyOptions(input.metricKey).find((option) => option.id === input.periodKind);
  if (!frequency?.supported) return { ok: false, error: frequency?.reason || "That reporting period is not available for this measure." };
  const canTarget = canEditChurchwideTarget({ isAdmin: auth.admin, canEditBenchmarks: auth.benchmarkEditor });
  let ownerName = "";
  if (input.ownerUserId) {
    try {
      const name = await memberName(createAdminClient(), auth.team, input.ownerUserId);
      if (!name) return { ok: false, error: "Choose an owner from this meeting." };
      ownerName = name;
    } catch {
      return { ok: false, error: "Choose an owner from this meeting." };
    }
  }
  const validated = validateRowSave({
    manual,
    canEditTarget: canTarget,
    targetText: input.targetText,
    savedTarget: input.savedTarget,
    statusMode: input.statusMode,
    manualStatus: input.manualStatus,
    reason: input.reason,
    ownerUserId: input.ownerUserId,
    memberIds: input.ownerUserId ? [input.ownerUserId] : [],
    actualText: input.actualText ?? "",
    periodStart: input.periodStart ?? "",
    periodEnd: input.periodEnd ?? "",
    explicitMax: null,
    unit: input.unit,
  });
  if (!validated.ok) return validated;
  const periodKey = observationKey(input.campus, input.periodKind, input.periodLabel);
  const saved = await saveScorecardEdition({
    team: auth.team,
    canReadGiving: auth.canReadGiving,
    userId: auth.userId,
    actorName: auth.name,
    metricKey: input.metricKey,
    label: input.label,
    campus: input.campus,
    periodKind: input.periodKind,
    periodKey,
    expectedVersion: input.expectedVersion,
    ownerUserId: input.ownerUserId,
    ownerName,
    canEditTarget: canTarget,
    target: validated.target,
    unit: input.unit,
    statusMode: input.statusMode,
    manualStatus: input.manualStatus,
    reason: input.reason,
    manual,
    reading:
      validated.actual == null
        ? null
        : {
            value: validated.actual,
            periodStart: input.periodStart ?? "",
            periodEnd: input.periodEnd ?? "",
            periodLabel: input.periodLabel,
            campus: input.readingCampus || input.campus,
            unit: input.unit,
          },
  });
  if (!saved.ok) return saved;
  const sharedTarget: OsSharedTarget | null =
    saved.sharedValue == null
      ? null
      : {
          metricKey: input.metricKey,
          campus: input.campus,
          periodKey,
          value: saved.sharedValue,
          setAt: new Date().toISOString(),
          conflict: false,
        };
  return { ok: true, note: saved.note, reading: saved.reading, sharedTarget };
}

export async function addScorecardMeasure(input: {
  team: string;
  metricKey: string;
  campus: string;
  periodKind: string;
  ownerUserId: string | null;
  configured: boolean;
  defaults: { metricKey: string; campus: string; periodKind: string; label: string }[];
  stored: StoredSelection[];
}): Promise<ScorecardActionResult> {
  const auth = await actor(input.team);
  if (denied(auth)) return auth;
  const blocked = assertEditor(auth);
  if (blocked) return blocked;
  const access = givingWriteAllowed({
    team: auth.team,
    canReadGiving: auth.canReadGiving,
    metricKey: input.metricKey,
    campus: input.campus,
  });
  if (!access.allowed) return { ok: false, error: access.reason || "That measure is not available on this scorecard." };
  const campus = campusOptions(input.metricKey).find((option) => option.id === input.campus);
  if (!campus?.supported) return { ok: false, error: campus?.reason || "That campus is not available for this measure." };
  const frequency = frequencyOptions(input.metricKey).find((option) => option.id === input.periodKind);
  if (!frequency?.supported) return { ok: false, error: frequency?.reason || "That reporting period is not available from the connected source." };
  if (input.ownerUserId) {
    try {
      const name = await memberName(createAdminClient(), auth.team, input.ownerUserId);
      if (!name) return { ok: false, error: "Choose an owner from this meeting." };
    } catch {
      return { ok: false, error: "Choose an owner from this meeting." };
    }
  }
  const label = input.defaults.find((row) => row.metricKey === input.metricKey)?.label ?? input.metricKey;
  const plan = planSelectionChange({
    team: auth.team,
    configured: input.configured,
    defaults: input.defaults,
    stored: input.stored.filter((row) => row.team === auth.team),
    change: {
      type: "add",
      metricKey: input.metricKey,
      campus: input.campus,
      periodKind: input.periodKind,
      ownerUserId: input.ownerUserId,
      label,
    },
  });
  if (!plan.ok) return plan;
  return selectionResult(auth, plan, input.stored, {
    [input.metricKey]: { role: isManualMetric(input.metricKey) ? "manual" : "scorecard" },
  });
}

export async function createManualMeasure(input: {
  team: string;
  name: string;
  definition: string;
  unit: string;
  frequency: string;
  campus: string;
  comparison: string;
  ownerUserId: string;
  rangeMin: string;
  rangeMax: string;
  attentionMin: string;
  attentionMax: string;
  explicitMax: string;
  target: string;
  publish: boolean;
  configured: boolean;
  defaults: { metricKey: string; campus: string; periodKind: string; label: string }[];
  stored: StoredSelection[];
}): Promise<ScorecardActionResult> {
  const auth = await actor(input.team);
  if (denied(auth)) return auth;
  const blocked = assertEditor(auth);
  if (blocked) return blocked;
  const draft = validateManualDraft(input);
  if (!draft.ok) return draft;
  if (input.publish && !canPublishManual({ isAdmin: auth.admin })) {
    return { ok: false, error: "Only an administrator can publish a manual measure for other teams." };
  }
  let ownerName = "";
  try {
    const name = await memberName(createAdminClient(), auth.team, draft.value.ownerUserId);
    if (!name) return { ok: false, error: "Choose an owner from this meeting." };
    ownerName = name;
  } catch {
    return { ok: false, error: "Choose an owner from this meeting." };
  }
  const metricKey = `manual:${crypto.randomUUID()}`;
  const plan = planSelectionChange({
    team: auth.team,
    configured: input.configured,
    defaults: input.defaults,
    stored: input.stored.filter((row) => row.team === auth.team),
    change: {
      type: "add",
      metricKey,
      campus: draft.value.campus,
      periodKind: draft.value.frequency,
      ownerUserId: draft.value.ownerUserId,
      label: draft.value.name,
    },
  });
  if (!plan.ok) return plan;
  const periodKey = observationKey(draft.value.campus, draft.value.frequency, periodGrainLabel(draft.value.frequency));
  const target =
    draft.value.target == null
      ? {}
      : {
          [periodKey]: {
            value: draft.value.target,
            unit: draft.value.unit,
            setBy: auth.userId,
            setAt: new Date().toISOString(),
          },
        };
  return selectionResult(auth, plan, input.stored, {
    [metricKey]: {
      role: "manual",
      owner: ownerName,
      definition: draft.value.definition,
      unit: draft.value.unit,
      frequency: draft.value.frequency,
      comparison: draft.value.comparison,
      rangeMin: draft.value.rangeMin,
      rangeMax: draft.value.rangeMax,
      attentionMin: draft.value.attentionMin,
      attentionMax: draft.value.attentionMax,
      explicitMax: draft.value.explicitMax,
      published: input.publish && auth.admin,
      target: draft.value.target == null ? "" : String(draft.value.target),
      targets: target,
    },
  });
}

export async function reorderScorecard(input: {
  team: string;
  metricKeys: string[];
  configured: boolean;
  defaults: { metricKey: string; campus: string; periodKind: string; label: string }[];
  stored: StoredSelection[];
}): Promise<ScorecardActionResult> {
  const auth = await actor(input.team);
  if (denied(auth)) return auth;
  const blocked = assertEditor(auth);
  if (blocked) return blocked;
  const plan = planSelectionChange({
    team: auth.team,
    configured: input.configured,
    defaults: input.defaults,
    stored: input.stored.filter((row) => row.team === auth.team),
    change: { type: "reorder", metricKeys: input.metricKeys },
  });
  if (!plan.ok) return plan;
  return selectionResult(auth, plan, input.stored, {});
}

export async function removeScorecardMeasure(input: {
  team: string;
  metricKey: string;
  campus: string;
  periodKind: string;
  configured: boolean;
  defaults: { metricKey: string; campus: string; periodKind: string; label: string }[];
  stored: StoredSelection[];
}): Promise<ScorecardActionResult> {
  const auth = await actor(input.team);
  if (denied(auth)) return auth;
  const blocked = assertEditor(auth);
  if (blocked) return blocked;
  const plan = planSelectionChange({
    team: auth.team,
    configured: input.configured,
    defaults: input.defaults,
    stored: input.stored.filter((row) => row.team === auth.team),
    change: { type: "remove", metricKey: input.metricKey, campus: input.campus, periodKind: input.periodKind },
  });
  if (!plan.ok) return plan;
  return selectionResult(auth, plan, input.stored, {});
}
