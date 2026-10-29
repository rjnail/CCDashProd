import type { ViewSection } from "./sections";
import { parseViewSection, VIEW_SECTIONS } from "./sections";
import type { ExpenseCampusSlug } from "./expense-accounts";
import { EXPENSE_CAMPUSES, resolveExpenseCampusSlug } from "./expense-accounts";
import type {
  Campus,
  CampusAccessOption,
  CampusAccessSlug,
  MonthlyExpensesScope,
  UserProfile,
} from "./types";

export type UserPermissions = {
  can_view_overview: boolean;
  can_view_adult_discipleship: boolean;
  can_view_next_gen: boolean;
  can_view_weekend_reach: boolean;
  can_view_operations: boolean;
  can_view_monthly_expenses: boolean;
  monthly_expenses_scope: MonthlyExpensesScope[];
  can_view_volunteer_matrix: boolean;
  campus_access: CampusAccessOption[];
  can_edit_benchmarks: boolean;
};

export const CAMPUS_ACCESS_OPTIONS: {
  value: CampusAccessOption;
  label: string;
}[] = [
  { value: "church-wide", label: "Church-wide" },
  { value: "mount-pleasant", label: "Mount Pleasant" },
  { value: "alma", label: "Alma" },
  { value: "st-johns", label: "St. Johns" },
];

export const ALL_CAMPUS_ACCESS: CampusAccessOption[] = CAMPUS_ACCESS_OPTIONS.map(
  (option) => option.value
);

export const EXPENSE_SCOPE_OPTIONS: {
  value: MonthlyExpensesScope;
  label: string;
}[] = EXPENSE_CAMPUSES.map((campus) => ({
  value: campus.slug,
  label: campus.label,
}));

export const ALL_EXPENSE_SCOPES: MonthlyExpensesScope[] =
  EXPENSE_SCOPE_OPTIONS.map((option) => option.value);

export function normalizeMonthlyExpensesScope(
  raw: unknown
): MonthlyExpensesScope[] {
  if (raw === "all") return [...ALL_EXPENSE_SCOPES];
  const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  return ALL_EXPENSE_SCOPES.filter((option) => values.includes(option));
}

const CAMPUS_ACCESS_SLUGS: CampusAccessSlug[] = [
  "mount-pleasant",
  "alma",
  "st-johns",
];

export function normalizeCampusAccess(raw: unknown): CampusAccessOption[] {
  if (!Array.isArray(raw)) return [];
  return ALL_CAMPUS_ACCESS.filter((option) => raw.includes(option));
}

export type CampusScope = {
  churchWide: boolean;
  campusSlugs: CampusAccessSlug[];
  full: boolean;
};

export function campusScope(profile: UserProfile): CampusScope {
  if (isAdmin(profile)) {
    return { churchWide: true, campusSlugs: CAMPUS_ACCESS_SLUGS, full: true };
  }
  const access = normalizeCampusAccess(profile.campus_access);
  const churchWide = access.includes("church-wide");
  const campusSlugs = CAMPUS_ACCESS_SLUGS.filter((slug) =>
    access.includes(slug)
  );
  return {
    churchWide,
    campusSlugs,
    full: churchWide && campusSlugs.length === CAMPUS_ACCESS_SLUGS.length,
  };
}

export function allowedCampusesForScope(
  scope: CampusScope,
  campuses: Campus[]
): Campus[] {
  return campuses.filter((campus) =>
    scope.campusSlugs.includes(campus.slug as CampusAccessSlug)
  );
}

export const DEFAULT_STAFF_PERMISSIONS: UserPermissions = {
  can_view_overview: true,
  can_view_adult_discipleship: true,
  can_view_next_gen: true,
  can_view_weekend_reach: true,
  can_view_operations: false,
  can_view_monthly_expenses: false,
  monthly_expenses_scope: ALL_EXPENSE_SCOPES,
  can_view_volunteer_matrix: true,
  campus_access: ALL_CAMPUS_ACCESS,
  can_edit_benchmarks: false,
};

export const ADMIN_PERMISSIONS: UserPermissions = {
  can_view_overview: true,
  can_view_adult_discipleship: true,
  can_view_next_gen: true,
  can_view_weekend_reach: true,
  can_view_operations: true,
  can_view_monthly_expenses: true,
  monthly_expenses_scope: ALL_EXPENSE_SCOPES,
  can_view_volunteer_matrix: true,
  campus_access: ALL_CAMPUS_ACCESS,
  can_edit_benchmarks: true,
};

type SectionPermissionKey =
  | "can_view_overview"
  | "can_view_adult_discipleship"
  | "can_view_next_gen"
  | "can_view_weekend_reach"
  | "can_view_operations";

const SECTION_PERMISSION_KEY: Record<ViewSection, SectionPermissionKey> = {
  "vital-signs": "can_view_overview",
  overview: "can_view_overview",
  "adult-discipleship": "can_view_adult_discipleship",
  "next-gen": "can_view_next_gen",
  "weekend-reach": "can_view_weekend_reach",
  operations: "can_view_operations",
};

