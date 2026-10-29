"use client";

import { OS_MEETING_LABELS, OS_TEAMS, type OsTeam } from "@/lib/os/types";

export function MeetingCheckboxes({
  value,
  onChange,
}: {
  value: OsTeam[];
  onChange: (next: OsTeam[]) => void;
}) {
  return (
    <div className="welcome-group">
      <h3>Pulse meetings</h3>
      <p>
        Administrator role does not include a meeting. Check each meeting this
        person should open.
      </p>
      <div className="welcome-checks">
        {OS_TEAMS.map((team) => (
          <label key={team} className="welcome-check">
            <input
              type="checkbox"
              checked={value.includes(team)}
              onChange={(event) => {
                const next = event.target.checked
                  ? OS_TEAMS.filter((item) => value.includes(item) || item === team)
                  : value.filter((item) => item !== team);
                onChange([...next]);
              }}
            />
            <span>{OS_MEETING_LABELS[team]}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
