import type { SupabaseClient } from "@supabase/supabase-js";
import { getConnectEventsBaptismsForCampus } from "@/lib/connect-events";
import { fiscalYearForDate } from "@/lib/google-sheets-attendance";
import { fetchVolunteerMatrixCampuses } from "@/lib/google-sheets-volunteer-matrix";
import { getFirstTimeGuestsForCampus } from "@/lib/first-time-guests";
import { getCampuses } from "@/lib/metrics";
import {
  canEditBenchmarks,
  canViewMonthlyExpenses,
  canViewOperations,
  canViewSection,
  canViewVolunteerMatrix,
  campusScope,
  isAdmin,
} from "@/lib/permissions";
import type { UserProfile } from "@/lib/types";
import { TARGET_FISCAL_YEAR } from "@/lib/types";
import { readModelConfig } from "./model";
import { pulseWorkspaceAccess } from "./planning";
import {
  buildInsights,
  buildMeetingInsights,
  CAMPUS_GIVING_CLOSED,
  CAMPUS_SOURCE_UNSUPPORTED,
  canReadGiving,
  closedMonthCeiling,
  focusKeys,
  isStaleSunday,
  monthLabel,
  monthScope,
  pulseCampusLabel,
  resolvePulseCampus,
  sameMonthLastYear,
  sundaySeries,
  usableSource,
} from "./rules";
import {
  EMPTY_VOTE,
  readDismissedInsights,
  readOwnMeetings,
  readTeamRecords,
  readTeamRoster,
  readVoteBoard,
} from "./pulse-db";
import { eligibleOwners } from "./owners";
import { readMeetingArchives } from "./conclude-store";
import { readScorecardDirectory } from "./scorecard-store";
import {
  canEditChurchwideTarget,
  filterManualDefinitions,
  givingWriteAllowed,
  libraryAccess,
  resolveSharedTarget,
  toManualDefinition,
} from "./scorecard";
import {
  OS_TEAMS,
  type OsAskContext,
  type OsCampus,
  type OsInsight,
  type OsManualDefinition,
  type OsManualReading,
  type OsMeasure,
  type OsMeetingArchive,
  type OsMember,
  type OsPageData,
  type OsScorecardNote,
  type OsSharedTarget,
  type OsTeam,
  type OsVoteHistoryEntry,
  type OsVoteView,
  type OsWorkItem,
  type AttendanceMonth,
} from "./types";

type SnapRow = {
  period_start: string;
  value: number | string | null;
  source: string | null;
  created_at: string | null;
  campus_id: string | null;
  period_type: string;
  campus: { slug: string } | { slug: string }[] | null;
  metric: { key: string } | { key: string }[] | null;
};

type PulseContext = {
  teams: OsTeam[];
  storageReady: boolean;
  canEdit: boolean;
  canFacilitate: boolean;
  canParticipate: boolean;
  canEditSharedTarget: boolean;
  canPublishManual: boolean;
  denied: boolean;
  items: OsWorkItem[];
  notes: OsScorecardNote[];
  catalogMeasures: OsMeasure[];
  manualReadings: OsManualReading[];
  sharedTargets: OsSharedTarget[];
  manualDefinitions: OsManualDefinition[];
  scorecardConfigured: boolean;
  scorecardAuditReady: boolean;
  members: OsMember[];
  vote: OsVoteView;
  voteHistory: OsVoteHistoryEntry[];
  archives: OsMeetingArchive[];
  viewerId: string;
  dismissedInsightIds: string[];
};

