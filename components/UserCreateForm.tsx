"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MeetingCheckboxes } from "@/components/MeetingCheckboxes";
import { DEFAULT_STAFF_PERMISSIONS } from "@/lib/permissions";
import type { OsTeam } from "@/lib/os/types";
import {
  PermissionCheckboxes,
  type PermissionFormState,
} from "./PermissionCheckboxes";

export function UserCreateForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<"staff" | "admin">("staff");
  const [permissions, setPermissions] =
    useState<PermissionFormState>(DEFAULT_STAFF_PERMISSIONS);
  const [meetings, setMeetings] = useState<OsTeam[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setWarning(null);
    setMessage(null);
    if (role === "staff" && permissions.campus_access.length === 0) {
      setError("Select at least one campus access option.");
      return;
    }
    if (
      role === "staff" &&
      permissions.can_view_monthly_expenses &&
      permissions.monthly_expenses_scope.length === 0
    ) {
      setError("Select at least one expense campus.");
      return;
    }
    setLoading(true);

    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        displayName,
        role,
        permissions: role === "staff" ? permissions : undefined,
        meetings,
      }),
    });

    const result = await response.json();
    setLoading(false);

    if (!response.ok) {
      setError(result.error ?? "Failed to create user");
      return;
    }

    setMessage(`Created ${result.user.email}`);
    setWarning(result.meetingsWarning ?? null);
    setEmail("");
    setPassword("");
    setDisplayName("");
    setRole("staff");
    setPermissions(DEFAULT_STAFF_PERMISSIONS);
    setMeetings([]);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="welcome-card">
      <h2>Add user</h2>
      <p>Create a staff account and choose which dashboard pages they can view.</p>

      <div className="welcome-fields welcome-fields-2">
        <label className="welcome-field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="welcome-field">
          <span>Temporary password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
          />
        </label>
        <label className="welcome-field">
          <span>Display name</span>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Optional"
          />
        </label>
        <label className="welcome-field">
          <span>Role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "staff" | "admin")}
          >
            <option value="staff">Staff</option>
            <option value="admin">Administrator</option>
          </select>
        </label>
      </div>

      <PermissionCheckboxes
        value={permissions}
        onChange={setPermissions}
        isAdmin={role === "admin"}
      />
      <MeetingCheckboxes value={meetings} onChange={setMeetings} />

      {error && <div className="welcome-note welcome-note-bad">{error}</div>}
      {warning && <div className="welcome-note">{warning}</div>}
      {message && <div className="welcome-note welcome-note-ok">{message}</div>}

      <div className="welcome-actions">
        <button type="submit" className="welcome-admin" disabled={loading}>
          {loading ? "Creating…" : "Create user"}
        </button>
      </div>
    </form>
  );
}
