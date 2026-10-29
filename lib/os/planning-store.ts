import { createAdminClient } from "@/lib/supabase/admin";
import { isFictionalOwnerName } from "./owners";
import {
  PLANNING_NOT_STORED,
  activeSeats,
  approveVersion,
  archiveSeat,
  buildVersion,
  concurrentEditResult,
  eligiblePeople,
  emptyPlanningView,
  emptySeatView,
  isPlanningScope,
  isSectionKey,
  parentChoiceAllowed,
  parseSectionContent,
  seatRowForSave,
  verifiedRecordRefs,
  type ArchiveReferenceChoice,
  type SharedWorkItem,
  type ArchiveSubordinateChoice,
  type PlanningScope,
  type PlanningVersion,
  type PlanningVersionView,
  type PlanningView,
  type SeatNode,
  type SeatReference,
  type SeatView,
  type SectionContent,
  type SectionKey,
  type SectionRecord,
} from "./planning";
import { isMissingPulseTable } from "./pulse-db";
import { OS_TEAMS, type OsIssueStatus, type OsRockStatus, type OsTeam } from "./types";

type Fail = { ok: false; error: string; conflict?: boolean };
type QueryError = { code?: string; message?: string } | null;

const CONFLICT = "Someone else saved this. Reload it before saving so their changes are not overwritten.";

function missingStore(error: QueryError): boolean {
  if (isMissingPulseTable(error)) return true;
  const message = (error?.message ?? "").toLowerCase();
  return message.includes("could not find the function") || message.includes("schema cache");
}

function safeError(error: QueryError, fallback: string): string {
  const message = error?.message ?? "";
  if (!message || /key|secret|token|password/i.test(message)) return fallback;
  return message;
}

function admin() {
  try {
    return createAdminClient();
  } catch {
    return null;
  }
}

type Admin = NonNullable<ReturnType<typeof admin>>;

async function displayNames(client: Admin, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const names = new Map<string, string>();
  if (unique.length === 0) return names;
  const { data, error } = await client.from("user_profiles").select("id, display_name").in("id", unique);
  if (error || !data) return names;
  for (const row of data as { id?: string; display_name?: string | null }[]) {
    const name = row.display_name?.trim() ?? "";
    if (!row.id || !name || isFictionalOwnerName(name)) continue;
    names.set(row.id, name);
  }
  return names;
}

function toRecord(
  row: {
    scope: string;
    section_key: string;
    content: unknown;
    updated_at: string;
    updated_by: string | null;
  },
  names: Map<string, string>
): SectionRecord | null {
  if (!isPlanningScope(row.scope) || !isSectionKey(row.section_key)) return null;
  const parsed = parseSectionContent(row.section_key, row.content);
  if (!parsed.ok) return null;
  return {
    scope: row.scope,
    key: row.section_key,
    content: parsed.content,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by ?? "",
    updatedByName: row.updated_by ? (names.get(row.updated_by) ?? null) : null,
  };
}

function parseVersionSections(value: unknown): PlanningVersion["sections"] {
  if (!Array.isArray(value)) return [];
  const sections: PlanningVersion["sections"] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as { key?: unknown; content?: unknown; inherited?: unknown };
    if (typeof record.key !== "string" || !isSectionKey(record.key)) continue;
    const parsed = parseSectionContent(record.key, record.content);
    if (!parsed.ok) continue;
    sections.push({ key: record.key, content: parsed.content, inherited: record.inherited === true });
  }
  return sections;
}

function parseRefs(value: unknown): { rocks: string[]; issues: string[] } {
  const record = value && typeof value === "object" ? (value as { rocks?: unknown; issues?: unknown }) : {};
  const ids = (list: unknown) => (Array.isArray(list) ? list.filter((id): id is string => typeof id === "string") : []);
  return { rocks: ids(record.rocks), issues: ids(record.issues) };
}

function bucket(records: SectionRecord[], team: OsTeam): Pick<PlanningView, "church" | "own"> {
  const church: PlanningView["church"] = {};
  const own: PlanningView["own"] = {};
  for (const record of records) {
    if (record.scope === "church") church[record.key] = record;
    if (record.scope === team) own[record.key] = record;
  }
  return { church, own };
}

