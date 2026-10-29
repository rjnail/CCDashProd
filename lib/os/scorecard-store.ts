import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isFictionalOwnerName } from "./owners";
import { SAVE_NOT_STORED, isMissingPulseTable } from "./pulse-db";
import {
  SCORECARD_READY_KEY,
  givingWriteAllowed,
  mergeTargetMap,
  omitRestrictedGiving,
  parseReading,
  parseScorecardNote,
  validateActualValue,
  type SelectionWrite,
} from "./scorecard";
import type { OsManualReading, OsScorecardNote, OsScorecardTarget, OsTeam, ScorecardUnit } from "./types";

export const SCORECARD_CONFLICT =
  "Someone else updated this scorecard. Your changes are still here. Review them and save again.";

const ADMIN_MISSING =
  "This edit was not stored. The server admin key is not configured. Your text is still here.";

type SaveFailure = { ok: false; error: string };
type ItemRecord = {
  id: string;
  team: OsTeam;
  title: string;
  details: Record<string, unknown>;
  metricKey: string | null;
  campus: string | null;
  periodLabel: string | null;
  ownerId: string | null;
  updatedAt: string | null;
  removedAt: string | null;
};

export type ScorecardDirectory = {
  loaded: boolean;
  missing: boolean;
  auditReady: boolean;
  notes: OsScorecardNote[];
  readings: OsManualReading[];
  configuredTeams: OsTeam[];
};

function adminClient(): SupabaseClient | null {
  try {
    return createAdminClient();
  } catch {
    return null;
  }
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
  return {};
}

function versionOf(details: Record<string, unknown>): number {
  return typeof details.version === "number" ? details.version : 1;
}

const ITEM_COLUMNS =
  "id, team, title, details, metric_key, campus, period_label, owner_id, updated_at, removed_at, kind";

function toRecord(row: {
  id: string;
  team: string;
  title: string;
  details: string | null;
  metric_key: string | null;
  campus: string | null;
  period_label: string | null;
  owner_id: string | null;
  updated_at: string | null;
  removed_at: string | null;
}): ItemRecord {
  return {
    id: row.id,
    team: row.team as OsTeam,
    title: row.title,
    details: asObject(row.details),
    metricKey: row.metric_key,
    campus: row.campus,
    periodLabel: row.period_label,
    ownerId: row.owner_id,
    updatedAt: row.updated_at,
    removedAt: row.removed_at,
  };
}

export async function readScorecardDirectory(): Promise<ScorecardDirectory> {
  const empty: ScorecardDirectory = {
    loaded: false,
    missing: false,
    auditReady: false,
    notes: [],
    readings: [],
    configuredTeams: [],
  };
  const admin = adminClient();
  if (!admin) return empty;
  const { data, error } = await admin.from("pulse_items").select(ITEM_COLUMNS).eq("kind", "headline");
  if (isMissingPulseTable(error)) return { ...empty, missing: true };
  if (error) return empty;
  const notes: OsScorecardNote[] = [];
  const readings: OsManualReading[] = [];
  const configuredTeams: OsTeam[] = [];
  for (const row of (data ?? []) as Parameters<typeof toRecord>[0][]) {
    if (row.removed_at) continue;
    const team = row.team as OsTeam;
    if (row.metric_key === SCORECARD_READY_KEY) {
      if (!configuredTeams.includes(team)) configuredTeams.push(team);
      continue;
    }
    const note = parseScorecardNote(team, {
      id: row.id,
      metricKey: row.metric_key,
      title: row.title,
      details: row.details,
      campus: row.campus,
      periodLabel: row.period_label,
      ownerId: row.owner_id,
      updatedAt: row.updated_at,
    });
    if (note) notes.push(note);
    const reading = parseReading(team, {
      id: row.id,
      metricKey: row.metric_key,
      details: row.details,
      campus: row.campus,
      periodLabel: row.period_label,
    });
    if (reading) readings.push(reading);
  }
  const audit = await admin.from("pulse_scorecard_audit").select("id").limit(1);
  return {
    loaded: true,
    missing: false,
    auditReady: !isMissingPulseTable(audit.error) && !audit.error,
    notes,
    readings,
    configuredTeams,
  };
}

