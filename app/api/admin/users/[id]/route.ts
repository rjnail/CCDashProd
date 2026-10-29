import { NextResponse } from "next/server";
import { requireUserManager } from "@/lib/admin-auth";
import { parseMeetingList } from "@/lib/os/pulse-db";
import { syncPulseMeetings } from "@/lib/os/pulse-admin";
import {
  ADMIN_PERMISSIONS,
  ALL_CAMPUS_ACCESS,
  ALL_EXPENSE_SCOPES,
  normalizeCampusAccess,
  normalizeMonthlyExpensesScope,
} from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UserProfile } from "@/lib/types";
import { updateUserProfileRow } from "@/lib/user-profile";

type UpdateUserBody = {
  displayName?: string;
  role?: "staff" | "admin";
  permissions?: Partial<UserProfile>;
  meetings?: unknown;
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, profile } = await requireUserManager();
  if (error || !profile) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  if (id === profile.id && request.headers.get("x-self-edit") !== "1") {
    // Admins can edit themselves through the same form; allow unless demoting last admin
  }

  let body: UpdateUserBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const role = body.role ?? "staff";
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (body.displayName !== undefined) {
    updates.display_name = body.displayName.trim() || null;
  }

  if (role === "admin") {
    Object.assign(updates, {
      role: "admin",
      ...ADMIN_PERMISSIONS,
      financial_insights: true,
      can_access_chms: true,
      can_manage_chms_processes: true,
      can_view_monthly_expenses: true,
      monthly_expenses_scope: ALL_EXPENSE_SCOPES,
    });
  } else {
    const permissions = body.permissions ?? {};
    const campusAccess =
      permissions.campus_access === undefined
        ? ALL_CAMPUS_ACCESS
        : normalizeCampusAccess(permissions.campus_access);
    if (campusAccess.length === 0) {
      return NextResponse.json(
        { error: "Select at least one campus access option" },
        { status: 400 }
      );
    }
    const canViewMonthlyExpenses =
      permissions.can_view_monthly_expenses ??
      permissions.can_view_operations ??
      false;
    const expenseScope = normalizeMonthlyExpensesScope(
      permissions.monthly_expenses_scope ?? ALL_EXPENSE_SCOPES
    );
    if (canViewMonthlyExpenses && expenseScope.length === 0) {
      return NextResponse.json(
        { error: "Select at least one expense campus" },
        { status: 400 }
      );
    }
    Object.assign(updates, {
      role: "staff",
      can_view_overview: permissions.can_view_overview ?? true,
      can_view_adult_discipleship:
        permissions.can_view_adult_discipleship ?? true,
      can_view_next_gen: permissions.can_view_next_gen ?? true,
      can_view_weekend_reach: permissions.can_view_weekend_reach ?? true,
      can_view_operations: permissions.can_view_operations ?? false,
      can_view_monthly_expenses: canViewMonthlyExpenses,
      monthly_expenses_scope: expenseScope,
      can_view_volunteer_matrix: permissions.can_view_volunteer_matrix ?? true,
      campus_access: campusAccess,
      can_edit_benchmarks: permissions.can_edit_benchmarks ?? false,
      can_access_chms: permissions.can_access_chms ?? true,
      can_manage_chms_processes: permissions.can_manage_chms_processes ?? false,
      financial_insights: permissions.can_view_operations ?? false,
    });
  }

  try {
    const admin = createAdminClient();

    if (role !== "admin") {
      const { count, error: adminCountError } = await admin
        .from("user_profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin");

      if (adminCountError) {
        return NextResponse.json({ error: adminCountError.message }, { status: 500 });
      }

      const { data: target, error: targetError } = await admin
        .from("user_profiles")
        .select("role")
        .eq("id", id)
        .single();

      if (targetError) {
        return NextResponse.json({ error: targetError.message }, { status: 404 });
      }

      if (target.role === "admin" && (count ?? 0) <= 1) {
        return NextResponse.json(
          { error: "Cannot remove the last administrator" },
          { status: 400 }
        );
      }
    }

    const { data, error: updateError } = await updateUserProfileRow(admin, id, updates);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    if (body.displayName !== undefined) {
      await admin.auth.admin.updateUserById(id, {
        user_metadata: { display_name: body.displayName.trim() },
      });
    }

    let meetingsWarning: string | null = null;
    if (body.meetings !== undefined) {
      const meetings = parseMeetingList(body.meetings);
      if (!meetings.ok) {
        return NextResponse.json({ error: "Unknown meeting selection" }, { status: 400 });
      }
      const synced = await syncPulseMeetings(id, meetings.teams);
      meetingsWarning = synced.ok ? null : synced.error;
    }

    return NextResponse.json({
      user: data,
      meetingsWarning,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to update user";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