export async function readPlanningBundle(team: OsTeam): Promise<{ ok: true; view: PlanningView } | Fail> {
  const client = admin();
  if (!client) return { ok: true, view: emptyPlanningView() };
  const sections = await client
    .from("pulse_planning_sections")
    .select("scope, section_key, content, updated_at, updated_by")
    .in("scope", ["church", team]);
  if (missingStore(sections.error)) return { ok: true, view: emptyPlanningView() };
  if (sections.error) return { ok: false, error: safeError(sections.error, PLANNING_NOT_STORED) };

  const versions = await client
    .from("pulse_planning_versions")
    .select("id, scope, author_id, created_at, sections, record_refs")
    .in("scope", ["church", team])
    .order("created_at", { ascending: false })
    .limit(40);
  if (missingStore(versions.error)) return { ok: true, view: emptyPlanningView() };
  if (versions.error) return { ok: false, error: safeError(versions.error, PLANNING_NOT_STORED) };

  const publications = await client
    .from("pulse_planning_publications")
    .select("version_id")
    .in("scope", ["church", team]);
  if (missingStore(publications.error)) return { ok: true, view: emptyPlanningView() };
  if (publications.error) return { ok: false, error: safeError(publications.error, PLANNING_NOT_STORED) };

  const sectionRows = (sections.data ?? []) as {
    scope: string;
    section_key: string;
    content: unknown;
    updated_at: string;
    updated_by: string | null;
  }[];
  const versionRows = (versions.data ?? []) as {
    id: string;
    scope: string;
    author_id: string | null;
    created_at: string;
    sections: unknown;
    record_refs: unknown;
  }[];
  const names = await displayNames(client, [
    ...sectionRows.map((row) => row.updated_by ?? ""),
    ...versionRows.map((row) => row.author_id ?? ""),
  ]);
  const records = sectionRows.map((row) => toRecord(row, names)).filter((row): row is SectionRecord => Boolean(row));
  const parsedVersions: PlanningVersionView[] = [];
  for (const row of versionRows) {
    if (!isPlanningScope(row.scope)) continue;
    parsedVersions.push({
      id: row.id,
      scope: row.scope,
      authorId: row.author_id ?? "",
      authorName: row.author_id ? (names.get(row.author_id) ?? null) : null,
      createdAt: row.created_at,
      sections: parseVersionSections(row.sections),
      recordRefs: parseRefs(row.record_refs),
    });
  }
  return {
    ok: true,
    view: {
      stored: true,
      migrationFile: emptyPlanningView().migrationFile,
      ...bucket(records, team),
      versions: parsedVersions,
      approvedVersionIds: ((publications.data ?? []) as { version_id?: string }[])
        .map((row) => row.version_id)
        .filter((id): id is string => Boolean(id)),
    },
  };
}

async function writeAudit(
  client: Admin,
  input: { scope: string; sectionKey: string | null; previous: unknown; next: unknown; actorId: string }
): Promise<Fail | { ok: true }> {
  const inserted = await client.from("pulse_planning_audit").insert({
    scope: input.scope,
    section_key: input.sectionKey,
    previous_value: input.previous,
    new_value: input.next,
    actor_id: input.actorId,
  });
  if (missingStore(inserted.error)) return { ok: false, error: PLANNING_NOT_STORED };
  if (inserted.error) return { ok: false, error: safeError(inserted.error, "The audit record could not be written.") };
  return { ok: true };
}