async function roleColumn(admin: SupabaseClient): Promise<boolean> {
  const { error } = await admin.from("pulse_items").select("scorecard_role").limit(1);
  return !error;
}

async function writeAudit(
  admin: SupabaseClient,
  entries: {
    team: string | null;
    metric_key: string;
    scope: string;
    field_name: string;
    previous_value: string | null;
    new_value: string | null;
    reason: string;
    actor_id: string;
  }[]
): Promise<void> {
  if (entries.length === 0) return;
  await admin.from("pulse_scorecard_audit").insert(entries);
}

function appendAudit(details: Record<string, unknown>, entries: { field: string; previous: string; next: string; actorId: string; at: string; scope: string; reason: string }[]) {
  const prior = Array.isArray(details.audit) ? details.audit : [];
  return [...prior, ...entries].slice(-40);
}

async function updateItem(
  admin: SupabaseClient,
  row: ItemRecord,
  expectedVersion: number,
  details: Record<string, unknown>,
  extra: { ownerId?: string | null; title?: string; removedAt?: string | null; campus?: string; periodLabel?: string; scorecardRole?: string | null },
  withRole: boolean
): Promise<SaveFailure | { ok: true }> {
  if (versionOf(row.details) !== expectedVersion) return { ok: false, error: SCORECARD_CONFLICT };
  const payload: Record<string, unknown> = {
    details: JSON.stringify(details),
    updated_at: new Date().toISOString(),
  };
  if (extra.ownerId !== undefined) payload.owner_id = extra.ownerId;
  if (extra.title !== undefined) payload.title = extra.title;
  if (extra.removedAt !== undefined) payload.removed_at = extra.removedAt;
  if (extra.campus !== undefined) payload.campus = extra.campus;
  if (extra.periodLabel !== undefined) payload.period_label = extra.periodLabel;
  if (withRole && extra.scorecardRole !== undefined) payload.scorecard_role = extra.scorecardRole;
  let query = admin.from("pulse_items").update(payload).eq("id", row.id).eq("team", row.team);
  if (row.updatedAt) query = query.eq("updated_at", row.updatedAt);
  const { data, error } = await query.select("id");
  if (isMissingPulseTable(error)) return { ok: false, error: SAVE_NOT_STORED };
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: SCORECARD_CONFLICT };
  return { ok: true };
}

async function loadTeamHeadlines(admin: SupabaseClient, team: OsTeam): Promise<ItemRecord[] | "missing"> {
  const { data, error } = await admin.from("pulse_items").select(ITEM_COLUMNS).eq("team", team).eq("kind", "headline");
  if (isMissingPulseTable(error)) return "missing";
  if (error) throw new Error(error.message);
  return ((data ?? []) as Parameters<typeof toRecord>[0][]).map(toRecord);
}

async function loadMetricRows(admin: SupabaseClient, metricKey: string): Promise<ItemRecord[] | "missing"> {
  const { data, error } = await admin
    .from("pulse_items")
    .select(ITEM_COLUMNS)
    .eq("kind", "headline")
    .eq("metric_key", metricKey);
  if (isMissingPulseTable(error)) return "missing";
  if (error) throw new Error(error.message);
  return ((data ?? []) as Parameters<typeof toRecord>[0][]).map(toRecord);
}

function sameConfiguration(row: ItemRecord, campus: string, periodKind: string): boolean {
  return (row.campus || "church-wide") === campus && (row.periodLabel || "") === periodKind && !row.removedAt;
}

export async function memberName(admin: SupabaseClient, team: OsTeam, userId: string): Promise<string | null> {
  const member = await admin.from("pulse_team_members").select("user_id").eq("team", team).eq("user_id", userId).limit(1);
  if (isMissingPulseTable(member.error)) return null;
  if (!member.data?.length) return null;
  const profile = await admin.from("user_profiles").select("display_name").eq("id", userId).maybeSingle();
  const name = profile.data?.display_name?.trim() || "Team member";
  if (isFictionalOwnerName(name)) return null;
  return name;
}

