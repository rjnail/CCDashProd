"use server";

import { revalidatePath } from "next/cache";
import { getUserProfile } from "@/lib/metrics";
import { canEditBenchmarks, isAdmin } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import {
  PLANNING_NOT_STORED,
  canApprovePlan,
  canManageSeats,
  canViewPlanning,
  emptyPlanningView,
  emptySeatView,
  isPlanningScope,
  isSectionKey,
  parseSectionContent,
  planningWriteAllowed,
  validateSeatDraft,
  type ArchiveReferenceChoice,
  type ArchiveSubordinateChoice,
  type PlanningView,
  type SeatView,
  type SharedWorkItem,
} from "./planning";
import {
  approvePlanningVersion,
  archiveStoredSeat,
  dropPlanningSection,
  readPlanningBundle,
  readSeatBundle,
  readSharedWork,
  savePlanningSection,
  savePlanningVersion,
  saveSeat,
} from "./planning-store";
import { isMissingPulseTable } from "./pulse-db";
import { canReadGiving } from "./rules";
import { OS_TEAMS, type OsTeam } from "./types";

type Denied = { ok: false; error: string };
type Actor = {
  ok: true;
  userId: string;
  team: OsTeam;
  isAdmin: boolean;
  canEditBenchmarks: boolean;
  facilitatorTeams: OsTeam[];
  memberTeams: OsTeam[];
  canReadGiving: boolean;
  participant: boolean;
  tablesReady: boolean;
};

async function actor(team: string): Promise<Actor | Denied> {
  if (!OS_TEAMS.includes(team as OsTeam)) return { ok: false, error: "Unknown meeting." };
  const supabase = await createClient();
  const profile = await getUserProfile(supabase);
  if (!profile) return { ok: false, error: "Sign in to open Pulse." };
  const membership = await supabase.from("pulse_team_members").select("team, capability").eq("user_id", profile.id);
  if (isMissingPulseTable(membership.error)) {
    return {
      ok: true,
      userId: profile.id,
      team: team as OsTeam,
      isAdmin: isAdmin(profile),
      canEditBenchmarks: canEditBenchmarks(profile),
      facilitatorTeams: [],
      memberTeams: [...OS_TEAMS],
      canReadGiving: canReadGiving({ financialInsights: profile.financial_insights, isAdmin: isAdmin(profile) }),
      participant: true,
      tablesReady: false,
    };
  }
  if (membership.error) return { ok: false, error: membership.error.message };
  const rows = (membership.data ?? []) as { team?: string; capability?: string }[];
  const facilitatorTeams = OS_TEAMS.filter((item) =>
    rows.some((row) => row.team === item && row.capability === "facilitator")
  );
  const memberTeams = OS_TEAMS.filter((item) =>
    rows.some((row) => row.team === item && ["viewer", "contributor", "facilitator"].includes(row.capability ?? ""))
  );
  const participant = rows.some(
    (row) => row.team === team && ["viewer", "contributor", "facilitator"].includes(row.capability ?? "")
  );
  return {
    ok: true,
    userId: profile.id,
    team: team as OsTeam,
    isAdmin: isAdmin(profile),
    canEditBenchmarks: canEditBenchmarks(profile),
    facilitatorTeams,
    memberTeams,
    canReadGiving: canReadGiving({ financialInsights: profile.financial_insights, isAdmin: isAdmin(profile) }),
    participant,
    tablesReady: true,
  };
}

function canSee(auth: Actor): boolean {
  return canViewPlanning({ isAdmin: auth.isAdmin, participant: auth.participant || !auth.tablesReady });
}

export async function loadPlanningView(team: string): Promise<{ ok: true; view: PlanningView } | Denied> {
  const auth = await actor(team);
  if (!auth.ok) return auth;
  if (!canSee(auth)) return { ok: false, error: "You don't have access to that meeting." };
  if (!auth.tablesReady) return { ok: true, view: emptyPlanningView() };
  return readPlanningBundle(auth.team);
}

export async function loadSharedWork(team: string): Promise<{ ok: true; items: SharedWorkItem[] } | Denied> {
  const auth = await actor(team);
  if (!auth.ok) return auth;
  if (!canSee(auth)) return { ok: false, error: "You don't have access to that meeting." };
  if (!auth.tablesReady) return { ok: true, items: [] };
  const teams = auth.isAdmin ? OS_TEAMS : auth.memberTeams;
  return readSharedWork({ teams, canReadGiving: auth.canReadGiving });
}

export async function loadSeatView(team: string): Promise<{ ok: true; view: SeatView } | Denied> {
  const auth = await actor(team);
  if (!auth.ok) return auth;
  if (!canSee(auth)) return { ok: false, error: "You don't have access to that meeting." };
  if (!auth.tablesReady) return { ok: true, view: emptySeatView() };
  return readSeatBundle();
}

function scopeAllowed(auth: Actor, scope: string): Denied | { ok: true; scope: "church" | OsTeam } {
  if (!isPlanningScope(scope)) return { ok: false, error: "Unknown planning scope." };
  if (scope !== "church" && scope !== auth.team) {
    return { ok: false, error: "Open that team before editing its planning draft." };
  }
  if (!auth.tablesReady) return { ok: false, error: PLANNING_NOT_STORED };
  const allowed = planningWriteAllowed({
    scope,
    isAdmin: auth.isAdmin,
    canEditBenchmarks: auth.canEditBenchmarks,
    facilitatorTeams: auth.facilitatorTeams,
  });
  if (!allowed.ok) return { ok: false, error: allowed.reason };
  return { ok: true, scope };
}