export async function savePlanningSection(input: {
  scope: PlanningScope;
  key: SectionKey;
  content: SectionContent;
  expectedUpdatedAt: string | null;
  actorId: string;
}): Promise<{ ok: true; record: SectionRecord } | Fail> {
  const client = admin();
  if (!client) return { ok: false, error: PLANNING_NOT_STORED };
  const existing = await client
    .from("pulse_planning_sections")
    .select("scope, section_key, content, updated_at, updated_by")
    .eq("scope", input.scope)
    .eq("section_key", input.key)
    .maybeSingle();
  if (missingStore(existing.error)) return { ok: false, error: PLANNING_NOT_STORED };
  if (existing.error) return { ok: false, error: safeError(existing.error, PLANNING_NOT_STORED) };
  const current = existing.data as { content: unknown; updated_at: string } | null;
  const decision = concurrentEditResult(input.expectedUpdatedAt, current?.updated_at ?? null);
  if (decision === "conflict") return { ok: false, error: CONFLICT, conflict: true };

  const payload = {
    scope: input.scope,
    section_key: input.key,
    content: input.content,
    updated_at: new Date().toISOString(),
    updated_by: input.actorId,
  };
  const written =
    decision === "insert"
      ? await client.from("pulse_planning_sections").insert(payload).select("scope, section_key, content, updated_at, updated_by").maybeSingle()
      : await client
          .from("pulse_planning_sections")
          .update(payload)
          .eq("scope", input.scope)
          .eq("section_key", input.key)
          .eq("updated_at", input.expectedUpdatedAt)
          .select("scope, section_key, content, updated_at, updated_by")
          .maybeSingle();
  if (missingStore(written.error)) return { ok: false, error: PLANNING_NOT_STORED };
  if (written.error?.code === "23505" || written.error?.code === "PGRST116") {
    return { ok: false, error: CONFLICT, conflict: true };
  }
  if (written.error) return { ok: false, error: safeError(written.error, PLANNING_NOT_STORED) };
  if (!written.data) return { ok: false, error: CONFLICT, conflict: true };

  const audit = await writeAudit(client, {
    scope: input.scope,
    sectionKey: input.key,
    previous: current?.content ?? null,
    next: input.content,
    actorId: input.actorId,
  });
  if (!audit.ok) return audit;
  const names = await displayNames(client, [input.actorId]);
  const record = toRecord(written.data as SectionRecordRow, names);
  if (!record) return { ok: false, error: "The saved section could not be read back." };
  return { ok: true, record };
}

type SectionRecordRow = {
  scope: string;
  section_key: string;
  content: unknown;
  updated_at: string;
  updated_by: string | null;
};

export async function dropPlanningSection(input: {
  scope: OsTeam;
  key: SectionKey;
  expectedUpdatedAt: string;
  actorId: string;
}): Promise<{ ok: true } | Fail> {
  const client = admin();
  if (!client) return { ok: false, error: PLANNING_NOT_STORED };
  const existing = await client
    .from("pulse_planning_sections")
    .select("content, updated_at")
    .eq("scope", input.scope)
    .eq("section_key", input.key)
    .maybeSingle();
  if (missingStore(existing.error)) return { ok: false, error: PLANNING_NOT_STORED };
  if (existing.error) return { ok: false, error: safeError(existing.error, PLANNING_NOT_STORED) };
  const current = existing.data as { content: unknown; updated_at: string } | null;
  if (!current) return { ok: true };
  if (concurrentEditResult(input.expectedUpdatedAt, current.updated_at) === "conflict") {
    return { ok: false, error: CONFLICT, conflict: true };
  }
  const removed = await client
    .from("pulse_planning_sections")
    .delete()
    .eq("scope", input.scope)
    .eq("section_key", input.key)
    .eq("updated_at", input.expectedUpdatedAt)
    .select("id");
  if (missingStore(removed.error)) return { ok: false, error: PLANNING_NOT_STORED };
  if (removed.error) return { ok: false, error: safeError(removed.error, PLANNING_NOT_STORED) };
  if (!removed.data || removed.data.length === 0) return { ok: false, error: CONFLICT, conflict: true };
  return writeAudit(client, {
    scope: input.scope,
    sectionKey: input.key,
    previous: current.content,
    next: null,
    actorId: input.actorId,
  });
}

