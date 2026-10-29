"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MeetingCheckboxes } from "@/components/MeetingCheckboxes";
import {
  ADMIN_PERMISSIONS,
  permissionsFromProfile,
} from "@/lib/permissions";
import type { OsTeam } from "@/lib/os/types";
import type { ManagedUser } from "@/lib/types";
import {
  PermissionCheckboxes,
  type PermissionFormState,
} from "./PermissionCheckboxes";

type UserEditModalProps = {
  user: ManagedUser | null;
  open: boolean;
  onClose: () => void;
};

export function UserEditModal({ user, open, onClose }: UserEditModalProps) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<"staff" | "admin">("staff");
  const [permissions, setPermissions] = useState<PermissionFormState>(
    ADMIN_PERMISSIONS
  );
  const [meetings, setMeetings] = useState<OsTeam[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setDisplayName(user.display_name ?? "");
    setRole(user.role);
    setPermissions(permissionsFromProfile(user));
    setMeetings(user.pulseTeams ?? []);
    setError(null);
    setWarning(null);
  }, [user]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;

    setError(null);
    setWarning(null);
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

    const response = await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName,
        role,
        permissions: role === "staff" ? permissions : undefined,
        meetings,
      }),
    });

    const result = await response.json();
    setLoading(false);

    if (!response.ok) {
      setError(result.error ?? "Failed to update user");
      return;
    }

    if (result.meetingsWarning) {
      setWarning(result.meetingsWarning);
      router.refresh();
      return;
    }

    onClose();
    router.refresh();
  }

  if (!open || !user) return null;

  return (
    <dialog className="modal modal-open">
      <div className="modal-box welcome-card">
        <h2>Edit user</h2>
        <p>{user.email}</p>

        <form onSubmit={handleSave}>
          <div className="welcome-fields">
            <label className="welcome-field">
              <span>Display name</span>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
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

          <div className="welcome-actions">
            <button type="submit" className="welcome-admin" disabled={loading}>
              {loading ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              className="welcome-back"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
      <button
        type="button"
        className="modal-backdrop"
        aria-label="Close"
        onClick={onClose}
      />
    </dialog>
  );
}
