import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  DEFAULT_STAFF_PERMISSIONS,
  isMalformedArrayLiteral,
  normalizeMonthlyExpensesScope,
  normalizeUserProfile,
} from "./permissions";
import type { UserProfile } from "./types";

export const USER_PROFILE_BASE_SELECT =
  "id, display_name, role, financial_insights, can_view_overview, can_view_adult_discipleship, can_view_next_gen, can_view_weekend_reach, can_view_operations, can_edit_benchmarks, can_access_chms, can_manage_chms_processes";

export const USER_PROFILE_EXTENDED_SELECT = `${USER_PROFILE_BASE_SELECT}, can_view_monthly_expenses, monthly_expenses_scope, can_view_volunteer_matrix, campus_access`;

function isMissingColumnError(error: { message?: string } | null): boolean {
  return !!error?.message?.includes("does not exist");
}

function isRowNotFoundError(error: { code?: string } | null): boolean {
  return error?.code === "PGRST116";
}

export function buildFallbackProfileFromAuth(user: User): UserProfile {
  return normalizeUserProfile({
    id: user.id,
    display_name:
      (user.user_metadata?.display_name as string | undefined) ??
      user.email?.split("@")[0] ??
      null,
    role: "staff",
    financial_insights: false,
    ...DEFAULT_STAFF_PERMISSIONS,
    can_access_chms: true,
    can_manage_chms_processes: false,
  });
}

export async function queryUserProfileRow(
  supabase: SupabaseClient,
  userId: string
): Promise<(UserProfile & Partial<UserProfile>) | null> {
  const extended = await supabase
    .from("user_profiles")
    .select(USER_PROFILE_EXTENDED_SELECT)
    .eq("id", userId)
    .maybeSingle();

  if (!extended.error) {
    return extended.data as (UserProfile & Partial<UserProfile>) | null;
  }

  if (isMissingColumnError(extended.error)) {
    const base = await supabase
      .from("user_profiles")
      .select(USER_PROFILE_BASE_SELECT)
      .eq("id", userId)
      .maybeSingle();

    if (!base.error) {
      return base.data as (UserProfile & Partial<UserProfile>) | null;
    }
  }

  if (isRowNotFoundError(extended.error)) {
    return null;
  }

  return null;
}

export async function queryAllUserProfileRows(
  supabase: SupabaseClient
): Promise<(UserProfile & Partial<UserProfile>)[]> {
  const extended = await supabase
    .from("user_profiles")
    .select(USER_PROFILE_EXTENDED_SELECT);

  if (!extended.error) {
    return (extended.data ?? []) as (UserProfile & Partial<UserProfile>)[];
  }

  if (isMissingColumnError(extended.error)) {
    const base = await supabase
      .from("user_profiles")
      .select(USER_PROFILE_BASE_SELECT);

    if (!base.error) {
      return (base.data ?? []) as (UserProfile & Partial<UserProfile>)[];
    }
  }

  return [];
}

export async function updateUserProfileRow(
  supabase: SupabaseClient,
  userId: string,
  updates: Record<string, unknown>
) {
  const first = await supabase
    .from("user_profiles")
    .update(updates)
    .eq("id", userId)
    .select(USER_PROFILE_EXTENDED_SELECT)
    .single();

  if (!first.error || !isMalformedArrayLiteral(first.error)) {
    return first;
  }

  return supabase
    .from("user_profiles")
    .update({
      ...updates,
      monthly_expenses_scope: normalizeMonthlyExpensesScope(
        updates.monthly_expenses_scope
      ),
    })
    .eq("id", userId)
    .select(USER_PROFILE_EXTENDED_SELECT)
    .single();
}

export async function resolveUserProfile(
  supabase: SupabaseClient
): Promise<UserProfile | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const row = await queryUserProfileRow(supabase, user.id);
  if (row) return normalizeUserProfile(row);

  return buildFallbackProfileFromAuth(user);
}