export async function loadPulsePage(
  supabase: SupabaseClient,
  profile: UserProfile,
  requestedTeam: string | undefined,
  requestedCampus?: string | string[] | null
): Promise<OsPageData> {
  const membership = await readOwnMeetings(supabase, profile.id);
  const teams = membership.missing ? [...OS_TEAMS] : membership.teams;
  const access = pulseWorkspaceAccess({ isAdmin: isAdmin(profile), teamCount: teams.length });
  if (access === "denied") return deniedPage(profile);
  if (access === "admin-only") return adminSettingsPage(profile);

  const team = teams.includes(requestedTeam as OsTeam)
    ? (requestedTeam as OsTeam)
    : teams[0];
  const records = membership.missing
    ? { missing: true, items: [], notes: [], readings: [] as OsManualReading[], configured: false }
    : await readTeamRecords(supabase, team);
  const directory = records.missing ? null : await readScorecardDirectory();
  const givingAllowed = canReadGiving({
    financialInsights: profile.financial_insights,
    isAdmin: isAdmin(profile),
  });
  const visibleNote = (metricKey: string, campus?: string | null) =>
    givingWriteAllowed({ team, canReadGiving: givingAllowed, metricKey, campus }).allowed &&
    libraryAccess({ team, canReadGiving: givingAllowed, metricKey }).visible;
  const sourceNotes = (directory?.loaded ? directory.notes.filter((note) => note.team === team) : records.notes).filter(
    (note) => visibleNote(note.metricKey, note.campus)
  );
  const sourceReadings = (directory?.loaded ? directory.readings : records.readings).filter((reading) => {
    if (!visibleNote(reading.metricKey, reading.campus)) return false;
    if (reading.team === team) return true;
    const home = directory?.notes.find((note) => note.metricKey === reading.metricKey);
    return home?.published === true;
  });
  const sharedTargets = sharedTargetList(directory?.loaded ? directory.notes : sourceNotes, team, givingAllowed);
  const manualDefinitions = filterManualDefinitions(
    (directory?.loaded ? directory.notes : sourceNotes)
      .map((note) => toManualDefinition(note))
      .filter((note): note is OsManualDefinition => Boolean(note)),
    { team, isAdmin: isAdmin(profile) }
  ).filter((definition) => visibleNote(definition.metricKey));
  const meetingMembers = records.missing ? [] : await readTeamRoster(supabase, team);
  const votes = records.missing
    ? { vote: EMPTY_VOTE, history: [] as OsVoteHistoryEntry[] }
    : await readVoteBoard(supabase, team, profile.id);
  const dismissedInsightIds = records.missing ? [] : await readDismissedInsights(supabase, "pulse", team);
  const context: PulseContext = {
    teams,
    storageReady: !membership.missing && !records.missing,
    canEdit: isAdmin(profile),
    canFacilitate: isAdmin(profile) || meetingMembers.some((member) => member.id === profile.id && member.facilitator),
    canParticipate: true,
    canEditSharedTarget: canEditChurchwideTarget({
      isAdmin: isAdmin(profile),
      canEditBenchmarks: canEditBenchmarks(profile),
    }),
    canPublishManual: isAdmin(profile),
    denied: false,
    items: records.items.map((item) =>
      item.metricKey === "giving" && !visibleNote(item.metricKey, "church-wide") ? { ...item, metricKey: null } : item
    ),
    notes: sourceNotes,
    catalogMeasures: [],
    manualReadings: sourceReadings,
    sharedTargets,
    manualDefinitions,
    scorecardConfigured: directory?.loaded ? directory.configuredTeams.includes(team) : records.configured,
    scorecardAuditReady: directory?.auditReady ?? false,
    members: eligibleOwners(meetingMembers).map((member) => ({
      id: member.id,
      name: member.name,
      facilitator: meetingMembers.find((row) => row.id === member.id)?.facilitator ?? false,
    })),
    vote: votes.vote,
    voteHistory: votes.history,
    archives: records.missing ? [] : await readMeetingArchives({ team, canReadGiving: givingAllowed }),
    viewerId: profile.id,
    dismissedInsightIds,
  };
  const scope = campusScope(profile);
  const campus = resolvePulseCampus(team, requestedCampus);
  const campusLabel = pulseCampusLabel(campus);
  const today = new Date();
  const ceiling = closedMonthCeiling(today);
  const allowed = scope.churchWide || isAdmin(profile);

  const reportLinks = [
    { href: "/dashboard", label: "Ministry Dashboard" },
    ...(canViewVolunteerMatrix(profile)
      ? [{ href: "/volunteer-matrix", label: "Volunteer Matrix" }]
      : []),
    ...(canViewMonthlyExpenses(profile)
      ? [{ href: "/monthly-expenses", label: "Monthly Expenses" }]
      : []),
  ];

  if (!allowed) {
    const measures = catalog(team)
      .filter((item) => visibleNote(item.key))
      .map((item) => unavailableMeasure(item, campusLabel, "This campus is outside your access."));
    context.catalogMeasures = measures;
    return page(profile, team, campus, campusLabel, measures, [], reportLinks, context);
  }

  const campuses = await getCampuses(supabase);
  const campusRecord = campus === "church-wide" ? null : campuses.find((item) => item.slug === campus) ?? null;
  const campusId = campusRecord?.id ?? null;

  const [monthly, sundays, roster, baptisms, guests] = await Promise.all([
    loadMonthly(supabase, ceiling, visibleNote("giving", campus)),
    loadSundays(supabase),
    loadRoster(),
    campus === "church-wide" || campusId ? loadBaptisms(campusId, campuses) : Promise.resolve({ count: null, label: null, error: null }),
    campus === "church-wide" || campusId ? loadGuests(campusId, campuses) : Promise.resolve({ count: null, error: null }),
  ]);

  const buildOne = (item: CatalogItem): OsMeasure => {
    if (item.key === "giving") {
      if (!visibleNote("giving", campus)) {
        return unavailableMeasure(
          item,
          campusLabel,
          campus !== "church-wide"
            ? "Campus giving stays on the Financials report. This scorecard shows church-wide giving only."
            : "Giving stays behind Financials access. Team membership does not grant it.",
          "restricted"
        );
      }
      return monthlyMeasure(item, monthly, "total_giving", campus, campusLabel, ceiling, {
        definition:
          "Church-wide monthly giving for the latest closed month. Not a weekly total, and not compared with a budget.",
        href: canViewOperations(profile) ? "/dashboard?section=operations" : null,
        unit: "currency",
      });
    }
    if (item.key === "attendance") {
      return sundayMeasure(item, sundays, campus, campusLabel, today);
    }
    if (item.key === "kids") {
      return monthlyMeasure(item, monthly, "kids_avg", campus, campusLabel, ceiling, {
        definition:
          "Monthly average of kids attendance for the latest closed month. This is not one Sunday.",
        href: canViewSection(profile, "next-gen") ? "/dashboard?section=next-gen" : null,
        unit: "people",
      });
    }
    if (item.key === "serving") return servingMeasure(item, roster, campus, campusLabel, canViewVolunteerMatrix(profile));
    if (item.key === "guests") {
      if (campus !== "church-wide" && !campusId) return unavailableMeasure(item, campusLabel, CAMPUS_SOURCE_UNSUPPORTED);
      return guestMeasure(item, guests, campus, campusLabel, canViewSection(profile, "adult-discipleship"));
    }
    if (item.key === "baptisms") {
      if (campus !== "church-wide" && !campusId) return unavailableMeasure(item, campusLabel, CAMPUS_SOURCE_UNSUPPORTED);
      return baptismMeasure(item, baptisms, campus, campusLabel, canViewSection(profile, "adult-discipleship"));
    }
    if (item.key === "groups") {
      return unavailableMeasure(
        item,
        campusLabel,
        campus === "church-wide"
          ? "No live group source is connected. Missing is not zero."
          : CAMPUS_SOURCE_UNSUPPORTED
      );
    }
    return {
      ...unavailableMeasure(
        item,
        campusLabel,
        "No succession or strategic measure is defined yet. Nothing is entered automatically."
      ),
      quality: "manual" as const,
      periodKind: "monthly",
      periodLabel: "Monthly",
      unit: "count",
    };
  };
  const catalogMeasures = catalogKeys()
    .filter((item) => visibleNote(item.key))
    .map((item) => buildOne(item));
  const measures = catalog(team)
    .filter((item) => visibleNote(item.key))
    .map((item) => catalogMeasures.find((measure) => measure.key === item.key) ?? buildOne(item));
  context.catalogMeasures = catalogMeasures;

  const attendanceMonths = monthly
    .filter(
      (row) =>
        row.key === "total_in_person_avg" &&
        row.campusSlug === (campus === "church-wide" ? null : campus) &&
        usableSource(row.source) &&
        row.value != null &&
        row.periodStart <= ceiling
    )
    .map((row) => ({ periodStart: row.periodStart, value: row.value as number }));

  return page(profile, team, campus, campusLabel, measures, attendanceMonths, reportLinks, context);
}