export async function savePlanningVersion(input: {
  team: OsTeam;
  scope: PlanningScope;
  rockIds: string[];
  issueIds: string[];
  actorId: string;
}): Promise<{ ok: true; version: PlanningVersionView } | Fail> {
  const client = admin();
  if (!client) return { ok: false, error: PLANNING_NOT_STORED };
  const bundle = await readPlanningBundle(input.team);
  if (!bundle.ok) return bundle;
  if (!bundle.view.stored) return { ok: false, error: PLANNING_NOT_STORED };
  const teams = input.scope === "church" ? [...OS_TEAMS] : [input.team];
  const items = await client
    .from("pulse_items")
    .select("id, kind")
    .in("team", teams)
    .in("kind", ["rock", "issue"])
    .is("removed_at", null);
  if (missingStore(items.error)) return { ok: false, error: PLANNING_NOT_STORED };
  if (items.error) return { ok: false, error: safeError(items.error, PLANNING_NOT_STORED) };
  const existing = { rocks: [] as string[], issues: [] as string[] };
  for (const row of (items.data ?? []) as { id?: string; kind?: string }[]) {
    if (!row.id) continue;
    if (row.kind === "rock") existing.rocks.push(row.id);
    if (row.kind === "issue") existing.issues.push(row.id);
  }
  const refs = verifiedRecordRefs({ rocks: input.rockIds, issues: input.issueIds }, existing);
  const version = buildVersion({
    id: crypto.randomUUID(),
    scope: input.scope,
    authorId: input.actorId,
    createdAt: new Date().toISOString(),
    church: bundle.view.church,
    own: input.scope === "church" ? {} : bundle.view.own,
    rockIds: refs.rocks,
    issueIds: refs.issues,
  });
  const inserted = await client
    .from("pulse_planning_versions")
    .insert({
      id: version.id,
      scope: version.scope,
      author_id: input.actorId,
      created_at: version.createdAt,
      sections: version.sections,
      record_refs: version.recordRefs,
    })
    .select("id")
    .maybeSingle();
  if (missingStore(inserted.error)) return { ok: false, error: PLANNING_NOT_STORED };
  if (inserted.error) return { ok: false, error: safeError(inserted.error, PLANNING_NOT_STORED) };
  const audit = await writeAudit(client, {
    scope: input.scope,
    sectionKey: null,
    previous: null,
    next: { versionId: version.id, recordRefs: version.recordRefs },
    actorId: input.actorId,
  });
  if (!audit.ok) return audit;
  const names = await displayNames(client, [input.actorId]);
  return { ok: true, version: { ...version, authorName: names.get(input.actorId) ?? null } };
}

export async function approvePlanningVersion(input: {
  versionId: string;
  actorId: string;
  isAdmin: boolean;
}): Promise<{ ok: true; versionId: string } | Fail> {
  const client = admin();
  if (!client) return { ok: false, error: PLANNING_NOT_STORED };
  const loaded = await client
    .from("pulse_planning_versions")
    .select("id, scope, author_id, created_at, sections, record_refs")
    .eq("id", input.versionId)
    .maybeSingle();
  if (missingStore(loaded.error)) return { ok: false, error: PLANNING_NOT_STORED };
  if (loaded.error) return { ok: false, error: safeError(loaded.error, PLANNING_NOT_STORED) };
  const row = loaded.data as {
    id: string;
    scope: string;
    author_id: string | null;
    created_at: string;
    sections: unknown;
    record_refs: unknown;
  } | null;
  if (!row || !isPlanningScope(row.scope)) return { ok: false, error: "That saved version is not available." };
  const existingPublication = await client
    .from("pulse_planning_publications")
    .select("id")
    .eq("version_id", row.id)
    .maybeSingle();
  if (missingStore(existingPublication.error)) return { ok: false, error: PLANNING_NOT_STORED };
  if (existingPublication.error) return { ok: false, error: safeError(existingPublication.error, PLANNING_NOT_STORED) };
  const version: PlanningVersion = {
    id: row.id,
    scope: row.scope,
    authorId: row.author_id ?? "",
    createdAt: row.created_at,
    sections: parseVersionSections(row.sections),
    recordRefs: parseRefs(row.record_refs),
  };
  const decision = approveVersion({
    version,
    alreadyApproved: Boolean(existingPublication.data),
    isAdmin: input.isAdmin,
    actorId: input.actorId,
    at: new Date().toISOString(),
    id: crypto.randomUUID(),
  });
  if (!decision.ok) return { ok: false, error: decision.reason };
  const inserted = await client.from("pulse_planning_publications").insert({
    id: decision.publication.id,
    version_id: decision.publication.versionId,
    scope: decision.publication.scope,
    status: decision.publication.status,
    actor_id: decision.publication.actorId,
    created_at: decision.publication.createdAt,
  });
  if (missingStore(inserted.error)) return { ok: false, error: PLANNING_NOT_STORED };
  if (inserted.error?.code === "23505") return { ok: false, error: "That version is already approved." };
  if (inserted.error) return { ok: false, error: safeError(inserted.error, PLANNING_NOT_STORED) };
  const audit = await writeAudit(client, {
    scope: decision.publication.scope,
    sectionKey: null,
    previous: { versionId: version.id, status: "draft" },
    next: { versionId: version.id, status: "approved" },
    actorId: input.actorId,
  });
  if (!audit.ok) return audit;
  return { ok: true, versionId: version.id };
}

