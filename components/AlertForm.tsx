"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import type { Campus, Metric } from "@/lib/types";

type AlertFormProps = {
  metrics: Metric[];
  campuses: Campus[];
};

export function AlertForm({ metrics, campuses }: AlertFormProps) {
  const router = useRouter();
  const [metricId, setMetricId] = useState(metrics[0]?.id ?? "");
  const [campusId, setCampusId] = useState("");
  const [dropPercent, setDropPercent] = useState(10);
  const [monthsWindow, setMonthsWindow] = useState(3);
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const supabase = createClient();
    const { error: insertError } = await supabase.from("alert_thresholds").insert({
      metric_id: metricId,
      campus_id: campusId || null,
      drop_percent: dropPercent,
      months_window: monthsWindow,
      label: label || null,
      is_enabled: true,
    });

    if (insertError) {
      setError(insertError.message);
    } else {
      setMessage("Alert threshold added.");
      setLabel("");
      router.refresh();
    }
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="welcome-card">
      <h2>Add alert threshold</h2>
      <p>Thresholds that surface on the dashboard concerns panel.</p>

      <div className="welcome-fields">
        <label className="welcome-field">
          <span>Metric</span>
          <select
            value={metricId}
            onChange={(e) => setMetricId(e.target.value)}
            required
          >
            {metrics.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <label className="welcome-field">
          <span>Campus (optional)</span>
          <select
            value={campusId}
            onChange={(e) => setCampusId(e.target.value)}
          >
            <option value="">Church-wide</option>
            {campuses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <div className="welcome-fields welcome-fields-2">
          <label className="welcome-field">
            <span>Threshold (%)</span>
            <input
              type="number"
              value={dropPercent}
              min={1}
              max={100}
              onChange={(e) => setDropPercent(Number(e.target.value))}
              required
            />
          </label>
          <label className="welcome-field">
            <span>Over months</span>
            <input
              type="number"
              value={monthsWindow}
              min={1}
              max={24}
              onChange={(e) => setMonthsWindow(Number(e.target.value))}
              required
            />
          </label>
        </div>

        <label className="welcome-field">
          <span>Label (optional)</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Attendance drop at Alma"
          />
        </label>
      </div>

      {error && <div className="welcome-note welcome-note-bad">{error}</div>}
      {message && <div className="welcome-note welcome-note-ok">{message}</div>}

      <div className="welcome-actions">
        <button type="submit" className="welcome-admin" disabled={loading}>
          {loading ? "Saving…" : "Add threshold"}
        </button>
      </div>
    </form>
  );
}
