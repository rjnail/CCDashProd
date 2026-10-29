import { BrandLogo } from "@/components/BrandLogo";
import { DataSyncPanel } from "@/components/DataSyncPanel";
import { UserCreateForm } from "@/components/UserCreateForm";
import { UserList } from "@/components/UserList";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { loadPulseMeetings } from "@/lib/os/pulse-admin";
import Link from "next/link";
import { redirect } from "next/navigation";
import "@/components/os/shell.css";
import {
  ALL_CAMPUS_ACCESS,
  ALL_EXPENSE_SCOPES,
  canManageUsers,
  normalizeUserProfile,
} from "@/lib/permissions";
import { getUserProfile } from "@/lib/metrics";
import type { ManagedUser } from "@/lib/types";
import { queryAllUserProfileRows } from "@/lib/user-profile";

async function getManagedUsers(): Promise<{
  users: ManagedUser[];
  meetingsWarning: string | null;
}> {
  const admin = createAdminClient();
  const [{ data: authData }, profiles, meetings] = await Promise.all([
    admin.auth.admin.listUsers({ perPage: 200 }),
    queryAllUserProfileRows(admin),
    loadPulseMeetings(),
  ]);

  const profileById = new Map(
    profiles.map((row) => [row.id, normalizeUserProfile(row)])
  );

  const users = (authData?.users ?? [])
    .map((user) => {
      const existing = profileById.get(user.id);
      const profile = existing ? normalizeUserProfile(existing) : null;
      return {
        id: user.id,
        email: user.email ?? "",
        display_name:
          profile?.display_name ??
          (user.user_metadata?.display_name as string | undefined) ??
          null,
        role: profile?.role ?? "staff",
        financial_insights: profile?.financial_insights ?? false,
        can_view_overview: profile?.can_view_overview ?? true,
        can_view_adult_discipleship: profile?.can_view_adult_discipleship ?? true,
        can_view_next_gen: profile?.can_view_next_gen ?? true,
        can_view_weekend_reach: profile?.can_view_weekend_reach ?? true,
        can_view_operations: profile?.can_view_operations ?? false,
        can_view_monthly_expenses: profile?.can_view_monthly_expenses ?? false,
        monthly_expenses_scope:
          profile?.monthly_expenses_scope ?? ALL_EXPENSE_SCOPES,
        can_view_volunteer_matrix: profile?.can_view_volunteer_matrix ?? true,
        campus_access: profile?.campus_access ?? ALL_CAMPUS_ACCESS,
        can_edit_benchmarks: profile?.can_edit_benchmarks ?? false,
        can_access_chms: profile?.can_access_chms ?? true,
        can_manage_chms_processes: profile?.can_manage_chms_processes ?? false,
        pulseTeams: meetings.byUser.get(user.id) ?? [],
      };
    })
    .sort((a, b) => a.email.localeCompare(b.email));

  return { users, meetingsWarning: meetings.warning };
}

export default async function UsersSettingsPage() {
  const supabase = await createClient();
  const profile = await getUserProfile(supabase);

  if (!profile) redirect("/login");
  if (!canManageUsers(profile)) redirect("/dashboard");

  let users: ManagedUser[] = [];
  let loadError: string | null = null;
  let meetingsWarning: string | null = null;

  try {
    const loaded = await getManagedUsers();
    users = loaded.users;
    meetingsWarning = loaded.meetingsWarning;
  } catch (err) {
    loadError =
      err instanceof Error
        ? err.message
        : "Failed to load users. Add SUPABASE_SERVICE_ROLE_KEY to .env.local.";
  }

  return (
    <main className="welcome welcome-page">
      <div className="welcome-inner">
        <BrandLogo href={null} showSubtitle={false} />
        <h1>Users</h1>
        <p>
          Create staff accounts and control which dashboard pages each person
          can view, plus benchmark editing and Pulse meeting access.
        </p>
        <div className="welcome-stack">
          <DataSyncPanel />
          {meetingsWarning && (
            <div className="welcome-note">{meetingsWarning}</div>
          )}
          {loadError ? (
            <div className="welcome-note">{loadError}</div>
          ) : (
            <>
              <UserCreateForm />
              <section className="welcome-card">
                <h2>All users</h2>
                <UserList users={users} />
              </section>
            </>
          )}
        </div>
        <Link href="/settings" className="welcome-back">
          Back to admin settings
        </Link>
      </div>
    </main>
  );
}