export async function saveScorecardEdition(input: {
  team: OsTeam;
  canReadGiving: boolean;
  userId: string;
  actorName: string;
  metricKey: string;
  label: string;
  campus: string;
  periodKind: string;
  periodKey: string;
  expectedVersion: number | null;
  ownerUserId: string | null;
  ownerName: string;
  canEditTarget: boolean;
  target: number | null;
  unit: ScorecardUnit;
  statusMode: "automatic" | "manual";
  manualStatus: "on_track" | "needs_attention" | "off_track" | null;
  reason: string;
  manual: boolean;
  definition?: string;
  comparison?: OsScorecardNote["comparison"];
  rangeMin?: number | null;
  rangeMax?: number | null;
  attentionMin?: number | null;
  attentionMax?: number | null;
  explicitMax?: number | null;
  frequency?: string;
  published?: boolean;
  reading?: {
    value: number;
    periodStart: string;
    periodEnd: string;
    periodLabel: string;
    campus: string;
    unit: ScorecardUnit;
  } | null;
}): Promise<
  | { ok: true; note: OsScorecardNote; reading: OsManualReading | null; sharedValue: number | null }
  | SaveFailure
> {
  const gate = givingWriteAllowed({
    team: input.team,
    canReadGiving: input.canReadGiving,
    metricKey: input.metricKey,
    campus: input.campus,
  });
  if (!gate.allowed) return { ok: false, error: gate.reason };
  if (input.reading) {
    const readingGate = givingWriteAllowed({
      team: input.team,
      canReadGiving: input.canReadGiving,
      metricKey: input.metricKey,
      campus: input.reading.campus,
    });
    if (!readingGate.allowed) return { ok: false, error: readingGate.reason };
  }
  const admin = adminClient();
  if (!admin) return { ok: false, error: ADMIN_MISSING };
  const rows = await loadMetricRows(admin, input.metricKey);
  if (rows === "missing") return { ok: false, error: SAVE_NOT_STORED };
  const mine = rows.find(
    (row) => row.team === input.team && sameConfiguration(row, input.campus, input.periodKind) && asObject(row.details).role !== "reading"
  );
  if (input.expectedVersion == null && mine) return { ok: false, error: SCORECARD_CONFLICT };
  if (input.expectedVersion != null && (!mine || versionOf(mine.details) !== input.expectedVersion)) {
    return { ok: false, error: SCORECARD_CONFLICT };
  }
  const now = new Date().toISOString();
  const withRole = await roleColumn(admin);
  const previous = mine
    ? parseScorecardNote(input.team, {
        id: mine.id,
        metricKey: mine.metricKey,
        title: mine.title,
        details: mine.details,
        campus: mine.campus,
        periodLabel: mine.periodLabel,
        ownerId: mine.ownerId,
        updatedAt: mine.updatedAt,
      })
    : null;
  const previousTarget = previous?.targets[input.periodKey]?.value ?? null;
  const nextTarget: OsScorecardTarget | null =
    input.target == null
      ? null
      : { value: input.target, unit: input.unit, setBy: input.userId, setAt: now };
  const targets = input.canEditTarget
    ? mergeTargetMap(previous?.targets ?? {}, input.periodKey, nextTarget)
    : { ...(previous?.targets ?? {}) };
  const base = mine?.details ?? {};
  const auditRows: {
    field: string;
    previous: string;
    next: string;
    actorId: string;
    at: string;
    scope: string;
    reason: string;
  }[] = [];
  const scope = `${input.campus}|${input.periodKind}|${input.periodKey}`;
  function track(field: string, previousValue: string, nextValue: string, reason = "") {
    if (previousValue === nextValue) return;
    auditRows.push({
      field,
      previous: previousValue,
      next: nextValue,
      actorId: input.userId,
      at: now,
      scope,
      reason,
    });
  }
  track("owner", previous?.ownerUserId ?? "", input.ownerUserId ?? "");
  if (input.canEditTarget) track("target", previousTarget == null ? "" : String(previousTarget), input.target == null ? "" : String(input.target));
  track("status", previous?.statusMode === "manual" ? previous.manualStatus ?? "manual" : "automatic", input.statusMode === "manual" ? input.manualStatus ?? "manual" : "automatic", input.reason);
  const details: Record<string, unknown> = {
    ...base,
    role: input.manual ? "manual" : "scorecard",
    owner: input.ownerName,
    ownerUserId: input.ownerUserId,
    target: input.canEditTarget ? (input.target == null ? "" : String(input.target)) : textOr(base.target),
    targets,
    statusMode: input.statusMode,
    manualStatus: input.statusMode === "manual" ? input.manualStatus : null,
    overrideReason: input.statusMode === "manual" ? input.reason.trim() : "",
    statusSetBy: input.statusMode === "manual" ? input.userId : "",
    statusSetByName: input.statusMode === "manual" ? input.actorName : "",
    statusSetAt: input.statusMode === "manual" ? now : null,
    statusPeriodKey: input.statusMode === "manual" ? input.periodKey : "",
    version: (previous?.version ?? 0) + 1,
    sortOrder: previous?.sortOrder ?? 0,
    campus: input.campus,
    periodKind: input.periodKind,
    definition: input.definition ?? previous?.definition ?? "",
    unit: input.unit,
    frequency: input.frequency ?? previous?.frequency ?? input.periodKind,
    comparison: input.comparison ?? previous?.comparison ?? "higher",
    rangeMin: input.rangeMin ?? previous?.rangeMin ?? null,
    rangeMax: input.rangeMax ?? previous?.rangeMax ?? null,
    attentionMin: input.attentionMin ?? previous?.attentionMin ?? null,
    attentionMax: input.attentionMax ?? previous?.attentionMax ?? null,
    explicitMax: input.explicitMax ?? previous?.explicitMax ?? null,
    published: input.published ?? previous?.published ?? false,
    audit: appendAudit(base, auditRows),
  };
  delete details.sourceValue;
  if (!input.manual) delete details.manualValue;

  const siblings = rows.filter(
    (row) =>
      row.id !== mine?.id &&
      !row.removedAt &&
      sameConfiguration(row, input.campus, input.periodKind) &&
      asObject(row.details).role !== "reading" &&
      row.metricKey !== SCORECARD_READY_KEY
  );
  if (input.reading) {
    const capped = validateActualValue({
      value: input.reading.value,
      unit: input.reading.unit,
      explicitMax: previous?.explicitMax ?? null,
    });
    if (capped) return { ok: false, error: capped };
  }
  const roleName = "selection";
  let savedId = mine?.id ?? "";
  if (input.canEditTarget) {
    for (const sibling of siblings) {
      const siblingGate = givingWriteAllowed({
        team: sibling.team,
        canReadGiving: input.canReadGiving,
        metricKey: sibling.metricKey,
        campus: sibling.campus,
      });
      if (!siblingGate.allowed) continue;
      const siblingTargets = parseScorecardNote(sibling.team, {
        id: sibling.id,
        metricKey: sibling.metricKey,
        title: sibling.title,
        details: sibling.details,
        campus: sibling.campus,
        periodLabel: sibling.periodLabel,
        ownerId: sibling.ownerId,
        updatedAt: sibling.updatedAt,
      })?.targets;
      const merged = mergeTargetMap(siblingTargets ?? {}, input.periodKey, nextTarget);
      const siblingDetails: Record<string, unknown> = {
        ...sibling.details,
        targets: merged,
        target: input.target == null ? "" : String(input.target),
        version: versionOf(sibling.details) + 1,
      };
      delete siblingDetails.sourceValue;
      const wrote = await updateItem(admin, sibling, versionOf(sibling.details), siblingDetails, {}, withRole);
      if (!wrote.ok) return wrote;
    }
  }
  if (!mine) {
    const payload: Record<string, unknown> = {
      team: input.team,
      kind: "headline",
      title: input.label.slice(0, 180),
      details: JSON.stringify(details),
      metric_key: input.metricKey,
      campus: input.campus,
      period_label: input.periodKind,
      owner_id: input.ownerUserId,
      created_by: input.userId,
      decision: "",
    };
    if (withRole) payload.scorecard_role = roleName;
    const inserted = await admin.from("pulse_items").insert(payload).select("id").single();
    if (isMissingPulseTable(inserted.error)) return { ok: false, error: SAVE_NOT_STORED };
    if (inserted.error?.code === "23505") {
      return { ok: false, error: "That measure, campus, and reporting period are already on this scorecard." };
    }
    if (inserted.error || !inserted.data) return { ok: false, error: inserted.error?.message ?? "The scorecard could not be saved." };
    savedId = inserted.data.id as string;
  } else {
    const saved = await updateItem(
      admin,
      mine,
      input.expectedVersion ?? versionOf(mine.details),
      details,
      { ownerId: input.ownerUserId, title: input.label.slice(0, 180), scorecardRole: roleName },
      withRole
    );
    if (!saved.ok) return saved;
    savedId = mine.id;
  }

  let reading: OsManualReading | null = null;
  if (input.reading) {
    const createdAt = now;
    const readingDetails = {
      role: "reading",
      value: input.reading.value,
      unit: input.reading.unit,
      periodStart: input.reading.periodStart,
      periodEnd: input.reading.periodEnd,
      periodLabel: input.reading.periodLabel,
      campus: input.reading.campus,
      actorId: input.userId,
      actorName: input.actorName,
      createdAt,
      correctsId: null,
    };
    const payload: Record<string, unknown> = {
      team: input.team,
      kind: "headline",
      title: input.label.slice(0, 180),
      details: JSON.stringify(readingDetails),
      metric_key: input.metricKey,
      campus: input.reading.campus,
      period_label: input.reading.periodLabel,
      created_by: input.userId,
      decision: "",
    };
    if (withRole) payload.scorecard_role = "reading";
    const inserted = await admin.from("pulse_items").insert(payload).select("id").single();
    if (isMissingPulseTable(inserted.error)) return { ok: false, error: SAVE_NOT_STORED };
    if (inserted.error || !inserted.data) return { ok: false, error: inserted.error?.message ?? "The actual could not be saved." };
    reading = {
      id: inserted.data.id as string,
      metricKey: input.metricKey,
      team: input.team,
      campus: input.reading.campus,
      periodStart: input.reading.periodStart,
      periodEnd: input.reading.periodEnd,
      periodLabel: input.reading.periodLabel,
      value: input.reading.value,
      unit: input.reading.unit,
      actorId: input.userId,
      actorName: input.actorName,
      createdAt,
      correctsId: null,
    };
    track("reading", "", String(input.reading.value), `${input.reading.campus} ${input.reading.periodLabel}`);
  }

  await writeAudit(
    admin,
    auditRows.map((entry) => ({
      team: input.team,
      metric_key: input.metricKey,
      scope: entry.scope,
      field_name: entry.field,
      previous_value: entry.previous,
      new_value: entry.next,
      reason: entry.reason,
      actor_id: input.userId,
    }))
  );

  const note = parseScorecardNote(input.team, {
    id: savedId,
    metricKey: input.metricKey,
    title: input.label,
    details,
    campus: input.campus,
    periodLabel: input.periodKind,
    ownerId: input.ownerUserId,
    updatedAt: now,
  });
  if (!note) return { ok: false, error: "The scorecard could not be saved." };
  return { ok: true, note, reading, sharedValue: input.canEditTarget ? input.target : previousTarget };
}