export function isAdmin(profile: UserProfile): boolean {
  return profile.role === "admin";
}

export function canManageUsers(profile: UserProfile): boolean {
  return isAdmin(profile);
}

export function canEditBenchmarks(profile: UserProfile): boolean {
  return isAdmin(profile) || profile.can_edit_benchmarks;
}

export function canViewOperations(profile: UserProfile): boolean {
  return isAdmin(profile) || profile.can_view_operations;
}

export function canViewMonthlyExpenses(profile: UserProfile): boolean {
  if (isAdmin(profile)) return true;
  return (
    (profile.can_view_monthly_expenses || profile.can_view_operations) &&
    allowedExpenseCampuses(profile).length > 0
  );
}

export function canViewVolunteerMatrix(profile: UserProfile): boolean {
  if (isAdmin(profile)) return true;
  return (
    profile.can_view_volunteer_matrix &&
    campusScope(profile).campusSlugs.length > 0
  );
}

export function isMalformedArrayLiteral(
  error: { code?: string; message?: string } | null
): boolean {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  return error.code === "22P02" || message.includes("malformed array literal");
}


export function allowedExpenseCampuses(
  profile: UserProfile
): ExpenseCampusSlug[] {
  if (isAdmin(profile)) return [...ALL_EXPENSE_SCOPES];

  const selected = normalizeMonthlyExpensesScope(profile.monthly_expenses_scope);
  const campuses = campusScope(profile);
  return selected.filter((slug) =>
    slug === "central"
      ? campuses.churchWide
      : campuses.campusSlugs.includes(slug)
  );
}

export function resolveExpenseCampusForProfile(
  profile: UserProfile,
  requested?: string | null
): ExpenseCampusSlug {
  const allowed = allowedExpenseCampuses(profile);
  const resolved = resolveExpenseCampusSlug(requested);
  if (allowed.includes(resolved)) return resolved;
  return allowed[0] ?? "central";
}

export function canViewSection(
  profile: UserProfile,
  section: ViewSection
): boolean {
  if (isAdmin(profile)) return true;
  return profile[SECTION_PERMISSION_KEY[section]];
}

export function allowedSections(profile: UserProfile): ViewSection[] {
  return VIEW_SECTIONS.filter((section) => canViewSection(profile, section));
}

export function defaultSection(profile: UserProfile): ViewSection {
  return allowedSections(profile)[0] ?? "overview";
}

export function permissionsFromProfile(
  profile: UserProfile
): UserPermissions {
  return {
    can_view_overview: profile.can_view_overview,
    can_view_adult_discipleship: profile.can_view_adult_discipleship,
    can_view_next_gen: profile.can_view_next_gen,
    can_view_weekend_reach: profile.can_view_weekend_reach,
    can_view_operations: profile.can_view_operations,
    can_view_monthly_expenses: profile.can_view_monthly_expenses,
    monthly_expenses_scope: normalizeMonthlyExpensesScope(
      profile.monthly_expenses_scope
    ),
    can_view_volunteer_matrix: profile.can_view_volunteer_matrix,
    campus_access: [...profile.campus_access],
    can_edit_benchmarks: profile.can_edit_benchmarks,
  };
}

export function normalizeUserProfile(
  row: UserProfile & Partial<UserProfile>
): UserProfile {
  const defaults = DEFAULT_STAFF_PERMISSIONS;

  return {
    id: row.id,
    display_name: row.display_name ?? null,
    role: row.role ?? "staff",
    financial_insights: row.financial_insights ?? false,
    can_view_overview: row.can_view_overview ?? defaults.can_view_overview,
    can_view_adult_discipleship:
      row.can_view_adult_discipleship ?? defaults.can_view_adult_discipleship,
    can_view_next_gen: row.can_view_next_gen ?? defaults.can_view_next_gen,
    can_view_weekend_reach:
      row.can_view_weekend_reach ?? defaults.can_view_weekend_reach,
    can_view_operations:
      row.can_view_operations ?? defaults.can_view_operations,
    can_view_monthly_expenses:
      row.can_view_monthly_expenses ??
      row.can_view_operations ??
      defaults.can_view_monthly_expenses,
    monthly_expenses_scope: normalizeMonthlyExpensesScope(
      row.monthly_expenses_scope ?? defaults.monthly_expenses_scope
    ),
    can_view_volunteer_matrix:
      row.can_view_volunteer_matrix ?? defaults.can_view_volunteer_matrix,
    campus_access:
      row.campus_access == null
        ? defaults.campus_access
        : normalizeCampusAccess(row.campus_access),
    can_edit_benchmarks:
      row.can_edit_benchmarks ?? defaults.can_edit_benchmarks,
    can_access_chms: row.can_access_chms ?? true,
    can_manage_chms_processes: row.can_manage_chms_processes ?? false,
  };
}

export function resolveSectionForProfile(
  profile: UserProfile,
  raw: string | undefined
): ViewSection {
  const allowed = allowedSections(profile);
  if (allowed.length === 0) return "overview";

  const requested = parseViewSection(raw, allowed[0]);

  if (canViewSection(profile, requested)) return requested;
  return allowed[0];
}