function adminSettingsPage(profile: UserProfile): OsPageData {
  return {
    ...deniedPage(profile),
    canEdit: true,
    canOpenUsers: true,
  };
}

function deniedPage(profile: UserProfile): OsPageData {
  return {
    team: "executive",
    campus: "church-wide",
    campusLabel: "Church-wide",
    measures: [],
    focusKeys: [],
    attendanceMonths: [],
    insights: [],
    meetingInsights: [],
    modelConfigured: false,
    modelMissing: "COMMUNITY_OS_MODEL_API_KEY",
    persistence: "preview",
    viewerId: profile.id,
    viewerName: profile.display_name ?? "Staff",
    canOpenUsers: false,
    reportLinks: [],
    teams: [],
    storageReady: false,
    canEdit: false,
    canFacilitate: false,
    canParticipate: false,
    canEditSharedTarget: false,
    canPublishManual: false,
    denied: true,
    items: [],
    notes: [],
    catalogMeasures: [],
    manualReadings: [],
    sharedTargets: [],
    manualDefinitions: [],
    scorecardConfigured: false,
    scorecardAuditReady: false,
    members: [],
    vote: EMPTY_VOTE,
    voteHistory: [],
    archives: [],
    periodLabel: "Current reporting period",
    latestSourceUpdate: null,
  };
}