function toSeat(
  row: {
    id: string;
    title: string;
    function_label: string;
    person_id: string | null;
    parent_id: string | null;
    accountabilities: unknown;
    updated_at: string;
    archived_at: string | null;
  },
  names: Map<string, string>
): SeatNode {
  const accountabilities = Array.isArray(row.accountabilities)
    ? row.accountabilities.filter((item): item is string => typeof item === "string")
    : [];
  return {
    id: row.id,
    title: row.title,
    functionLabel: row.function_label,
    personId: row.person_id,
    personName: row.person_id ? (names.get(row.person_id) ?? null) : null,
    parentId: row.parent_id,
    accountabilities,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

export async function readSeatBundle(): Promise<{ ok: true; view: SeatView } | Fail> {
  const client = admin();
  if (!client) return { ok: true, view: emptySeatView() };
  const seats = await client
    .from("pulse_seats")
    .select("id, title, function_label, person_id, parent_id, accountabilities, updated_at, archived_at");
  if (missingStore(seats.error)) return { ok: true, view: emptySeatView() };
  if (seats.error) return { ok: false, error: safeError(seats.error, PLANNING_NOT_STORED) };
  const references = await client.from("pulse_seat_references").select("id, seat_id, label");
  if (missingStore(references.error)) return { ok: true, view: emptySeatView() };
  if (references.error) return { ok: false, error: safeError(references.error, PLANNING_NOT_STORED) };
  const members = await client.from("pulse_team_members").select("user_id");
  if (missingStore(members.error)) return { ok: true, view: emptySeatView() };
  if (members.error) return { ok: false, error: safeError(members.error, PLANNING_NOT_STORED) };

  const seatRows = (seats.data ?? []) as {
    id: string;
    title: string;
    function_label: string;
    person_id: string | null;
    parent_id: string | null;
    accountabilities: unknown;
    updated_at: string;
    archived_at: string | null;
  }[];
  const memberIds = ((members.data ?? []) as { user_id?: string }[]).map((row) => row.user_id ?? "");
  const names = await displayNames(client, [...memberIds, ...seatRows.map((row) => row.person_id ?? "")]);
  const people = eligiblePeople(
    [...names.entries()]
      .filter(([id]) => memberIds.includes(id) || seatRows.some((row) => row.person_id === id))
      .map(([id, name]) => ({ id, name }))
  );
  return {
    ok: true,
    view: {
      stored: true,
      migrationFile: emptySeatView().migrationFile,
      seats: seatRows.map((row) => toSeat(row, names)),
      people,
      references: ((references.data ?? []) as { id?: string; seat_id?: string | null; label?: string }[])
        .filter((row): row is { id: string; seat_id: string | null; label: string } => Boolean(row.id && row.label))
        .map((row) => ({ id: row.id, seatId: row.seat_id, label: row.label })),
    },
  };
}

async function writeSeatAudit(
  client: Admin,
  input: { seatId: string | null; previous: unknown; next: unknown; actorId: string }
): Promise<Fail | { ok: true }> {
  const inserted = await client.from("pulse_seat_audit").insert({
    seat_id: input.seatId,
    scope: "church",
    previous_value: input.previous,
    new_value: input.next,
    actor_id: input.actorId,
  });
  if (missingStore(inserted.error)) return { ok: false, error: PLANNING_NOT_STORED };
  if (inserted.error) return { ok: false, error: safeError(inserted.error, "The seat audit record could not be written.") };
  return { ok: true };
}

export async function saveSeat(input: {
  id: string | null;
  title: string;
  functionLabel: string;
  personId: string | null;
  parentId: string | null;
  accountabilities: string[];
  expectedUpdatedAt: string | null;
  actorId: string;
}): Promise<{ ok: true; seat: SeatNode } | Fail> {
  const client = admin();
  if (!client) return { ok: false, error: PLANNING_NOT_STORED };
  const currentView = await readSeatBundle();
  if (!currentView.ok) return currentView;
  if (!currentView.view.stored) return { ok: false, error: PLANNING_NOT_STORED };
  const live = activeSeats(currentView.view.seats);
  const seatId = input.id ?? "new-seat";
  const parent = parentChoiceAllowed(
    live.map((seat) => ({ id: seat.id, parentId: seat.parentId })),
    seatId,
    input.parentId
  );
  if (!parent.ok) return { ok: false, error: parent.reason };
  const existing = input.id ? currentView.view.seats.find((seat) => seat.id === input.id && !seat.archivedAt) : null;
  if (input.id && !existing) return { ok: false, error: "That seat is not on the chart." };
  const decision = concurrentEditResult(input.expectedUpdatedAt, existing?.updatedAt ?? null);
  if (decision === "conflict") return { ok: false, error: CONFLICT, conflict: true };
  const row = seatRowForSave(input);
  const payload = {
    ...row,
    updated_at: new Date().toISOString(),
    updated_by: input.actorId,
  };
  const written =
    decision === "insert"
      ? await client.from("pulse_seats").insert(payload).select("id, title, function_label, person_id, parent_id, accountabilities, updated_at, archived_at").maybeSingle()
      : await client
          .from("pulse_seats")
          .update(payload)
          .eq("id", input.id)
          .eq("updated_at", input.expectedUpdatedAt)
          .select("id, title, function_label, person_id, parent_id, accountabilities, updated_at, archived_at")
          .maybeSingle();
  if (missingStore(written.error)) return { ok: false, error: PLANNING_NOT_STORED };
  if (written.error?.code === "PGRST116") return { ok: false, error: CONFLICT, conflict: true };
  if (written.error) {
    const message = written.error.message ?? "";
    if (/cycle|report to itself/i.test(message)) return { ok: false, error: "That seat cannot report to itself or to a seat under it." };
    return { ok: false, error: safeError(written.error, PLANNING_NOT_STORED) };
  }
  if (!written.data) return { ok: false, error: CONFLICT, conflict: true };
  const saved = written.data as {
    id: string;
    title: string;
    function_label: string;
    person_id: string | null;
    parent_id: string | null;
    accountabilities: unknown;
    updated_at: string;
    archived_at: string | null;
  };
  const audit = await writeSeatAudit(client, {
    seatId: saved.id,
    previous: existing
      ? seatRowForSave({
          title: existing.title,
          functionLabel: existing.functionLabel,
          personId: existing.personId,
          parentId: existing.parentId,
          accountabilities: existing.accountabilities,
        })
      : null,
    next: row,
    actorId: input.actorId,
  });
  if (!audit.ok) return audit;
  const names = await displayNames(client, [saved.person_id ?? ""]);
  return { ok: true, seat: toSeat(saved, names) };
}

export async function archiveStoredSeat(input: {
  seatId: string;
  expectedUpdatedAt: string;
  subordinateChoice: ArchiveSubordinateChoice | null;
  referenceChoice: ArchiveReferenceChoice | null;
  actorId: string;
}): Promise<{ ok: true } | Fail> {
  const client = admin();
  if (!client) return { ok: false, error: PLANNING_NOT_STORED };
  const currentView = await readSeatBundle();
  if (!currentView.ok) return currentView;
  if (!currentView.view.stored) return { ok: false, error: PLANNING_NOT_STORED };
  const preview = archiveSeat({
    seats: currentView.view.seats,
    seatId: input.seatId,
    at: new Date().toISOString(),
    subordinateChoice: input.subordinateChoice,
    referenceChoice: input.referenceChoice,
    references: currentView.view.references,
  });
  if (!preview.ok) return { ok: false, error: preview.reason };
  const existing = currentView.view.seats.find((seat) => seat.id === input.seatId);
  if (!existing || concurrentEditResult(input.expectedUpdatedAt, existing.updatedAt) === "conflict") {
    return { ok: false, error: CONFLICT, conflict: true };
  }
  const archived = await client.rpc("apply_pulse_seat_archive", {
    p_seat_id: input.seatId,
    p_expected: input.expectedUpdatedAt,
    p_subordinate: input.subordinateChoice ?? "",
    p_reference: input.referenceChoice ?? "",
    p_actor: input.actorId,
  });
  if (missingStore(archived.error)) return { ok: false, error: PLANNING_NOT_STORED };
  if (archived.error) {
    const message = archived.error.message ?? "";
    if (/someone else saved/i.test(message)) return { ok: false, error: CONFLICT, conflict: true };
    if (/cycle|report to itself/i.test(message)) return { ok: false, error: "That seat cannot report to itself or to a seat under it." };
    if (/choose what happens/i.test(message)) return { ok: false, error: message };
    return { ok: false, error: safeError(archived.error, PLANNING_NOT_STORED) };
  }
  return { ok: true };
}

const ROCK_STATUSES: readonly OsRockStatus[] = ["on_track", "off_track", "complete"];
const ISSUE_STATUSES: readonly OsIssueStatus[] = ["open", "discussing", "long_term", "solved"];

export async function readSharedWork(input: {
  teams: readonly OsTeam[];
  canReadGiving: boolean;
}): Promise<{ ok: true; items: SharedWorkItem[] } | Fail> {
  if (input.teams.length === 0) return { ok: true, items: [] };
  const client = admin();
  if (!client) return { ok: true, items: [] };
  const rows = await client
    .from("pulse_items")
    .select("id, team, kind, title, details, due_on, rock_status, issue_status, metric_key")
    .in("team", [...input.teams])
    .in("kind", ["rock", "issue"])
    .is("removed_at", null);
  if (missingStore(rows.error)) return { ok: true, items: [] };
  if (rows.error) return { ok: false, error: safeError(rows.error, PLANNING_NOT_STORED) };
  const items: SharedWorkItem[] = [];
  for (const row of (rows.data ?? []) as {
    id?: string;
    team?: string;
    kind?: string;
    title?: string;
    details?: string | null;
    due_on?: string | null;
    rock_status?: string | null;
    issue_status?: string | null;
    metric_key?: string | null;
  }[]) {
    if (!row.id || (row.kind !== "rock" && row.kind !== "issue")) continue;
    if (!OS_TEAMS.includes(row.team as OsTeam)) continue;
    if (row.metric_key === "giving" && !input.canReadGiving) continue;
    items.push({
      id: row.id,
      team: row.team as OsTeam,
      kind: row.kind,
      title: row.title?.trim() || "Untitled",
      owner: ownerLabel(row.details ?? null),
      dueOn: row.due_on ?? null,
      rockStatus: ROCK_STATUSES.includes(row.rock_status as OsRockStatus) ? (row.rock_status as OsRockStatus) : null,
      issueStatus: ISSUE_STATUSES.includes(row.issue_status as OsIssueStatus) ? (row.issue_status as OsIssueStatus) : null,
    });
  }
  items.sort(
    (left, right) =>
      OS_TEAMS.indexOf(left.team) - OS_TEAMS.indexOf(right.team) ||
      left.title.localeCompare(right.title) ||
      left.id.localeCompare(right.id)
  );
  return { ok: true, items };
}

function ownerLabel(details: string | null): string {
  if (!details) return "";
  try {
    const parsed = JSON.parse(details) as { owner?: unknown };
    if (parsed && typeof parsed === "object" && typeof parsed.owner === "string") return parsed.owner;
  } catch {
    return details;
  }
  return "";
}

export type { SeatReference };
