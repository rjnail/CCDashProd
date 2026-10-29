"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { captureIssue, dismissCommunityInsight } from "@/lib/os/ids-actions";
import type { OsInsight, OsTeam } from "@/lib/os/types";
import { OS_TEAM_LABELS } from "@/lib/os/types";

export function InsightCards({
  insights,
  variant,
  teams,
  canCapture,
  surface,
  team,
  onAsk,
}: {
  insights: OsInsight[];
  variant: "pulse" | "dashboard";
  teams: OsTeam[];
  canCapture: boolean;
  surface: "pulse" | "dashboard";
  team?: OsTeam;
  onAsk: (question: string) => void;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<OsTeam | "">(team ?? teams[0] ?? "");
  const [message, setMessage] = useState<string | null>(null);

  if (insights.length === 0) {
    return <p className={variant === "pulse" ? "empty" : undefined}>No material findings from the current sources.</p>;
  }

  return (
    <div>
      {message && (
        <p role="status" className={variant === "pulse" ? "notice" : undefined}>
          {message}
        </p>
      )}
      {insights.map((insight) => (
        <article key={insight.id} className={variant === "pulse" ? "row" : "sfdc-widget"} style={{ padding: variant === "dashboard" ? 12 : undefined, marginTop: 8 }}>
          <div className="grow">
            <h3>{insight.title}</h3>
            <div className={variant === "pulse" ? "sub" : undefined}>{insight.summary}</div>
            <p>{insight.evidence}</p>
            <p>
              {insight.campusLabel} · {insight.periodLabel} ·{" "}
              {insight.lifecycle === "stale" ? "Stale" : "Current"} · Data as of{" "}
              {insight.refreshedAt ? new Date(insight.refreshedAt).toLocaleString() : "no source timestamp"}
            </p>
            <p>{insight.limitation}</p>
            <p>Follow-up: {insight.followUp}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              {insight.reportHref && (
                <Link className={variant === "pulse" ? "btn" : "sfdc-btn sfdc-btn--neutral"} href={insight.reportHref}>
                  View evidence
                </Link>
              )}
              <button type="button" className={variant === "pulse" ? "btn" : "sfdc-btn sfdc-btn--neutral"} onClick={() => onAsk(insight.title)}>
                Ask about this
              </button>
              {canCapture && (team || teams.length > 0) && (
                <button
                  type="button"
                  className={variant === "pulse" ? "btn" : "sfdc-btn sfdc-btn--neutral"}
                  onClick={() => {
                    const chosen = team ?? target;
                    if (!chosen) {
                      setMessage("Choose a meeting before adding an issue.");
                      return;
                    }
                    void captureIssue({ team: chosen, title: insight.title, metricKey: insight.metricKey }).then((result) => {
                      if (!result.ok) setMessage(result.error);
                      else {
                        setMessage("Added to IDS.");
                        router.refresh();
                      }
                    });
                  }}
                >
                  Add to IDS
                </button>
              )}
              <button
                type="button"
                className={variant === "pulse" ? "btn" : "sfdc-btn sfdc-btn--neutral"}
                onClick={() => {
                  void dismissCommunityInsight({
                    insightId: insight.id,
                    surface,
                    team: surface === "pulse" ? team : "",
                  }).then((result) => {
                    if (!result.ok) setMessage(result.error);
                    else router.refresh();
                  });
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        </article>
      ))}
      {canCapture && !team && teams.length > 1 && (
        <label>
          Meeting for new issues
          <select value={target} onChange={(event) => setTarget(event.target.value as OsTeam)}>
            {teams.map((item) => (
              <option key={item} value={item}>
                {OS_TEAM_LABELS[item]}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