export async function savePlanningDraft(input: {
  team: string;
  scope: string;
  key: string;
  content: unknown;
  expectedUpdatedAt: string | null;
}) {
  const auth = await actor(input.team);
  if (!auth.ok) return auth;
  const scope = scopeAllowed(auth, input.scope);
  if (!scope.ok) return scope;
  if (!isSectionKey(input.key)) return { ok: false as const, error: "Unknown planning section." };
  const parsed = parseSectionContent(input.key, input.content);
  if (!parsed.ok) return { ok: false, error: parsed.reason };
  const saved = await savePlanningSection({
    scope: scope.scope,
    key: input.key,
    content: parsed.content,
    expectedUpdatedAt: input.expectedUpdatedAt,
    actorId: auth.userId,
  });
  if (saved.ok) revalidatePath("/pulse");
  return saved;
}

export async function returnToChurchReference(input: { team: string; scope: string; key: string; expectedUpdatedAt: string }) {
  const auth = await actor(input.team);
  if (!auth.ok) return auth;
  const scope = scopeAllowed(auth, input.scope);
  if (!scope.ok) return scope;
  if (scope.scope === "church") return { ok: false as const, error: "The church-wide draft is already the shared reference." };
  if (!isSectionKey(input.key)) return { ok: false as const, error: "Unknown planning section." };
  const dropped = await dropPlanningSection({
    scope: scope.scope,
    key: input.key,
    expectedUpdatedAt: input.expectedUpdatedAt,
    actorId: auth.userId,
  });
  if (dropped.ok) revalidatePath("/pulse");
  return dropped;
}

export async function savePlanningSnapshot(input: { team: string; scope: string; rockIds: string[]; issueIds: string[] }) {
  const auth = await actor(input.team);
  if (!auth.ok) return auth;
  const scope = scopeAllowed(auth, input.scope);
  if (!scope.ok) return scope;
  const saved = await savePlanningVersion({
    team: auth.team,
    scope: scope.scope,
    rockIds: input.rockIds,
    issueIds: input.issueIds,
    actorId: auth.userId,
  });
  if (saved.ok) revalidatePath("/pulse");
  return saved;
}

export async function approvePlanningSnapshot(input: { team: string; versionId: string }) {
  const auth = await actor(input.team);
  if (!auth.ok) return auth;
  if (!canApprovePlan(auth)) return { ok: false as const, error: "Only an administrator can approve a planning version." };
  if (!auth.tablesReady) return { ok: false as const, error: PLANNING_NOT_STORED };
  const approved = await approvePlanningVersion({
    versionId: input.versionId,
    actorId: auth.userId,
    isAdmin: auth.isAdmin,
  });
  if (approved.ok) revalidatePath("/pulse");
  return approved;
}

export async function saveAccountabilitySeat(input: {
  team: string;
  id: string | null;
  title: string;
  functionLabel: string;
  personId: string | null;
  parentId: string | null;
  accountabilities: string[];
  expectedUpdatedAt: string | null;
}) {
  const auth = await actor(input.team);
  if (!auth.ok) return auth;
  if (!canManageSeats(auth)) return { ok: false as const, error: "Only an administrator can manage seats." };
  if (!auth.tablesReady) return { ok: false as const, error: PLANNING_NOT_STORED };
  const people = await readSeatBundle();
  if (!people.ok) return people;
  if (!people.view.stored) return { ok: false as const, error: PLANNING_NOT_STORED };
  const draft = validateSeatDraft({
    title: input.title,
    functionLabel: input.functionLabel,
    personId: input.personId,
    accountabilities: input.accountabilities,
    eligiblePersonIds: people.view.people.map((person) => person.id),
  });
  if (!draft.ok) return { ok: false, error: draft.reason };
  const saved = await saveSeat({
    id: input.id,
    title: draft.title,
    functionLabel: draft.functionLabel,
    personId: draft.personId,
    parentId: input.parentId,
    accountabilities: draft.accountabilities,
    expectedUpdatedAt: input.expectedUpdatedAt,
    actorId: auth.userId,
  });
  if (saved.ok) revalidatePath("/pulse");
  return saved;
}

export async function archiveAccountabilitySeat(input: {
  team: string;
  seatId: string;
  expectedUpdatedAt: string;
  subordinateChoice: ArchiveSubordinateChoice | null;
  referenceChoice: ArchiveReferenceChoice | null;
}) {
  const auth = await actor(input.team);
  if (!auth.ok) return auth;
  if (!canManageSeats(auth)) return { ok: false as const, error: "Only an administrator can manage seats." };
  if (!auth.tablesReady) return { ok: false as const, error: PLANNING_NOT_STORED };
  const archived = await archiveStoredSeat({
    seatId: input.seatId,
    expectedUpdatedAt: input.expectedUpdatedAt,
    subordinateChoice: input.subordinateChoice,
    referenceChoice: input.referenceChoice,
    actorId: auth.userId,
  });
  if (archived.ok) revalidatePath("/pulse");
  return archived;
}
