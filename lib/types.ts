export type Campus = {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
};

export type MetricCategory =
  | "attendance"
  | "serving"
  | "groups"
  | "engagement"
  | "stewardship";

export type Metric = {
  id: string;
  key: string;
  label: string;
  unit: string;
  category: MetricCategory;
  requires_financial: boolean;
  sort_order: number;
};

export type MetricSnapshot = {
  id: string;
  campus_id: string | null;
  metric_id: string;
  period_start: string;
  period_type: "monthly" | "weekly_avg" | "annual";
  fiscal_year: string | null;
  calendar_year: number | null;
  value: number;
  source: string;
  metric?: Metric;
  campus?: Campus;
};

export type BenchmarkMinistryArea =
  | "weekend-reach"
  | "adult-discipleship"
  | "next-gen";

export type BenchmarkTarget = {
  id: string;
  campus_id: string | null;
  metric_id: string;
  fiscal_year: string;
  target_value: number;
  stretch_value: number | null;
  label: string | null;
  ministry_area: BenchmarkMinistryArea | null;
  metric?: Metric;
  campus?: Campus;
};

export type MonthlyExpensesScope =
  | "central"
  | "mount-pleasant"
  | "alma"
  | "st-johns";

export type CampusAccessOption =
  | "church-wide"
  | "mount-pleasant"
  | "alma"
  | "st-johns";

export type CampusAccessSlug = Exclude<CampusAccessOption, "church-wide">;

export type UserProfile = {
  id: string;
  display_name: string | null;
  role: "staff" | "admin";
  financial_insights: boolean;
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
  can_access_chms: boolean;
  can_manage_chms_processes: boolean;
};

export type ManagedUser = UserProfile & {
  email: string;
  pulseTeams: ("executive" | "pastoral" | "leadership")[];
};

export type AlertThreshold = {
  id: string;
  metric_id: string;
  campus_id: string | null;
  drop_percent: number;
  months_window: number;
  is_enabled: boolean;
  label: string | null;
  metric?: Metric;
  campus?: Campus;
};

export type Concern = {
  id: string;
  severity: "warning" | "critical";
  title: string;
  message: string;
};

/** @deprecated Use PeriodRange from lib/periods */
export type YearMode = "fiscal" | "calendar";

export const CATEGORY_LABELS: Record<MetricCategory, string> = {
  attendance: "Attendance",
  serving: "Serving",
  groups: "Groups",
  engagement: "Engagement",
  stewardship: "Stewardship",
};

export const THEMES = [
  "community",
  "community-dark",
  "light",
] as const;

export type ThemeName = (typeof THEMES)[number];

export const DEFAULT_FISCAL_YEAR = "FY26/27";
export const LAST_FISCAL_YEAR = "FY25/26";
export const TARGET_FISCAL_YEAR = "FY26/27";

export const FISCAL_YEAR_OPTIONS = [
  "FY23/24",
  "FY24/25",
  "FY25/26",
  "FY26/27",
  "FY27/28",
  "FY28/29",
] as const;
