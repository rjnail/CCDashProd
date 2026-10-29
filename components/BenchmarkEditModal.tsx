"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { BENCHMARK_MINISTRY_AREAS, VIEW_SECTION_LABELS } from "@/lib/sections";
import type { BenchmarkTarget, Campus, Metric } from "@/lib/types";
import { FISCAL_YEAR_OPTIONS } from "@/lib/types";

type BenchmarkEditModalProps = {
  benchmark: BenchmarkTarget | null;
  metrics: Metric[];
  campuses: Campus[];
  open: boolean;
  onClose: () => void;
};

export function BenchmarkEditModal({
  benchmark,
  metrics,
  campuses,
  open,
  onClose,
}: BenchmarkEditModalProps) {
  const router = useRouter();
  const [metricId, setMetricId] = useState("");
  const [ministryArea, setMinistryArea] = useState("");
  const [campusId, setCampusId] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [stretchValue, setStretchValue] = useState("");
  const [label, setLabel] = useState("");
  const [fiscalYear, setFiscalYear] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (benchmark) {
      setMetricId(benchmark.metric_id);
      setMinistryArea(benchmark.ministry_area ?? "");
      setCampusId(benchmark.campus_id ?? "");
      setTargetValue(String(benchmark.target_value));
      setStretchValue(
        benchmark.stretch_value != null ? String(benchmark.stretch_value) : ""
      );
      setLabel(benchmark.label ?? "");
      setFiscalYear(benchmark.fiscal_year);
      setError(null);
    }
  }, [benchmark]);

  const selectedMetric = metrics.find((m) => m.id === metricId);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!benchmark) return;

    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("benchmark_targets")
      .update({
        metric_id: metricId,
        ministry_area: ministryArea || null,
        campus_id: campusId || null,
        fiscal_year: fiscalYear,
        target_value: Number(targetValue),
        stretch_value: stretchValue ? Number(stretchValue) : null,
        label: label || null,
      })
      .eq("id", benchmark.id);

    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    onClose();
    router.refresh();
  }

  if (!open || !benchmark) return null;

  return (
    <dialog className="modal modal-open">
      <div className="modal-box welcome-card">
        <h2>Edit benchmark</h2>
        <p>
          Update this comparison point. Changes appear on the dashboard
          immediately.
        </p>

        <form onSubmit={handleSave}>
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
              />
            </label>
          </div>

          {error && <div className="welcome-note welcome-note-bad">{error}</div>}

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