function page(
  profile: UserProfile,
  team: OsTeam,
  campus: OsCampus,
  campusLabel: string,
  measures: OsMeasure[],
  attendanceMonths: AttendanceMonth[],
  reportLinks: { href: string; label: string }[],
  context: PulseContext
): OsPageData {
  const asOf = new Date().toISOString();
  const model = readModelConfig();
  const today = asOf.slice(0, 10);
  const latestSourceUpdate = latestRefresh(measures);
  const hidden = new Set(context.dismissedInsightIds);
  return {
    team,
    campus,
    campusLabel,
    measures,
    focusKeys: focusKeys(team),
    attendanceMonths,
    insights: buildInsights(measures, asOf, {
      yearOverYear: sameMonthLastYear(attendanceMonths, closedMonthCeiling(new Date())),
    }).filter((item) => !hidden.has(item.id)),
    meetingInsights: buildMeetingInsights(context.items, today, asOf).filter((item) => !hidden.has(item.id)),
    modelConfigured: model.configured,
    modelMissing: model.missing,
    persistence: "preview",
    viewerName: profile.display_name ?? "Staff",
    canOpenUsers: isAdmin(profile),
    reportLinks,
    periodLabel: measures.find((measure) => measure.quality === "available")?.periodLabel ?? "Current reporting period",
    latestSourceUpdate,
    ...context,
  };
}

type CatalogItem = { key: string; label: string };

function catalogKeys(): CatalogItem[] {
  const all: Record<string, string> = {
    giving: "Giving",
    attendance: "Sunday attendance",
    serving: "Volunteer roster",
    kids: "Kids attendance",
    guests: "First-time guests",
    baptisms: "Baptism signups",
    groups: "People in groups",
    priorities: "Strategic priorities",
  };
  return Object.entries(all).map(([key, label]) => ({ key, label }));
}

function catalog(team: OsTeam): CatalogItem[] {
  const all = new Map(catalogKeys().map((item) => [item.key, item.label]));
  return focusKeys(team).map((key) => ({ key, label: all.get(key) ?? key }));
}

