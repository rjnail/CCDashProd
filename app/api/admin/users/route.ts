import { NextResponse } from "next/server";
import { requireUserManager } from "@/lib/admin-auth";
import { loadPulseMeetings, syncPulseMeetings } from "@/lib/os/pulse-admin";
import { parseMeetingList } from "@/lib/os/pulse-db";
import {
  ADMIN_PERMISSIONS,
  ALL_CAMPUS_ACCESS,
  ALL_EXPENSE_SCOPES,
  normalizeCampusAccess,
  normalizeMonthlyExpensesScope,
  normalizeUserProfile,
} from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ManagedUser, UserProfile } from "@/lib/types";
import { queryAllUserProfileRows, updateUserProfileRow } from "@/lib/user-profile";

type CreateUserBody = {
  email: string;
  password: string;
  displayName?: string;
  role?: "staff" | "admin";
  permissions?: Partial<UserProfile>;
  meetings?: unknown;
};

function buildPermissionPayload(
  role: "staff" | "admin",
  permissions?: Partial<UserProfile>
) {
  if (role === "admin") {
    return {
      ...ADMIN_PERMISSIONS,
      financial_insights: true,
      can_access_chms: true,
      can_manage_chms_processes: true,
      can_view_monthly_expenses: true,
      monthly_expenses_scope: ALL_EXPENSE_SCOPES,
    };
  }

  return {
    can_view_overview: permissions?.can_view_overview ?? true,
    can_view_adult_discipleship:
      permissions?.can_view_adult_discipleship ?? true,
    can_view_next_gen: permissions?.can_view_next_gen ?? true,
    can_view_weekend_reach: permissions?.can_view_weekend_reach ?? true,
    can_view_operations: permissions?.can_view_operations ?? false,
    can_view_monthly_expenses:
      permissions?.can_view_monthly_expenses ??
      permissions?.can_view_operations ??
      false,
    monthly_expenses_scope: normalizeMonthlyExpensesScope(
      permissions?.monthly_expenses_scope ?? ALL_EXPENSE_SCOPES
    ),
    can_view_volunteer_matrix: permissions?.can_view_volunteer_matrix ?? true,
    campus_access:
      permissions?.campus_access === undefined
        ? ALL_CAMPUS_ACCESS
        : normalizeCampusAccess(permissions.campus_access),
    can_edit_benchmarks: permissions?.can_edit_benchmarks ?? false,
    can_access_chms: permissions?.can_access_chms ?? true,
    can_manage_chms_processes: permissions?.can_manage_chms_processes ?? false,
    financial_insights: permissions?.can_view_operations ?? false,
  };
}

export async function GET() {
  const { error, profile } = await requireUserManager();
  if (error || !profile) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const admin = createAdminClient();
    const [{ data: authData, error: listError }, profiles, meetings] = await Promise.all([
      admin.auth.admin.listUsers({ perPage: 200 }),
      queryAllUserProfileRows(admin),
      loadPulseMeetings(),
    ]);

    if (listError) {
      return NextResponse.json(
        { error: listError.message ?? "Failed to load users" },
        { status: 500 }
      );
    }

    const profileById = new Map(
      profiles.map((row) => [row.id, normalizeUserProfile(row)])
    );

    const users: ManagedUser[] = (authData.users ?? []).map((user) => {
      const existing = profileById.get(user.id);
      return {
        id: user.id,
        email: user.email ?? "",
        display_name:
          existing?.display_name ??
          (user.user_metadata?.display_name as string | undefined) ??
          null,
        role: existing?.role ?? "staff",
        financial_insights: existing?.financial_insights ?? false,
        can_view_overview: existing?.can_view_overview ?? true,
        can_view_adult_discipleship: existing?.can_view_adult_discipleship ?? true,
        can_view_next_gen: existing?.can_view_next_gen ?? true,
        can_view_weekend_reach: existing?.can_view_weekend_reach ?? true,
        can_view_operations: existing?.can_view_operations ?? false,
        can_view_monthly_expenses:
          existing?.can_view_monthly_expenses ??
          existing?.can_view_operations ??
          false,
        monthly_expenses_scope:
          existing?.monthly_expenses_scope ?? ALL_EXPENSE_SCOPES,
        can_view_volunteer_matrix: existing?.can_view_volunteer_matrix ?? true,
        campus_access: existing?.campus_access ?? ALL_CAMPUS_ACCESS,
        can_edit_benchmarks: existing?.can_edit_benchmarks ?? false,
        can_access_chms: existing?.can_access_chms ?? true,
        can_manage_chms_processes: existing?.can_manage_chms_processes ?? false,
        pulseTeams: meetings.byUser.get(user.id) ?? [],
      };
    });

    users.sort((a, b) => a.email.localeCompare(b.email));

    return NextResponse.json({ users, meetingsWarning: meetings.warning });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load users";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { error, profile } = await requireUserManager();
  if (error || !profile) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: CreateUserBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const password = body.password?.trim();
  const role = body.role ?? "staff";

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 }
    );
  }

  if (password.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters" },
      { status: 400 }
    );
  }

  const meetings = parseMeetingList(body.meetings ?? []);
  if (!meetings.ok) {
    return NextResponse.json({ error: "Unknown meeting selection" }, { status: 400 });
  }

  const permissionPayload = buildPermissionPayload(role, body.permissions);
  if (permissionPayload.campus_access.length === 0) {
    return NextResponse.json(
      { error: "Select at least one campus access option" },
      { status: 400 }
    );
  }

  if (
    role !== "admin" &&
    permissionPayload.can_view_monthly_expenses &&
    permissionPayload.monthly_expenses_scope.length === 0
  ) {
    return NextResponse.json(
      { error: "Select at least one expense campus" },
      { status: 400 }
    );
  }

  try {
    const admin = createAdminClient();
    const displayName = body.displayName?.trim() || email.split("@")[0];

    const { data: created, error: createError } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName },
      });

    if (createError || !created.user) {
      return NextResponse.json(
        { error: createError?.message ?? "Failed to create user" },
        { status: 400 }
      );
    }

    const { error: profileError } = await updateUserProfileRow(admin, created.user.id, {
      display_name: displayName,
      role,
      ...permissionPayload,
      updated_at: new Date().toISOString(),
    });

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }

    const { error: prefsError } = await admin
      .from("user_preferences")
      .upsert({ user_id: created.user.id });

    if (prefsError) {
      return NextResponse.json({ error: prefsError.message }, { status: 500 });
    }

    const synced = await syncPulseMeetings(created.user.id, meetings.teams);

    return NextResponse.json({
      user: {
        id: created.user.id,
        email,
        display_name: displayName,
        role,
        ...permissionPayload,
        pulseTeams: synced.ok ? meetings.teams : [],
      },
      meetingsWarning: synced.ok ? null : synced.error,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create user";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
