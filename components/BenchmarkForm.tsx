"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import {
  BENCHMARK_MINISTRY_AREAS,
  defaultMinistryAreaForMetric,
  VIEW_SECTION_LABELS,
} from "@/lib/sections";
import type { Campus, Metric } from "@/lib/types";
import { FISCAL_YEAR_OPTIONS, TARGET_FISCAL_YEAR } from "@/lib/types";

type BenchmarkFormProps = {
  metrics: Metric[];
  campuses: Campus[];
};

export function BenchmarkForm({ metrics, campuses }: BenchmarkFormProps) {
  const router = useRouter();
  const [metricId, setMetricId] = useState(metrics[0]?.id ?? "");
  const [ministryArea, setMinistryArea] = useState<string>(
    defaultMinistryAreaForMetric(metrics[0]?.key) ?? ""
  );
  const [campusId, setCampusId] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [stretchValue, setStretchValue] = useState("");
  const [label, setLabel] = useState("");
  const [fiscalYear, setFiscalYear] = useState(TARGET_FISCAL_YEAR);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const supabase = createClient();
    const { error: insertError } = await supabase
      .from("benchmark_targets")
      .insert({
        metric_id: metricId,
        ministry_area: ministryArea || null,
        campus_id: campusId || null,
        fiscal_year: fiscalYear,
        target_value: Number(targetValue),
        stretch_value: stretchValue ? Number(stretchValue) : null,
        label: label || null,
      });

    if (insertError) {
      setError(insertError.message);
    } else {
      setMessage("Benchmark added.");
      setTargetValue("");
      setStretchValue("");
      setLabel("");
      router.refresh();
    }
    setLoading(false);
  }

  const selectedMetric = metrics.find((m) => m.id === metricId);

  return (
    <form onSubmit={handleSubmit} className="welcome-card">
      <h2>Add benchmark</h2>
      <p>
        Benchmarks appear on the dashboard with a stoplight: green (on track),
        yellow (needs attention), red (below benchmark).
      </p>

      <div className="welcome-fields">
        <label className="welcome-field">
          <span>Metric</span>
          <select
            value={metricId}
            onChange={(e) => {
              const nextId = e.target.value;
              setMetricId(nextId);
              setMinistryArea(
                defaultMinistryAreaForMetric(
                  metrics.find((m) => m.id === nextId)?.key
                ) ?? ""
              );
            }}
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
          <span>Ministry area</span>
          <select
            value={ministryArea}
            onChange={(e) => setMinistryArea(e.target.value)}
          >
            {BENCHMARK_MINISTRY_AREAS.map((area) => (
              <option key={area} value={area}>
                {VIEW_SECTION_LABELS[area]}
              </option>
            ))}
            <option value="">None</option>
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

        <label className="welcome-field">
          <span>Fiscal year</span>
          <select
            value={fiscalYear}
            onChange={(e) => setFiscalYear(e.target.value)}
            required
          >
            {FISCAL_YEAR_OPTIONS.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>

        <label className="welcome-field">
          <span>
            Benchmark value
            {selectedMetric ? ` (${selectedMetric.unit})` : ""}
          </span>
          <input
            type="number"
            step="any"
            value={targetValue}
            onChange={(e) => setTargetValue(e.target.value)}
            placeholder={
              selectedMetric?.unit === "percent" ? "e.g. 20" : "e.g. 1500"
            }
            required
          />
        </label>

        <label className="welcome-field">
          <span>Stretch goal (optional)</span>
          <input
            type="number"
            step="any"
            value={stretchValue}
            onChange={(e) => setStretchValue(e.target.value)}
          />
        </label>

        <label className="welcome-field">
          <span>Label (optional)</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Kids % of total attendance"
          />
        </label>
      </div>

      {error && <div className="welcome-note welcome-note-bad">{error}</div>}
      {message && <div className="welcome-note welcome-note-ok">{message}</div>}

      <div className="welcome-actions">
        <button type="submit" className="welcome-admin" disabled={loading}>
          {loading ? "Saving…" : "Add benchmark"}
        </button>
      </div>
    </form>
  );
}