function sharedTargetList(
  notes: OsScorecardNote[],
  team: OsTeam,
  givingAllowed: boolean
): OsSharedTarget[] {
  const entries: { metricKey: string; campus: string; periodKey: string; value: number; setAt: string }[] = [];
  for (const note of notes) {
    if (!givingWriteAllowed({ team, canReadGiving: givingAllowed, metricKey: note.metricKey, campus: note.campus }).allowed) {
      continue;
    }
    if (!libraryAccess({ team, canReadGiving: givingAllowed, metricKey: note.metricKey }).visible) continue;
    for (const [periodKey, target] of Object.entries(note.targets)) {
      entries.push({
        metricKey: note.metricKey,
        campus: note.campus,
        periodKey,
        value: target.value,
        setAt: target.setAt,
      });
    }
  }
  const seen = new Set<string>();
  const resolved: OsSharedTarget[] = [];
  for (const entry of entries) {
    const id = `${entry.metricKey}|${entry.campus}|${entry.periodKey}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const target = resolveSharedTarget(entries, entry);
    if (target) resolved.push(target);
  }
  return resolved;
}

function unavailableMeasure(
  item: CatalogItem,
  campusLabel: string,
  detail: string,
  quality: OsMeasure["quality"] = "unavailable"
): OsMeasure {
  return {
    key: item.key,
    label: item.label,
    definition: detail,
    unit: item.key === "giving" ? "currency" : "people",
    periodLabel: "Not available",
    periodKind: "unavailable",
    campusLabel,
    value: null,
    sourceLabel: "Not connected",
    reportHref: null,
    refreshedAt: null,
    quality,
    qualityDetail: detail,
    history: [],
    staffing: null,
  };
}

type MonthlyRow = {
  key: string;
  periodStart: string;
  value: number | null;
  source: string;
  campusSlug: string | null;
  importedAt: string | null;
};

function monthlyMeasure(
  item: CatalogItem,
  rows: MonthlyRow[],
  metricKey: string,
  campus: OsCampus,
  campusLabel: string,
  ceiling: string,
  copy: { definition: string; href: string | null; unit: OsMeasure["unit"] }
): OsMeasure {
  if (item.key === "giving" && campus !== "church-wide") {
    return unavailableMeasure(item, campusLabel, CAMPUS_GIVING_CLOSED);
  }
  const scoped = monthScope(
    rows.filter((row) => row.key === metricKey),
    campus,
    ceiling
  );
  if (scoped.status === "unsupported") {
    return {
      ...unavailableMeasure(item, campusLabel, CAMPUS_SOURCE_UNSUPPORTED),
      definition: copy.definition,
      reportHref: copy.href,
      unit: copy.unit,
    };
  }
  const current = scoped.rows[0];
  if (scoped.status === "missing" || !current || current.value == null) {
    return {
      ...unavailableMeasure(
        item,
        campusLabel,
        campus === "church-wide"
          ? "No closed-month observation is available for this scope."
          : "No closed-month observation is stored for this campus. Missing is not zero."
      ),
      definition: copy.definition,
      reportHref: copy.href,
      quality: campus === "church-wide" ? "missing" : "unavailable",
      unit: copy.unit,
    };
  }
  return {
    key: item.key,
    label: item.label,
    definition: copy.definition,
    unit: copy.unit,
    periodLabel: monthLabel(current.periodStart),
    periodKind: item.key === "kids" ? "monthly_average" : "closed_month",
    campusLabel,
    value: current.value,
    sourceLabel: "Dashboard snapshots",
    reportHref: copy.href,
    refreshedAt: current.importedAt,
    quality: "available",
    qualityDetail:
      campus === "church-wide"
        ? "Latest closed month. Later months are not treated as observations."
        : "This campus's own closed-month reading. Averages are not added together, and a missing campus is not zero.",
    history: scoped.rows.slice(1, 4).map((row) => ({
      label: monthLabel(row.periodStart),
      value: row.value,
    })),
    staffing: null,
  };
}

type Sunday = {
  date: string;
  campusSlug: string;
  value: number | null;
  source: string;
  importedAt: string | null;
};

function sundayMeasure(
  item: CatalogItem,
  rows: Sunday[],
  campus: OsCampus,
  campusLabel: string,
  today: Date
): OsMeasure {
  const definition =
    "Headcount for one Sunday. Church-wide is the sum only when Mount Pleasant, Alma, and St. Johns each have a row. This is not the monthly average or the fiscal-year average.";
  const href = "/dashboard?section=weekend-reach";
  const series = sundaySeries(rows, campus);
  const current = series[0];
  if (!current) {
    return {
      ...unavailableMeasure(
        item,
        campusLabel,
        campus === "church-wide"
          ? "A complete Sunday for all three campuses is not available."
          : "No Sunday headcount is stored for this campus. Missing is not zero."
      ),
      definition,
      reportHref: href,
      quality: campus === "church-wide" ? "missing" : "unavailable",
    };
  }
  const stale = isStaleSunday(current.date, today);
  return {
    key: item.key,
    label: item.label,
    definition,
    unit: "people",
    periodLabel: serviceLabel(current.date),
    periodKind: "sunday",
    campusLabel,
    value: current.value,
    sourceLabel: "Sunday attendance sheet",
    reportHref: href,
    refreshedAt: latestImport(rows, current.date),
    quality: stale ? "stale" : "available",
    qualityDetail: stale
      ? "This Sunday is more than 10 days old."
      : campus === "church-wide"
        ? "All three campuses are present for this Sunday."
        : "This campus's own Sunday headcount. It is not a share of the church-wide total.",
    history: series.slice(1, 4).map((row) => ({
      label: serviceLabel(row.date),
      value: row.value,
    })),
    staffing: null,
  };
}

function servingMeasure(
  item: CatalogItem,
  roster: Awaited<ReturnType<typeof loadRoster>>,
  campus: OsCampus,
  campusLabel: string,
  canLink: boolean
): OsMeasure {
  const definition =
    "Current roster seats compared with the rotation pool. This is not weekly participation, and people in more than one role may be counted more than once.";
  if (roster.error || !roster.campuses) {
    return {
      ...unavailableMeasure(item, campusLabel, roster.error ?? "Volunteer roster is unavailable."),
      definition,
      quality: roster.error ? "error" : "unavailable",
    };
  }
  const wanted = campus === "church-wide" ? ["mount-pleasant", "alma", "st-johns"] : [campus];
  const found = roster.campuses.filter((row) => wanted.includes(row.slug));
  if (found.length !== wanted.length) {
    return {
      ...unavailableMeasure(
        item,
        campusLabel,
        campus === "church-wide"
          ? "The roster is missing a campus, so the seats are not added."
          : "No volunteer roster is stored for this campus. Missing is not zero."
      ),
      definition,
      quality: "unavailable",
    };
  }
  const staffing = {
    current: found.reduce((sum, row) => sum + row.current, 0),
    need: found.reduce((sum, row) => sum + row.need, 0),
    gap: found.reduce((sum, row) => sum + row.gap, 0),
    campuses: found.map((row) => ({
      label: row.label,
      current: row.current,
      need: row.need,
      gap: row.gap,
    })),
  };
  return {
    key: item.key,
    label: item.label,
    definition,
    unit: "people",
    periodLabel: "Current roster",
    periodKind: "current_roster",
    campusLabel,
    value: staffing.current,
    sourceLabel: "Volunteer Matrix",
    reportHref: canLink ? "/volunteer-matrix" : null,
    refreshedAt: null,
    quality: "available",
    qualityDetail: `${staffing.current.toLocaleString()} current seats, ${staffing.need.toLocaleString()} rotation-pool seats.`,
    history: [],
    staffing,
  };
}

function guestMeasure(
  item: CatalogItem,
  guests: Awaited<ReturnType<typeof loadGuests>>,
  campus: OsCampus,
  campusLabel: string,
  canLink: boolean
): OsMeasure {
  const definition = `First-time guests in ${TARGET_FISCAL_YEAR}. This count does not show whether anyone was followed up within 48 hours.`;
  if (guests.error || guests.count == null) {
    return {
      ...unavailableMeasure(item, campusLabel, guests.error ?? "Guest counts are unavailable."),
      definition,
      quality: guests.error ? "error" : "unavailable",
    };
  }
  return {
    key: item.key,
    label: item.label,
    definition,
    unit: "people",
    periodLabel: TARGET_FISCAL_YEAR,
    periodKind: "fiscal_year",
    campusLabel,
    value: guests.count,
    sourceLabel: "First-time guest sheet",
    reportHref: canLink ? "/dashboard?section=adult-discipleship" : null,
    refreshedAt: null,
    quality: "available",
    qualityDetail:
      campus === "church-wide"
        ? "Fiscal-year guest count. Names are not shown here."
        : "Fiscal-year guest count for this campus. Names are not shown here. This is not a share of the church-wide total.",
    history: [],
    staffing: null,
  };
}

function baptismMeasure(
  item: CatalogItem,
  baptisms: Awaited<ReturnType<typeof loadBaptisms>>,
  campus: OsCampus,
  campusLabel: string,
  canLink: boolean
): OsMeasure {
  const definition = `Upcoming baptism signups for ${baptisms.label ?? TARGET_FISCAL_YEAR}. This is not a count of completed baptisms.`;
  if (baptisms.error || baptisms.count == null) {
    return {
      ...unavailableMeasure(item, campusLabel, baptisms.error ?? "Baptism signups are unavailable."),
      definition,
      quality: baptisms.error ? "error" : "unavailable",
    };
  }
  return {
    key: item.key,
    label: item.label,
    definition,
    unit: "count",
    periodLabel: baptisms.label ?? TARGET_FISCAL_YEAR,
    periodKind: "fiscal_year_signups",
    campusLabel,
    value: baptisms.count,
    sourceLabel: "Connect Events signups",
    reportHref: canLink ? "/dashboard?section=adult-discipleship" : null,
    refreshedAt: null,
    quality: "available",
    qualityDetail:
      campus === "church-wide"
        ? "Signup count only."
        : "Signup count for this campus only. This is not a share of the church-wide total.",
    history: [],
    staffing: null,
  };
}

async function loadMonthly(
  supabase: SupabaseClient,
  ceiling: string,
  givingAllowed: boolean
): Promise<MonthlyRow[]> {
  const keys = givingAllowed
    ? ["total_giving", "kids_avg", "total_in_person_avg"]
    : ["kids_avg", "total_in_person_avg"];
  const [year, month] = ceiling.split("-");
  const start = `${Number(year) - 1}-${month}-01`;
  const { data, error } = await supabase
    .from("metric_snapshots")
    .select("period_start, value, source, created_at, campus_id, period_type, campus:campuses(slug), metric:metrics!inner(key)")
    .in("metric.key", keys)
    .eq("period_type", "monthly")
    .gte("period_start", start)
    .lte("period_start", ceiling);

  if (error || !data) return [];
  return (data as SnapRow[]).map((row) => ({
    key: embedded(row.metric)?.key ?? "",
    periodStart: row.period_start,
    value: numberOrNull(row.value),
    source: row.source ?? "",
    campusSlug: row.campus_id ? embedded(row.campus)?.slug ?? null : null,
    importedAt: row.created_at,
  }));
}

async function loadSundays(supabase: SupabaseClient): Promise<Sunday[]> {
  const { data, error } = await supabase
    .from("metric_snapshots")
    .select("period_start, value, source, created_at, campus_id, period_type, campus:campuses(slug), metric:metrics!inner(key)")
    .eq("metric.key", "last_week_attendance")
    .eq("period_type", "weekly_avg")
    .order("period_start", { ascending: false })
    .limit(450);
  if (error || !data) return [];
  return (data as SnapRow[])
    .map((row) => ({
      date: row.period_start,
      campusSlug: embedded(row.campus)?.slug ?? "",
      value: numberOrNull(row.value),
      source: row.source ?? "",
      importedAt: row.created_at,
    }))
    .filter((row) => usableSource(row.source));
}

async function loadRoster(): Promise<{
  campuses: { slug: string; label: string; current: number; need: number; gap: number }[] | null;
  error: string | null;
}> {
  try {
    const matrix = await fetchVolunteerMatrixCampuses();
    if (matrix.source !== "google_sheets") {
      return { campuses: null, error: "Volunteer roster sample data is not shown." };
    }
    return {
      campuses: matrix.campuses.map((campus) => ({
        slug: campus.slug,
        label: campus.label,
        current: campus.totals.current,
        need: campus.totals.rotationPool,
        gap: campus.totals.gap,
      })),
      error: null,
    };
  } catch (error) {
    return {
      campuses: null,
      error: error instanceof Error ? error.message : "Volunteer roster is unavailable.",
    };
  }
}

async function loadBaptisms(
  campusId: string | null,
  campuses: { id: string; slug: string }[]
): Promise<{ count: number | null; label: string | null; error: string | null }> {
  try {
    const summary = await getConnectEventsBaptismsForCampus(campusId, campuses as never);
    if (summary.source !== "google_sheets") {
      return { count: null, label: null, error: "Sample baptism data is not shown." };
    }
    return {
      count: summary.fiscalYearTotal,
      label: summary.fiscalYearLabel,
      error: null,
    };
  } catch (error) {
    return {
      count: null,
      label: null,
      error: error instanceof Error ? error.message : "Baptism signups are unavailable.",
    };
  }
}

async function loadGuests(
  campusId: string | null,
  campuses: { id: string; slug: string }[]
): Promise<{ count: number | null; error: string | null }> {
  try {
    const summary = await getFirstTimeGuestsForCampus(campusId, campuses as never);
    if (summary.source !== "google_sheets") {
      return { count: null, error: "Sample guest data is not shown." };
    }
    const count = summary.guests.filter(
      (guest) => fiscalYearForDate(guest.serviceDate) === TARGET_FISCAL_YEAR
    ).length;
    return { count, error: null };
  } catch (error) {
    return {
      count: null,
      error: error instanceof Error ? error.message : "Guest counts are unavailable.",
    };
  }
}

function embedded<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function numberOrNull(value: number | string | null): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function serviceLabel(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function latestImport(rows: Sunday[], date: string): string | null {
  return rows.find((row) => row.date === date)?.importedAt ?? null;
}

function latestRefresh(measures: OsMeasure[]): string | null {
  return (
    measures
      .map((measure) => measure.refreshedAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null
  );
}

const DASHBOARD_KEYS = ["giving", "attendance", "serving", "kids", "guests", "baptisms", "groups"];

function asOsCampus(slug: string | null): OsCampus | null {
  if (slug == null) return "church-wide";
  if (slug === "mount-pleasant" || slug === "alma" || slug === "st-johns") return slug;
  return null;
}

export async function loadDashboardInsights(
  supabase: SupabaseClient,
  profile: UserProfile,
  campusSlug: string | null,
  campusName: string
): Promise<{
  insights: OsInsight[];
  ask: OsAskContext;
  teams: OsTeam[];
  measures: OsMeasure[];
  attendanceMonths: AttendanceMonth[];
}> {
  const model = readModelConfig();
  const membership = await readOwnMeetings(supabase, profile.id);
  const teams = membership.missing ? [] : membership.teams;
  const campus = asOsCampus(campusSlug);
  const askBase = {
    surface: "dashboard" as const,
    surfaceLabel: "Ministry Dashboard",
    teamLabel: null,
    teamKey: null,
    campusLabel: campusName,
    campusSlug,
    modelConfigured: model.configured,
    modelMissing: model.missing,
  };
  if (!campus) {
    return {
      insights: [
        {
          id: "campus:unmapped",
          category: "data-quality",
          severity: "info",
          title: "This campus is not on the shared scorecard",
          summary: `${campusName} does not have a church-wide scorecard mapping, so no performance figure is shown.`,
          evidence: "No observation was substituted from another campus.",
          limitation: "Missing campus coverage is not zero.",
          metricKey: "campus",
          asOf: new Date().toISOString(),
          campusLabel: campusName,
          periodLabel: "Not available",
          reportHref: null,
          refreshedAt: null,
          followUp: "Use a mapped campus or church-wide before asking for a trend.",
          lifecycle: "current",
        },
      ],
      ask: { ...askBase, periodLabel: "Not available", latestSourceUpdate: null },
      teams,
      measures: [],
      attendanceMonths: [],
    };
  }
  const scope = campusScope(profile);
  const allowed = campus === "church-wide" ? scope.churchWide || isAdmin(profile) : true;
  const givingAllowed = canReadGiving({
    financialInsights: profile.financial_insights,
    isAdmin: isAdmin(profile),
  });
  const campusLabel = campus === "church-wide" ? "Church-wide" : campusName;
  if (!allowed) {
    return {
      insights: [],
      ask: { ...askBase, campusLabel, periodLabel: "Outside your access", latestSourceUpdate: null },
      teams,
      measures: [],
      attendanceMonths: [],
    };
  }
  const today = new Date();
  const ceiling = closedMonthCeiling(today);
  const campuses = await getCampuses(supabase);
  const campusId = campus === "church-wide" ? null : campuses.find((item) => item.slug === campus)?.id ?? null;
  const [monthly, sundays, roster, baptisms, guests] = await Promise.all([
    loadMonthly(supabase, ceiling, givingAllowed),
    loadSundays(supabase),
    loadRoster(),
    loadBaptisms(campusId, campuses),
    loadGuests(campusId, campuses),
  ]);
  const catalogItems = DASHBOARD_KEYS.map((key) => ({
    key,
    label:
      {
        giving: "Giving",
        attendance: "Sunday attendance",
        serving: "Volunteer roster",
        kids: "Kids attendance",
        guests: "First-time guests",
        baptisms: "Baptism signups",
        groups: "People in groups",
      }[key] ?? key,
  }));
  const measures = catalogItems.map((item) => {
    if (item.key === "giving") {
      if (!givingAllowed) {
        return unavailableMeasure(item, campusLabel, "Giving stays behind Financials access.", "restricted");
      }
      return monthlyMeasure(item, monthly, "total_giving", campus, campusLabel, ceiling, {
        definition: "Church-wide monthly giving for the latest closed month.",
        href: canViewOperations(profile) ? "/dashboard?section=operations" : null,
        unit: "currency",
      });
    }
    if (item.key === "attendance") return sundayMeasure(item, sundays, campus, campusLabel, today);
    if (item.key === "kids") {
      return monthlyMeasure(item, monthly, "kids_avg", campus, campusLabel, ceiling, {
        definition: "Monthly average of kids attendance for the latest closed month.",
        href: canViewSection(profile, "next-gen") ? "/dashboard?section=next-gen" : null,
        unit: "people",
      });
    }
    if (item.key === "serving") return servingMeasure(item, roster, campus, campusLabel, canViewVolunteerMatrix(profile));
    if (item.key === "guests") return guestMeasure(item, guests, campus, campusLabel, canViewSection(profile, "adult-discipleship"));
    if (item.key === "baptisms") {
      return baptismMeasure(item, baptisms, campus, campusLabel, canViewSection(profile, "adult-discipleship"));
    }
    return unavailableMeasure(item, campusLabel, "No live group source is connected. Missing is not zero.");
  });
  const visible = measures.filter((measure) => measure.quality !== "restricted");
  const attendanceMonths = monthly
    .filter(
      (row) =>
        row.key === "total_in_person_avg" &&
        row.campusSlug === (campus === "church-wide" ? null : campus) &&
        usableSource(row.source) &&
        row.value != null &&
        row.periodStart <= ceiling
    )
    .map((row) => ({ periodStart: row.periodStart, value: row.value as number }));
  const dismissed = new Set(await readDismissedInsights(supabase, "dashboard", ""));
  const insights = buildInsights(visible, today.toISOString(), {
    yearOverYear: sameMonthLastYear(attendanceMonths, ceiling),
  }).filter((item) => !dismissed.has(item.id));
  return {
    insights,
    ask: {
      ...askBase,
      campusLabel,
      periodLabel: monthLabel(ceiling),
      latestSourceUpdate: latestRefresh(visible),
    },
    teams,
    measures,
    attendanceMonths,
  };
}