function textOr(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function applySelectionWrites(input: {
  team: OsTeam;
  canReadGiving: boolean;
  userId: string;
  actorName: string;
  writes: SelectionWrite[];
  templates: Record<string, Record<string, unknown>>;
}): Promise<{ ok: true; notes: OsScorecardNote[]; configured: boolean } | SaveFailure> {
  if (input.writes.some((write) => write.team !== input.team)) {
    return { ok: false, error: "That change belongs to another team." };
  }
  const admin = adminClient();
  if (!admin) return { ok: false, error: ADMIN_MISSING };
  const rows = await loadTeamHeadlines(admin, input.team);
  if (rows === "missing") return { ok: false, error: SAVE_NOT_STORED };
  for (const write of input.writes) {
    if (write.op === "insert" || write.op === "restore" || write.op === "order") {
      const row = write.op === "insert" ? null : rows.find((item) => item.id === write.id);
      const gate = givingWriteAllowed({
        team: input.team,
        canReadGiving: input.canReadGiving,
        metricKey: write.op === "insert" ? write.metricKey : row?.metricKey,
        campus: write.op === "insert" ? write.campus : row?.campus,
      });
      if (!gate.allowed) return { ok: false, error: gate.reason };
    }
    if (write.op === "insert") {
      const clash = rows.find(
        (row) =>
          !row.removedAt &&
          row.metricKey === write.metricKey &&
          (row.campus || "church-wide") === write.campus &&
          (row.periodLabel || "") === write.periodKind &&
          asObject(row.details).role !== "reading"
      );
      if (clash) return { ok: false, error: "That measure, campus, and reporting period are already on this scorecard." };
    }
    if (write.op === "restore" || write.op === "remove" || write.op === "order") {
      const row = rows.find((item) => item.id === write.id);
      if (!row || versionOf(row.details) !== write.expectedVersion) return { ok: false, error: SCORECARD_CONFLICT };
    }
  }
  const withRole = await roleColumn(admin);
  const now = new Date().toISOString();
  for (const write of input.writes) {
    if (write.op === "meta") {
      const existing = rows.find((row) => row.metricKey === SCORECARD_READY_KEY && !row.removedAt);
      if (existing) continue;
      const payload: Record<string, unknown> = {
        team: input.team,
        kind: "headline",
        title: "Scorecard selections",
        details: JSON.stringify({ role: "meta", version: 1 }),
        metric_key: SCORECARD_READY_KEY,
        campus: "church-wide",
        period_label: "meta",
        created_by: input.userId,
        decision: "",
      };
      if (withRole) payload.scorecard_role = "meta";
      const inserted = await admin.from("pulse_items").insert(payload);
      if (isMissingPulseTable(inserted.error)) return { ok: false, error: SAVE_NOT_STORED };
      if (inserted.error) return { ok: false, error: inserted.error.message };
      continue;
    }
    if (write.op === "insert") {
      const removed = rows.find(
        (row) =>
          row.removedAt &&
          row.metricKey === write.metricKey &&
          (row.campus || "church-wide") === write.campus &&
          (row.periodLabel || "") === write.periodKind
      );
      if (removed) {
        const details = {
          ...removed.details,
          ownerUserId: write.ownerUserId,
          sortOrder: write.sortOrder,
          version: versionOf(removed.details) + 1,
        };
        const saved = await updateItem(
          admin,
          removed,
          versionOf(removed.details),
          details,
          { removedAt: null, ownerId: write.ownerUserId, scorecardRole: "selection" },
          withRole
        );
        if (!saved.ok) return saved;
        continue;
      }
      const template = input.templates[write.metricKey] ?? {};
      const details = {
        role: template.role === "manual" ? "manual" : "scorecard",
        owner: typeof template.owner === "string" ? template.owner : "",
        ownerUserId: write.ownerUserId,
        target: typeof template.target === "string" ? template.target : "",
        targets: template.targets ?? {},
        statusMode: "automatic",
        manualStatus: null,
        overrideReason: "",
        version: 1,
        sortOrder: write.sortOrder,
        campus: write.campus,
        periodKind: write.periodKind,
        definition: template.definition ?? "",
        unit: template.unit ?? "count",
        frequency: template.frequency ?? write.periodKind,
        comparison: template.comparison ?? "higher",
        rangeMin: template.rangeMin ?? null,
        rangeMax: template.rangeMax ?? null,
        attentionMin: template.attentionMin ?? null,
        attentionMax: template.attentionMax ?? null,
        explicitMax: template.explicitMax ?? null,
        published: template.published === true,
        audit: [
          {
            field: "selection",
            previous: "",
            next: write.metricKey,
            actorId: input.userId,
            at: now,
            scope: `${write.campus}|${write.periodKind}`,
            reason: "",
          },
        ],
      };
      const payload: Record<string, unknown> = {
        team: input.team,
        kind: "headline",
        title: write.label.slice(0, 180),
        details: JSON.stringify(details),
        metric_key: write.metricKey,
        campus: write.campus,
        period_label: write.periodKind,
        owner_id: write.ownerUserId,
        created_by: input.userId,
        decision: "",
      };
      if (withRole) payload.scorecard_role = "selection";
      const inserted = await admin.from("pulse_items").insert(payload);
      if (isMissingPulseTable(inserted.error)) return { ok: false, error: SAVE_NOT_STORED };
      if (inserted.error?.code === "23505") {
        return { ok: false, error: "That measure, campus, and reporting period are already on this scorecard." };
      }
      if (inserted.error) return { ok: false, error: inserted.error.message };
      await writeAudit(admin, [
        {
          team: input.team,
          metric_key: write.metricKey,
          scope: `${write.campus}|${write.periodKind}`,
          field_name: "selection",
          previous_value: "",
          new_value: write.metricKey,
          reason: "",
          actor_id: input.userId,
        },
      ]);
      continue;
    }
    const row = rows.find((item) => item.id === write.id);
    if (!row) return { ok: false, error: SCORECARD_CONFLICT };
    if (write.op === "remove") {
      const details = { ...row.details, version: versionOf(row.details) + 1 };
      const saved = await updateItem(admin, row, write.expectedVersion, details, { removedAt: now, scorecardRole: "selection" }, withRole);
      if (!saved.ok) return saved;
      await writeAudit(admin, [
        {
          team: input.team,
          metric_key: row.metricKey ?? "",
          scope: `${row.campus}|${row.periodLabel}`,
          field_name: "selection",
          previous_value: row.metricKey,
          new_value: "",
          reason: "Removed from this team",
          actor_id: input.userId,
        },
      ]);
      continue;
    }
    if (write.op === "restore") {
      const details = {
        ...row.details,
        ownerUserId: write.ownerUserId,
        sortOrder: write.sortOrder,
        version: versionOf(row.details) + 1,
      };
      const saved = await updateItem(
        admin,
        row,
        write.expectedVersion,
        details,
        { removedAt: null, ownerId: write.ownerUserId, scorecardRole: "selection" },
        withRole
      );
      if (!saved.ok) return saved;
      continue;
    }
    const details = { ...row.details, sortOrder: write.sortOrder, version: versionOf(row.details) + 1 };
    const saved = await updateItem(admin, row, write.expectedVersion, details, { scorecardRole: "selection" }, withRole);
    if (!saved.ok) return saved;
  }
  const fresh = await loadTeamHeadlines(admin, input.team);
  if (fresh === "missing") return { ok: false, error: SAVE_NOT_STORED };
  const notes = fresh
    .filter((row) => !row.removedAt)
    .map((row) =>
      parseScorecardNote(input.team, {
        id: row.id,
        metricKey: row.metricKey,
        title: row.title,
        details: row.details,
        campus: row.campus,
        periodLabel: row.periodLabel,
        ownerId: row.ownerId,
        updatedAt: row.updatedAt,
      })
    )
    .filter((note): note is OsScorecardNote => Boolean(note));
  return {
    ok: true,
    notes: omitRestrictedGiving(notes, input.team, input.canReadGiving),
    configured: fresh.some((row) => row.metricKey === SCORECARD_READY_KEY && !row.removedAt),
  };
}
