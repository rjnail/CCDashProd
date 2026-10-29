"use client";

import { useState } from "react";
import { VIEW_SECTION_LABELS, VIEW_SECTIONS } from "@/lib/sections";
import { CAMPUS_ACCESS_OPTIONS, canEditBenchmarks } from "@/lib/permissions";
import { OS_MEETING_LABELS, type OsTeam } from "@/lib/os/types";
import type { ManagedUser } from "@/lib/types";
import { UserEditModal } from "./UserEditModal";

type UserListProps = {
  users: ManagedUser[];
};

function summarizeAccess(user: ManagedUser): string {
  if (user.role === "admin") return "All pages · Edit benchmarks";

  const pages = VIEW_SECTIONS.filter((section) => {
    if (section === "vital-signs" || section === "overview") {
      return user.can_view_overview;
    }
    if (section === "adult-discipleship") return user.can_view_adult_discipleship;
    if (section === "next-gen") return user.can_view_next_gen;
    if (section === "weekend-reach") return user.can_view_weekend_reach;
    return user.can_view_operations;
  }).map((section) => VIEW_SECTION_LABELS[section]);

  const extras = [
    ...(user.can_view_volunteer_matrix ? ["Volunteer Matrix"] : []),
    ...(canEditBenchmarks(user) ? ["Edit benchmarks"] : []),
  ];
  const campus =
    user.campus_access.length === CAMPUS_ACCESS_OPTIONS.length
      ? []
      : [
          `Campus: ${
            CAMPUS_ACCESS_OPTIONS.filter((option) =>
              user.campus_access.includes(option.value)
            )
              .map((option) => option.label)
              .join(", ") || "none"
          }`,
        ];
  const meetings = (user.pulseTeams ?? [])
    .map((team) => OS_MEETING_LABELS[team as OsTeam])
    .filter(Boolean);
  return [...campus, ...pages, ...extras, ...meetings].join(" · ") || "No access";
}

export function UserList({ users }: UserListProps) {
  const [selected, setSelected] = useState<ManagedUser | null>(null);

  if (users.length === 0) {
    return <p>No users found yet.</p>;
  }

  return (
    <>
      <p>Click a row to edit permissions.</p>
      <div className="welcome-tablewrap">
        <table className="welcome-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Access</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr
                key={user.id}
                onClick={() => setSelected(user)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelected(user);
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label={`Edit permissions for ${user.email}`}
              >
                <td>{user.display_name ?? "—"}</td>
                <td>{user.email}</td>
                <td className="capitalize">{user.role}</td>
                <td className="welcome-muted">{summarizeAccess(user)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <UserEditModal
        user={selected}
        open={selected !== null}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
